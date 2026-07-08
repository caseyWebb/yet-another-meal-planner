import { describe, it, expect } from "vitest";
import { ToolError } from "../src/errors.js";
import app from "../src/api/app.js";
import type { Env } from "../src/env.js";

// A test-only route through the REAL mount's error boundary (basePath /api applies).
app.get("/boom", () => {
  throw new ToolError("not_found", "no such thing");
});
app.get("/kaput", () => {
  throw new Error("wires crossed");
});

/** In-memory KV (get/put/delete/list) — the session store, allowlist, and rate counters. */
function memKv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    store: m,
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

/** Env with an allowlisted member + their invite code, and a capture-only TOOL_AE. */
function apiEnv(overrides: Partial<Env> = {}) {
  const tenantKv = memKv({
    "tenant:casey": JSON.stringify({ id: "casey" }),
    "invite:GOODCODE": "casey",
  });
  const points: { indexes?: unknown[]; blobs?: unknown[]; doubles?: unknown[] }[] = [];
  const env = {
    TENANT_KV: tenantKv,
    KROGER_KV: memKv(),
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }),
    },
    TOOL_AE: { writeDataPoint: (p: never) => points.push(p) },
    ...overrides,
  } as unknown as Env;
  return { env, tenantKv, points };
}

const CSRF = { "X-App-Csrf": "1" };

function login(env: Env, code: string, headers: Record<string, string> = {}) {
  return app.request(
    "http://127.0.0.1/api/session",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...CSRF, ...headers },
      body: JSON.stringify({ invite_code: code }),
    },
    env,
  );
}

/** Extract the session cookie pair (`__Host-session=<token>`) from a login response. */
function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /__Host-session=([^;]+)/.exec(setCookie);
  if (!m) throw new Error(`no session cookie in: ${setCookie}`);
  return `__Host-session=${m[1]}`;
}

