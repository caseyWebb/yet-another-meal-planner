import { describe, it, expect } from "vitest";
import {
  requireAccess,
  onboard,
  rotate,
  revoke,
  listTenants,
  handleAdmin,
  TENANT_TABLES,
  AUTHOR_TABLES,
  type AdminDeps,
} from "../src/admin.js";
import type { Env } from "../src/env.js";
import type { Db } from "../src/db.js";
import type { KvStore } from "../src/kroger-user.js";

/** In-memory KV with get/put/delete/list (single page) — satisfies KVNamespace + KvStore. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) { return m.get(key) ?? null; },
    async put(key: string, value: string) { m.set(key, value); },
    async delete(key: string) { m.delete(key); },
    async list({ prefix = "", cursor }: { prefix?: string; cursor?: string } = {}) {
      void cursor;
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

/** Fake Db that records every batched statement so the revoke purge is assertable. */
function fakeDb(): { db: Db; batches: { sql: string; binds: unknown[] }[][] } {
  const batches: { sql: string; binds: unknown[] }[][] = [];
  const db = {
    prepare(sql: string, ...binds: unknown[]) {
      return { sql, binds } as unknown as D1PreparedStatement;
    },
    async batch(stmts: D1PreparedStatement[]) {
      batches.push(stmts.map((s) => s as unknown as { sql: string; binds: unknown[] }));
    },
    async first() { return null; },
    async all() { return []; },
    async run() { return { changes: 0 }; },
  } as unknown as Db;
  return { db, batches };
}

function makeDeps(initial: Record<string, string> = {}) {
  const tenantKv = memKv(initial);
  const krogerKv = memKv();
  const { db, batches } = fakeDb();
  let n = 0;
  const deps: AdminDeps = {
    tenantKv,
    krogerKv: krogerKv as unknown as KvStore,
    db,
    randomCode: () => `code${n++}`,
  };
  return { deps, tenantKv, krogerKv, batches };
}

