import { describe, it, expect } from "vitest";
import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";
import type { KvStore } from "../src/kroger-user.js";
import { redeemAuthNonce } from "../src/oauth.js";
import { fakeD1 } from "./fake-d1.js";

/** In-memory KV (single-page list) — satisfies the bindings the member ops touch. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

/** A minimal Env for the Hono app. `ADMIN_DEV_BYPASS=1` admits on a loopback request host
 *  (a bare `app.request("/admin/...")` is `http://localhost`), exercising the panel offline. */
function makeEnv(over: Partial<Env> = {}, members: string[] = []): Env {
  const kvInit: Record<string, string> = {};
  for (const id of members) kvInit[`tenant:${id}`] = JSON.stringify({ id });
  return {
    ADMIN_DEV_BYPASS: "1",
    TENANT_KV: memKv(kvInit),
    KROGER_KV: memKv(),
    DB: fakeD1().env.DB,
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    ...over,
  } as unknown as Env;
}

describe("admin Hono app", () => {
  it("404s when Access is unconfigured and the host is not loopback", async () => {
    const res = await app.request(
      "https://example.com/admin/members",
      {},
      makeEnv({ ADMIN_DEV_BYPASS: undefined }),
    );
    expect(res.status).toBe(404);
  });

  it("server-renders the members list (SSR via listTenants) under the loopback bypass", async () => {
    const res = await app.request("/admin/members", {}, makeEnv({}, ["casey", "alex"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("casey");
    expect(html).toContain("alex");
    // Links the served stylesheet and bootstraps the island.
    expect(html).toContain("/admin/styles.css");
    expect(html).toContain("/admin/islands/members.js");
  });

  it("lists tenants via the typed GET route", async () => {
    const res = await app.request("/admin/api/tenants", {}, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenants: ["casey"] });
  });

  it("onboards a member, returning the once-shown invite + connector url", async () => {
    const res = await app.request(
      "/admin/api/tenants",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "Casey" }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; invite_code: string; connector_url: string };
    expect(body.username).toBe("casey"); // canonicalized lowercase
    expect(body.invite_code).toMatch(/^[0-9a-f]{16}$/);
    expect(body.connector_url).toBe("http://localhost/mcp");
  });

  it("surfaces a structured validation error as 400 (data, not a 500)", async () => {
    const res = await app.request(
      "/admin/api/tenants",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "" }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
  });

  it("revokes a member via the typed DELETE route", async () => {
    const res = await app.request(
      "/admin/api/tenants/casey",
      { method: "DELETE" },
      makeEnv({}, ["casey"]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: "casey", revoked: true });
  });

  it("mints a redeemable Kroger consent link for an allowlisted member", async () => {
    const env = makeEnv({}, ["casey"]);
    const res = await app.request("/admin/api/tenants/casey/kroger-login", { method: "POST" }, env);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const nonce = new URL(url).searchParams.get("nonce")!;
    expect(await redeemAuthNonce(env.KROGER_KV as unknown as KvStore, nonce)).toBe("casey");
  });

  it("404s a Kroger consent link for a non-allowlisted member", async () => {
    const res = await app.request("/admin/api/tenants/ghost/kroger-login", { method: "POST" }, makeEnv());
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "not_found" });
  });
});
