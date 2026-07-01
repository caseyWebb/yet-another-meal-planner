import { describe, it, expect } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import {
  requireAccess,
  adminPosture,
  onboard,
  rotate,
  revoke,
  listTenants,
  TENANT_TABLES,
  AUTHOR_TABLES,
  type AdminDeps,
  type TenantRosterRow,
} from "../src/admin.js";
import { handleAdmin } from "./admin-request.js";
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

/** Seed data the `listTenants` aggregate queries read (tenant_activity, cooking_log, overlay). */
interface FakeRosterData {
  activity?: { tenant: string; first_seen_at: number; last_seen_at: number }[];
  cooked?: { tenant: string; n: number }[];
  favorites?: { tenant: string; n: number }[];
}

/** Fake Db that records every batched statement so the revoke purge is assertable, and
 *  answers the `listTenants` roster aggregate reads (tenant_activity / cooking_log /
 *  overlay GROUP BY) from injected fixture rows — exercising the SAME single-query-per-
 *  aggregate shape `listTenants` issues, without a live D1. */
function fakeDb(seed: FakeRosterData = {}): { db: Db; batches: { sql: string; binds: unknown[] }[][] } {
  const batches: { sql: string; binds: unknown[] }[][] = [];
  const db = {
    prepare(sql: string, ...binds: unknown[]) {
      return { sql, binds } as unknown as D1PreparedStatement;
    },
    async batch(stmts: D1PreparedStatement[]) {
      batches.push(stmts.map((s) => s as unknown as { sql: string; binds: unknown[] }));
    },
    async first() { return null; },
    async all(sql: string) {
      if (/FROM tenant_activity/i.test(sql)) return seed.activity ?? [];
      if (/FROM cooking_log/i.test(sql)) return seed.cooked ?? [];
      if (/FROM overlay/i.test(sql)) return seed.favorites ?? [];
      return [];
    },
    async run() { return { changes: 0 }; },
  } as unknown as Db;
  return { db, batches };
}

function makeDeps(initial: Record<string, string> = {}, rosterSeed: FakeRosterData = {}) {
  const tenantKv = memKv(initial);
  const krogerKv = memKv();
  const { db, batches } = fakeDb(rosterSeed);
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
  const configured = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud123" };

  // Mint a real RS256 assertion and a `getKeySet` resolving to its public key, so the
  // post-verify email-allowlist branch is exercised offline (no remote JWKS fetch).
  async function signed(claims: Record<string, unknown>) {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://team.cloudflareaccess.com")
      .setAudience("aud123")
      .sign(privateKey);
    const getKeySet = (() => async () => publicKey) as unknown as Parameters<typeof requireAccess>[2];
    return { token, getKeySet };
  }
  const withToken = (token: string) =>
    new Request("https://x/admin", { headers: { "Cf-Access-Jwt-Assertion": token } });

  it("is disabled (404) when Access is unconfigured and no dev bypass", async () => {
    const r = await requireAccess(new Request("https://x/admin"), accessEnv({}));
    expect(r.status).toBe("disabled");
  });

  it("admits via the dev bypass on a loopback host when Access is unconfigured", async () => {
    const r = await requireAccess(new Request("http://localhost/admin"), accessEnv({ ADMIN_DEV_BYPASS: "1" }));
    expect(r.status).toBe("ok");
  });

  it("does NOT admit via the dev bypass on a non-loopback (deployed) host, even with the flag", async () => {
    const r = await requireAccess(
      new Request("https://grocery.example.com/admin"),
      accessEnv({ ADMIN_DEV_BYPASS: "1" }),
    );
    expect(r.status).toBe("disabled");
  });

  it("denies a configured surface presenting no assertion (no JWKS fetch)", async () => {
    let fetched = false;
    const env = accessEnv(configured);
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
    const env = accessEnv(configured);
    const req = new Request("https://x/admin", { headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" } });
    const r = await requireAccess(req, env);
    expect(r.status).toBe("denied");
  });

  it("admits any verified assertion when no allowlist is set", async () => {
    const { token, getKeySet } = await signed({ email: "anyone@example.com" });
    const r = await requireAccess(withToken(token), accessEnv(configured), getKeySet);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.email).toBe("anyone@example.com");
  });

  it("admits a verified assertion whose email is on the allowlist (case-insensitive)", async () => {
    const { token, getKeySet } = await signed({ email: "Op@Example.com" });
    const env = accessEnv({ ...configured, ACCESS_ALLOWED_EMAILS: "other@x.com, op@example.com" });
    const r = await requireAccess(withToken(token), env, getKeySet);
    expect(r.status).toBe("ok");
  });

  it("denies a verified assertion whose email is off the allowlist", async () => {
    const { token, getKeySet } = await signed({ email: "intruder@evil.com" });
    const env = accessEnv({ ...configured, ACCESS_ALLOWED_EMAILS: "op@example.com" });
    const r = await requireAccess(withToken(token), env, getKeySet);
    expect(r.status).toBe("denied");
  });

  it("denies a verified assertion with no email claim when an allowlist is set", async () => {
    const { token, getKeySet } = await signed({ sub: "no-email" });
    const env = accessEnv({ ...configured, ACCESS_ALLOWED_EMAILS: "op@example.com" });
    const r = await requireAccess(withToken(token), env, getKeySet);
    expect(r.status).toBe("denied");
  });
});