describe("POST /api/session (login)", () => {
  it("sets the __Host- cookie with the full attribute set and returns { tenant }", async () => {
    const { env } = apiEnv();
    const res = await login(env, "GOODCODE");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenant: { id: "casey" } });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=7776000"); // 90 days
  });

  it("answers unknown code, revoked member, and missing code with ONE uniform 401", async () => {
    const { env, tenantKv } = apiEnv();
    const unknown = await login(env, "NO-SUCH-CODE");
    // A code whose member left the allowlist — resolves to null exactly like an unknown code.
    await tenantKv.delete("tenant:casey");
    const revoked = await login(env, "GOODCODE");
    const missing = await app.request(
      "http://127.0.0.1/api/session",
      { method: "POST", headers: { "content-type": "application/json", ...CSRF }, body: "{}" },
      env,
    );
    const bodies = await Promise.all([unknown, revoked, missing].map((r) => r.json()));
    expect(unknown.status).toBe(401);
    expect(revoked.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(bodies[1]).toEqual(bodies[0]); // no oracle
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({ error: "unauthorized", message: "That invite code didn't work" });
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it("rate-limits the 11th attempt from one IP within the window (429)", async () => {
    const { env } = apiEnv();
    const headers = { "CF-Connecting-IP": "203.0.113.9" };
    for (let i = 0; i < 10; i++) {
      const res = await login(env, "NO-SUCH-CODE", headers);
      expect(res.status).toBe(401); // under the limit: the uniform auth answer
    }
    const eleventh = await login(env, "GOODCODE", headers);
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toEqual({ error: "rate_limited", message: expect.any(String) });
    // A different IP is a different bucket — unaffected.
    const other = await login(env, "GOODCODE", { "CF-Connecting-IP": "203.0.113.10" });
    expect(other.status).toBe(200);
  });
});

describe("CSRF guard", () => {
  it("rejects a state-changing request without X-App-Csrf (403, before any handler)", async () => {
    const { env } = apiEnv();
    const res = await app.request(
      "http://127.0.0.1/api/session",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite_code: "GOODCODE" }) },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_rejected", message: expect.any(String) });
    expect(res.headers.get("set-cookie")).toBeNull(); // the handler never ran
  });

  it("rejects Sec-Fetch-Site: cross-site (and same-site) even with the header", async () => {
    const { env } = apiEnv();
    for (const site of ["cross-site", "same-site"]) {
      const res = await login(env, "GOODCODE", { "Sec-Fetch-Site": site });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("csrf_rejected");
    }
    // same-origin / none pass through.
    const ok = await login(env, "GOODCODE", { "Sec-Fetch-Site": "same-origin" });
    expect(ok.status).toBe(200);
  });

  it("leaves GETs alone (no header required)", async () => {
    const { env } = apiEnv();
    const res = await app.request("http://127.0.0.1/api/version", {}, env);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/session (whoami) + ETag", () => {
  it("401s without a cookie, 200s with one — carrying a weak ETag", async () => {
    const { env } = apiEnv();
    const bare = await app.request("http://127.0.0.1/api/session", {}, env);
    expect(bare.status).toBe(401);
    expect(await bare.json()).toEqual({ error: "unauthorized", message: expect.any(String) });

    const cookie = sessionCookie(await login(env, "GOODCODE"));
    const res = await app.request("http://127.0.0.1/api/session", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenant: { id: "casey" } });
    expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{64}"$/);
    // Deterministic store-then-revalidate (member-app-offline D6): the browser keeps
    // the validator but never reuses the body without asking.
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers a matching If-None-Match with an empty-body 304", async () => {
    const { env } = apiEnv();
    const cookie = sessionCookie(await login(env, "GOODCODE"));
    const first = await app.request("http://127.0.0.1/api/session", { headers: { cookie } }, env);
    const etag = first.headers.get("etag")!;
    const second = await app.request(
      "http://127.0.0.1/api/session",
      { headers: { cookie, "If-None-Match": etag } },
      env,
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
    // The 304 arm carries the same posture (folded into the stored response).
    expect(second.headers.get("cache-control")).toBe("private, no-cache");
  });
});

describe("DELETE /api/session (logout)", () => {
  it("invalidates the token server-side and expires the cookie", async () => {
    const { env } = apiEnv();
    const cookie = sessionCookie(await login(env, "GOODCODE"));
    const out = await app.request(
      "http://127.0.0.1/api/session",
      { method: "DELETE", headers: { cookie, ...CSRF } },
      env,
    );
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0"); // cookie expired

    // A replay of the retained cookie value no longer authenticates (the record is gone).
    const replay = await app.request("http://127.0.0.1/api/session", { headers: { cookie } }, env);
    expect(replay.status).toBe(401);
  });
});

describe("shared middleware skeleton", () => {
  it("maps a thrown ToolError to its status with the structured body", async () => {
    const { env } = apiEnv();
    const res = await app.request("http://127.0.0.1/api/boom", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "no such thing" });
  });

  it("degrades an unexpected throw to a structured 500", async () => {
    const { env } = apiEnv();
    const res = await app.request("http://127.0.0.1/api/kaput", {}, env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal", message: "wires crossed" });
  });

  it("carries X-App-Build on EVERY response (success, auth failure, CSRF, errors, version)", async () => {
    const { env } = apiEnv({ APP_BUILD: "abc1234" } as Partial<Env>);
    const responses = [
      await app.request("http://127.0.0.1/api/version", {}, env),
      await login(env, "GOODCODE"),
      await login(env, "NO-SUCH-CODE"),
      await app.request("http://127.0.0.1/api/session", {}, env), // 401
      await app.request("http://127.0.0.1/api/session", { method: "POST" }, env), // 403 csrf
      await app.request("http://127.0.0.1/api/boom", {}, env), // ToolError 404
      await app.request("http://127.0.0.1/api/kaput", {}, env), // 500
    ];
    for (const res of responses) expect(res.headers.get("x-app-build")).toBe("abc1234");
  });

  it("GET /api/version returns { build } unauthenticated; 'dev' when unstamped", async () => {
    const stamped = apiEnv({ APP_BUILD: "abc1234" } as Partial<Env>);
    const res = await app.request("http://127.0.0.1/api/version", {}, stamped.env);
    expect(await res.json()).toEqual({ build: "abc1234" });

    const dev = apiEnv();
    const devRes = await app.request("http://127.0.0.1/api/version", {}, dev.env);
    expect(await devRes.json()).toEqual({ build: "dev" });
  });

  it("emits NO Access-Control-Allow-* header on any response", async () => {
    const { env } = apiEnv();
    const responses = [
      await app.request("http://127.0.0.1/api/version", {}, env),
      await login(env, "GOODCODE"),
      await app.request("http://127.0.0.1/api/session", { method: "POST" }, env),
      await app.request("http://127.0.0.1/api/boom", {}, env),
      await app.request("http://127.0.0.1/api/version", { method: "OPTIONS" }, env), // preflight-shaped
    ];
    for (const res of responses) {
      for (const name of res.headers.keys()) {
        expect(name.toLowerCase().startsWith("access-control-allow")).toBe(false);
      }
    }
  });

  it("records one api:-prefixed usage point per request, named by the ROUTE PATTERN", async () => {
    const { env, points } = apiEnv();
    await login(env, "GOODCODE");
    await app.request("http://127.0.0.1/api/version", {}, env);
    const names = points.map((p) => (p.blobs as string[])[0]);
    expect(names).toContain("api:POST /api/session");
    expect(names).toContain("api:GET /api/version");
    // Tenant-clean: no point carries the invite code or a tenant id.
    for (const p of points) {
      const flat = JSON.stringify(p);
      expect(flat).not.toContain("GOODCODE");
      expect(flat).not.toContain("casey");
    }
  });
});