describe("requireAccess", () => {
  const accessEnv = (over: Partial<Env>): Env => ({ ...over }) as unknown as Env;

  it("is disabled (404) when Access is unconfigured and no dev bypass", async () => {
    const r = await requireAccess(new Request("https://x/admin"), accessEnv({}));
    expect(r.status).toBe("disabled");
  });

  it("admits via the dev bypass only when Access is unconfigured", async () => {
    const r = await requireAccess(new Request("https://x/admin"), accessEnv({ ADMIN_DEV_BYPASS: "1" }));
    expect(r.status).toBe("ok");
  });

  it("denies a configured surface presenting no assertion (no JWKS fetch)", async () => {
    let fetched = false;
    const env = accessEnv({ ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud123" });
    const r = await requireAccess(new Request("https://x/admin"), env, () => {
      fetched = true;
      throw new Error("JWKS must not be fetched");
    });
    expect(r.status).toBe("denied");
    expect(fetched).toBe(false);
  });

  it("denies a malformed assertion (jose rejects the compact JWS, no key fetch)", async () => {
    // "not-a-jwt" fails compact-JWS parsing before the remote JWKS is consulted, so
    // the default key set never reaches the network — the verify simply throws → denied.
    const env = accessEnv({ ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud123" });
    const req = new Request("https://x/admin", { headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" } });
    const r = await requireAccess(req, env);
    expect(r.status).toBe("denied");
  });
});

describe("onboard", () => {
  it("writes the allowlist entry + invite (canonical lowercase), generating a code", async () => {
    const { deps, tenantKv } = makeDeps();
    const r = await onboard(deps, "Casey");
    expect(r).toEqual({ username: "casey", invite_code: "code0" });
    expect(await tenantKv.get("tenant:casey")).toBe(JSON.stringify({ id: "casey" }));
    expect(await tenantKv.get("invite:code0")).toBe("casey");
  });

  it("honors a supplied invite code", async () => {
    const { deps, tenantKv } = makeDeps();
    const r = await onboard(deps, "bob", "LET-ME-IN");
    expect(r.invite_code).toBe("LET-ME-IN");
    expect(await tenantKv.get("invite:LET-ME-IN")).toBe("bob");
  });

  it("rejects an empty username", async () => {
    const { deps } = makeDeps();
    await expect(onboard(deps, "   ")).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("listTenants", () => {
  it("returns canonical ids, sorted, ignoring non-tenant keys", async () => {
    const { deps } = makeDeps({
      "tenant:casey": JSON.stringify({ id: "casey" }),
      "tenant:alice": JSON.stringify({ id: "alice" }),
      "invite:CODE": "casey",
    });
    expect(await listTenants(deps)).toEqual({ tenants: ["alice", "casey"] });
  });
});

describe("rotate", () => {
  it("mints a new code and deletes the prior invite, leaving the allowlist entry", async () => {
    const { deps, tenantKv } = makeDeps();
    await onboard(deps, "casey", "OLD"); // code stays OLD
    const r = await rotate(deps, "Casey");
    expect(r.username).toBe("casey");
    expect(r.invite_code).toBe("code0");
    expect(await tenantKv.get("invite:OLD")).toBeNull();
    expect(await tenantKv.get("invite:code0")).toBe("casey");
    expect(await tenantKv.get("tenant:casey")).toBe(JSON.stringify({ id: "casey" }));
  });

  it("errors for a member not on the allowlist", async () => {
    const { deps } = makeDeps();
    await expect(rotate(deps, "ghost")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("revoke", () => {
  it("purges the allowlist entry, invites, Kroger token, and per-tenant D1 rows", async () => {
    const { deps, tenantKv, krogerKv, batches } = makeDeps();
    await onboard(deps, "casey", "X");
    await krogerKv.put("kroger:refresh:casey", "tok");

    const r = await revoke(deps, "Casey");
    expect(r).toEqual({ username: "casey", revoked: true, invites_removed: 1 });

    expect(await tenantKv.get("tenant:casey")).toBeNull();
    expect(await tenantKv.get("invite:X")).toBeNull();
    expect(await krogerKv.get("kroger:refresh:casey")).toBeNull();

    expect(batches).toHaveLength(1);
    const sqls = batches[0].map((s) => s.sql);
    for (const t of TENANT_TABLES) expect(sqls).toContain(`DELETE FROM ${t} WHERE tenant = ?1`);
    for (const t of AUTHOR_TABLES) expect(sqls).toContain(`DELETE FROM ${t} WHERE author = ?1`);
    expect(batches[0].every((s) => s.binds[0] === "casey")).toBe(true);
  });
});

describe("handleAdmin (routing + gate)", () => {
  const throwingD1 = () => ({}) as unknown as Env["DB"];

  it("404s when the surface is disabled", async () => {
    const env = { TENANT_KV: memKv(), KROGER_KV: memKv(), DB: throwingD1() } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/api/tenants"), env);
    expect(res.status).toBe(404);
  });

  it("403s when Access is configured but no assertion is present", async () => {
    const env = {
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: throwingD1(),
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_AUD: "aud123",
    } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/api/tenants"), env);
    expect(res.status).toBe(403);
  });

  it("onboards via POST, returning the code once + the origin-derived connector URL", async () => {
    const tenantKv = memKv();
    const env = {
      TENANT_KV: tenantKv,
      KROGER_KV: memKv(),
      DB: throwingD1(),
      ADMIN_DEV_BYPASS: "1",
    } as unknown as Env;
    const res = await handleAdmin(
      new Request("https://groc.example.com/admin/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "Casey" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; invite_code: string; connector_url: string };
    expect(body.username).toBe("casey");
    expect(body.invite_code).toMatch(/^[0-9a-f]{16}$/);
    expect(body.connector_url).toBe("https://groc.example.com/mcp");
    expect(await tenantKv.get("tenant:casey")).toBe(JSON.stringify({ id: "casey" }));
  });

  it("lists members via GET", async () => {
    const env = {
      TENANT_KV: memKv({ "tenant:bob": JSON.stringify({ id: "bob" }) }),
      KROGER_KV: memKv(),
      DB: throwingD1(),
      ADMIN_DEV_BYPASS: "1",
    } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/api/tenants"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenants: ["bob"] });
  });

  it("serves the SPA shell from ASSETS with the path unchanged (no /index.html rewrite → no redirect loop)", async () => {
    let askedPath = "";
    const env = {
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: throwingD1(),
      ADMIN_DEV_BYPASS: "1",
      ASSETS: {
        fetch: async (req: Request) => {
          askedPath = new URL(req.url).pathname;
          return new Response("<html>shell</html>", { status: 200 });
        },
      },
    } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin"), env);
    expect(res.status).toBe(200);
    // Passed through verbatim — NOT rewritten to /admin/index.html (which the assets
    // auto-trailing-slash would 307 back to /admin/, looping via run_worker_first).
    expect(askedPath).toBe("/admin");
  });

  it("serves the SPA shell for an unmatched client route (deep link → 200, URL kept)", async () => {
    const asked: string[] = [];
    const env = {
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: throwingD1(),
      ADMIN_DEV_BYPASS: "1",
      ASSETS: {
        fetch: async (req: Request) => {
          const p = new URL(req.url).pathname;
          asked.push(p);
          // Only the canonical `/admin/` is a real asset; the client route 404s.
          return p === "/admin/"
            ? new Response("<html>shell</html>", { status: 200 })
            : new Response("not found", { status: 404 });
        },
      },
    } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/dev/tools/place_order"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
    // Tried the real path first (404), then fell back to the canonical `/admin/` shell.
    expect(asked).toEqual(["/admin/dev/tools/place_order", "/admin/"]);
  });

  it("keeps a genuine asset 404 (path with a file extension) a 404, not the shell", async () => {
    const asked: string[] = [];
    const env = {
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: throwingD1(),
      ADMIN_DEV_BYPASS: "1",
      ASSETS: {
        fetch: async (req: Request) => {
          asked.push(new URL(req.url).pathname);
          return new Response("not found", { status: 404 });
        },
      },
    } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/elm.js"), env);
    expect(res.status).toBe(404);
    // No shell fallback for an extension path — asked only for the asset itself.
    expect(asked).toEqual(["/admin/elm.js"]);
  });
});

describe("handleAdmin (tool console)", () => {
  const consoleEnv = (extra: Record<string, unknown> = {}) =>
    ({
      TENANT_KV: memKv({ "tenant:bob": JSON.stringify({ id: "bob" }) }),
      KROGER_KV: memKv(),
      DB: {} as unknown as Env["DB"],
      ADMIN_DEV_BYPASS: "1",
      ...extra,
    }) as unknown as Env;

  it("lists the live tool catalog for an allowlisted tenant", async () => {
    const res = await handleAdmin(new Request("https://x/admin/api/tools?tenant=bob"), consoleEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: { name: string }[] };
    const names = body.tools.map((t) => t.name);
    // The catalog is the real buildServer surface — a couple of stable names suffice.
    expect(names).toContain("search_recipes");
    expect(names).toContain("read_recipe");
  });

  it("400s when no acting-as tenant is supplied", async () => {
    const res = await handleAdmin(new Request("https://x/admin/api/tools"), consoleEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_failed");
  });

  it("404s when acting as a non-member", async () => {
    const res = await handleAdmin(
      new Request("https://x/admin/api/tools?tenant=ghost"),
      consoleEnv(),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_found");
  });

  it("404s the tool console when the surface is disabled (no Access config)", async () => {
    const env = { TENANT_KV: memKv(), KROGER_KV: memKv(), DB: {} } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/api/tools?tenant=bob"), env);
    expect(res.status).toBe(404);
  });
});