describe("adminPosture", () => {
  const env = (over: Partial<Env>): Env => ({ ...over }) as unknown as Env;

  it("reports gated when Access is configured (with allowlist flag), never exposed", () => {
    expect(
      adminPosture(env({ ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "a", ACCESS_ALLOWED_EMAILS: "x@y.com" })),
    ).toEqual({ access_configured: true, email_allowlist: true, dev_bypass_set: false, exposed: false });
  });

  it("flags exposed when the dev bypass is set without Access (only the loopback guard protects it)", () => {
    expect(adminPosture(env({ ADMIN_DEV_BYPASS: "1" }))).toEqual({
      access_configured: false,
      email_allowlist: false,
      dev_bypass_set: true,
      exposed: true,
    });
  });

  it("is not exposed when unconfigured without the bypass (safe 404 surface)", () => {
    expect(adminPosture(env({})).exposed).toBe(false);
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
  const env = (over: Partial<Env> = {}): Env => ({ ...over }) as unknown as Env;
  const byId = (rows: TenantRosterRow[], id: string) => rows.find((r) => r.id === id);

  it("returns structured rows, sorted by id, ignoring non-tenant keys", async () => {
    const { deps } = makeDeps({
      "tenant:casey": JSON.stringify({ id: "casey" }),
      "tenant:alice": JSON.stringify({ id: "alice" }),
      "invite:CODE": "casey",
    });
    const { tenants } = await listTenants(env(), deps);
    expect(tenants.map((t) => t.id)).toEqual(["alice", "casey"]);
  });

  it("derives active vs pending from tenant_activity presence", async () => {
    const { deps } = makeDeps(
      { "tenant:casey": JSON.stringify({ id: "casey" }), "tenant:noor": JSON.stringify({ id: "noor" }) },
      { activity: [{ tenant: "casey", first_seen_at: 100, last_seen_at: 200 }] },
    );
    const { tenants } = await listTenants(env(), deps);
    expect(byId(tenants, "casey")).toMatchObject({ status: "active", joined: 100, lastActive: 200 });
    expect(byId(tenants, "noor")).toMatchObject({ status: "pending", joined: null, lastActive: null });
  });

  it("derives the owner flag from OWNER_TENANT_ID (case/whitespace-normalized), no owner when unset", async () => {
    const { deps } = makeDeps({
      "tenant:casey": JSON.stringify({ id: "casey" }),
      "tenant:alice": JSON.stringify({ id: "alice" }),
    });
    const owned = await listTenants(env({ OWNER_TENANT_ID: " Casey " }), deps);
    expect(byId(owned.tenants, "casey")?.owner).toBe(true);
    expect(byId(owned.tenants, "alice")?.owner).toBe(false);

    const unowned = await listTenants(env(), deps);
    expect(unowned.tenants.every((t) => t.owner === false)).toBe(true);
  });

  it("derives Kroger-linked status from a single prefix list over KROGER_KV (no per-tenant get)", async () => {
    const { deps, krogerKv } = makeDeps({
      "tenant:casey": JSON.stringify({ id: "casey" }),
      "tenant:alice": JSON.stringify({ id: "alice" }),
    });
    await krogerKv.put("kroger:refresh:casey", "tok");
    let gets = 0;
    const countingKv = { ...krogerKv, get: (...a: Parameters<typeof krogerKv.get>) => { gets++; return krogerKv.get(...a); } };
    const { tenants } = await listTenants(env(), { ...deps, krogerKv: countingKv as unknown as AdminDeps["krogerKv"] });
    expect(byId(tenants, "casey")?.kroger).toBe("linked");
    expect(byId(tenants, "alice")?.kroger).toBe("unlinked");
    expect(gets).toBe(0); // the Kroger-linked check is a list, never a per-tenant get
  });

  it("derives cooked/favorites from one batched GROUP BY aggregate each, not per-tenant", async () => {
    const { deps } = makeDeps(
      { "tenant:casey": JSON.stringify({ id: "casey" }), "tenant:alice": JSON.stringify({ id: "alice" }) },
      { cooked: [{ tenant: "casey", n: 12 }], favorites: [{ tenant: "casey", n: 3 }, { tenant: "alice", n: 1 }] },
    );
    const { tenants } = await listTenants(env(), deps);
    expect(byId(tenants, "casey")).toMatchObject({ cooked: 12, favorites: 3 });
    expect(byId(tenants, "alice")).toMatchObject({ cooked: 0, favorites: 1 });
  });

  it("assembles a full roster row from every source at once", async () => {
    const { deps, krogerKv } = makeDeps(
      { "tenant:casey": JSON.stringify({ id: "casey" }) },
      {
        activity: [{ tenant: "casey", first_seen_at: 1000, last_seen_at: 2000 }],
        cooked: [{ tenant: "casey", n: 5 }],
        favorites: [{ tenant: "casey", n: 2 }],
      },
    );
    await krogerKv.put("kroger:refresh:casey", "tok");
    const { tenants } = await listTenants(env({ OWNER_TENANT_ID: "casey" }), deps);
    expect(tenants).toEqual([
      { id: "casey", owner: true, status: "active", kroger: "linked", joined: 1000, lastActive: 2000, cooked: 5, favorites: 2 },
    ]);
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
      new Request("http://localhost/admin/api/tenants", {
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
    expect(body.connector_url).toBe("http://localhost/mcp");
    expect(await tenantKv.get("tenant:casey")).toBe(JSON.stringify({ id: "casey" }));
  });

  it("lists members via GET, as structured roster rows", async () => {
    // A real D1Database-shaped fake (not the src/db.ts `Db` wrapper): `prepare` returns a
    // chainable stmt whose `first`/`all`/`run` all resolve empty, so every `listTenants`
    // aggregate read (tenant_activity / cooking_log / overlay) comes back empty without error.
    const emptyAggDb = {
      prepare() {
        const stmt = {
          bind: () => stmt,
          first: async () => null,
          all: async () => ({ results: [], success: true, meta: { changes: 0 } }),
          run: async () => ({ success: true, meta: { changes: 0 } }),
        };
        return stmt as unknown as D1PreparedStatement;
      },
      async batch() { return []; },
    } as unknown as Env["DB"];
    const env = {
      TENANT_KV: memKv({ "tenant:bob": JSON.stringify({ id: "bob" }) }),
      KROGER_KV: memKv(),
      DB: emptyAggDb,
      ADMIN_DEV_BYPASS: "1",
    } as unknown as Env;
    const res = await handleAdmin(new Request("http://localhost/admin/api/tenants"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenants: [{ id: "bob", owner: false, status: "pending", kroger: "unlinked", joined: null, lastActive: null, cooked: 0, favorites: 0 }],
    });
  });

  // Bug reports are surfaced by the Hono data explorer (the `bug_reports` system table), not a
  // dedicated JSON route; covered by report-bug.test.ts + admin-data-views.test.ts.
  // The SPA shell is gone — the Hono app SSRs every page — so only a genuine asset miss falls
  // through to ASSETS (still 404, the gate already passed):

  it("keeps a genuine asset 404 (no SSR route → ASSETS fallthrough → 404)", async () => {
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
    const res = await handleAdmin(new Request("http://localhost/admin/islands/nonexistent.js"), env);
    expect(res.status).toBe(404);
    // No SSR route matched, so the request fell through to ASSETS — asked for the asset itself.
    expect(asked).toEqual(["/admin/islands/nonexistent.js"]);
  });
});
