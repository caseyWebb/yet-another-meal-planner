import { describe, it, expect, vi } from "vitest";
import {
  resolveTenant,
  resolveIdentity,
  resolveInvite,
  inviteAccepted,
  inviteGraceEnabled,
  tenantFromRecord,
  kvTenantStore,
  normalizeTenantId,
  touchTenantActivity,
  type TenantRecord,
  type TenantStore,
  type Unauthorized,
  type Tenant,
} from "../src/tenant.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";
import { db } from "../src/db.js";

/** An env whose D1 carries a seeded `members` table (the resolver's liveness check).
 *  Rows are `{ id, tenant, handle, created_at }`; default empty (the lazy guard mints). */
function membersEnv(members: Record<string, unknown>[] = []) {
  return fakeD1({ tables: { members, tenant_activity: [] } });
}

const env = membersEnv().env;

const ALICE: TenantRecord = { id: "alice" };

function store(records: Record<string, TenantRecord>): TenantStore {
  return {
    async get(id) { return records[id] ?? null; },
    async list() { return Object.keys(records); },
  };
}

/** In-memory KV holding `tenant:<id>` allowlist entries + `invite:<code>` codes. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) { return m.get(key) ?? null; },
    async list({ prefix = "", cursor }: { prefix?: string; cursor?: string } = {}) {
      void cursor;
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

const isUnauthorized = (r: Tenant | Unauthorized): r is Unauthorized =>
  (r as Unauthorized).error === "unauthorized";

describe("resolveTenant (from a provider-validated tenantId)", () => {
  it("builds the Tenant from the allowlisted id, defaulting to the founding member", async () => {
    const t = (await resolveTenant(env, "alice", store({ alice: ALICE }))) as Tenant;
    expect(isUnauthorized(t)).toBe(false);
    expect(t).toEqual({ id: "alice", member: "alice" });
  });

  it("rejects a missing tenantId", async () => {
    expect(isUnauthorized(await resolveTenant(env, undefined, store({ alice: ALICE })))).toBe(true);
    expect(isUnauthorized(await resolveTenant(env, "", store({ alice: ALICE })))).toBe(true);
  });

  it("rejects a tenantId absent from the allowlist", async () => {
    expect(isUnauthorized(await resolveTenant(env, "ghost", store({ alice: ALICE })))).toBe(true);
  });

  it("resolves a mixed-case tenantId to the canonical lowercase id + allowlist entry", async () => {
    // The bug: a member granted "Casey" but whose allowlist key is "casey". A
    // case-sensitive resolve missed the entry (empty) — silent data loss.
    // The allowlist key is the canonical lowercase form (as the admin onboard mints).
    const dir = store({ casey: { id: "casey" } });
    for (const given of ["Casey", "CASEY", "casey", "  Casey  "]) {
      const t = (await resolveTenant(env, given, dir)) as Tenant;
      expect(isUnauthorized(t)).toBe(false);
      expect(t.id).toBe("casey");
    }
  });

  it("isolates tenants: distinct ids over the shared corpus", async () => {
    const dir = store({ alice: { id: "alice" }, bob: { id: "bob" } });
    const a = (await resolveTenant(env, "alice", dir)) as Tenant;
    const b = (await resolveTenant(env, "bob", dir)) as Tenant;
    expect(a.id).toBe("alice");
    expect(b.id).toBe("bob"); // distinct tenant identity
  });
});

describe("tenantFromRecord", () => {
  it("normalizes the record id into the Tenant, defaulting member to the founding member", () => {
    expect(tenantFromRecord(env, { id: "Bob" })).toEqual({ id: "bob", member: "bob" });
    expect(tenantFromRecord(env, { id: "Bob" }, "m1")).toEqual({ id: "bob", member: "m1" });
  });
});

describe("resolveIdentity (the shared (tenantId, memberId) resolver)", () => {
  const CASEY_ROW = { id: "casey", tenant: "casey", handle: "casey", created_at: 1 };

  it("pre-split props { tenantId } resolve to the founding member (legacy defaulting)", async () => {
    const fake = membersEnv([CASEY_ROW]);
    const t = (await resolveIdentity(fake.env, "casey", undefined, store({ casey: { id: "casey" } }))) as Tenant;
    expect(t).toEqual({ id: "casey", member: "casey" });
  });

  it("resolves an explicit { tenantId, memberId } pair exactly", async () => {
    const fake = membersEnv([
      CASEY_ROW,
      { id: "m2", tenant: "casey", handle: "pat", created_at: 2 },
    ]);
    const t = (await resolveIdentity(fake.env, "casey", "m2", store({ casey: { id: "casey" } }))) as Tenant;
    expect(t).toEqual({ id: "casey", member: "m2" });
  });

  it("rejects a revoked member while the tenant survives — no resurrection when other rows exist", async () => {
    // Only m2 remains: the founding member was revoked. Presenting the founding id must NOT
    // re-mint it (the lazy guard requires ZERO member rows), and m3 never existed.
    const fake = membersEnv([{ id: "m2", tenant: "casey", handle: "pat", created_at: 2 }]);
    const dir = store({ casey: { id: "casey" } });
    expect(isUnauthorized(await resolveIdentity(fake.env, "casey", "casey", dir))).toBe(true);
    expect(isUnauthorized(await resolveIdentity(fake.env, "casey", "m3", dir))).toBe(true);
    // Nothing was minted by either rejection.
    expect(fake.tables.members).toHaveLength(1);
  });

  it("converges a zero-member tenant via the lazy founding-member guard", async () => {
    const fake = membersEnv([]);
    const t = (await resolveIdentity(fake.env, "casey", "casey", store({ casey: { id: "casey" } }))) as Tenant;
    expect(t).toEqual({ id: "casey", member: "casey" });
    expect(fake.tables.members).toEqual([
      expect.objectContaining({ id: "casey", tenant: "casey", handle: "casey" }),
    ]);
  });

  it("never reaches the guard for a purged tenant — the allowlist re-check fails first", async () => {
    const fake = membersEnv([]);
    expect(isUnauthorized(await resolveIdentity(fake.env, "casey", "casey", store({})))).toBe(true);
    expect(fake.tables.members).toEqual([]); // nothing minted
  });

  it("canonicalizes a mixed-case tenant id before every lookup (directory AND members)", async () => {
    const fake = membersEnv([CASEY_ROW]);
    const dir = store({ casey: { id: "casey" } });
    for (const given of ["Casey", "CASEY", "  casey "]) {
      const t = (await resolveIdentity(fake.env, given, undefined, dir)) as Tenant;
      expect(t).toEqual({ id: "casey", member: "casey" });
    }
    expect(fake.tables.members).toHaveLength(1); // liveness hit the seeded row; no re-mint
  });
});

describe("resolveInvite (the §3.2 identity step)", () => {
  it("maps a valid legacy (bare-string) code to its allowlisted username", async () => {
    const kv = memKv({ "invite:LET-ME-IN": "alice", "tenant:alice": JSON.stringify(ALICE) });
    expect(await resolveInvite(kv, "LET-ME-IN")).toEqual({ tenant: "alice", member: "alice", kind: "legacy" });
  });

  it("maps a JSON bootstrap code to its allowlisted username", async () => {
    const kv = memKv({
      "invite:BOOT": JSON.stringify({ v: 1, tenant: "alice", single_use: true, expires_at: 0 }),
      "tenant:alice": JSON.stringify(ALICE),
    });
    expect(await resolveInvite(kv, "BOOT")).toEqual({ tenant: "alice", member: "alice", kind: "bootstrap" });
  });

  it("returns null for an unknown code", async () => {
    const kv = memKv({ "tenant:alice": JSON.stringify(ALICE) });
    expect(await resolveInvite(kv, "nope")).toBeNull();
  });

  it("returns null when the code maps to a username not on the allowlist", async () => {
    // Code exists but the tenant directory entry was revoked.
    const kv = memKv({ "invite:STALE": "ghost" });
    expect(await resolveInvite(kv, "STALE")).toBeNull();
  });

  it("returns null for an empty code", async () => {
    expect(await resolveInvite(memKv(), "")).toBeNull();
  });

  it("returns the canonical lowercase username even if the invite maps to mixed case", async () => {
    // Allowlist keyed lowercase (as minted); a stray mixed-case invite target still
    // resolves to the canonical id via the lowercase directory lookup.
    const kv = memKv({ "invite:CODE": "Casey", "tenant:casey": JSON.stringify({ id: "casey" }) });
    expect(await resolveInvite(kv, "CODE")).toEqual({ tenant: "casey", member: "casey", kind: "legacy" });
  });
});

describe("normalizeTenantId", () => {
  it("lowercases and trims to the canonical id", () => {
    expect(normalizeTenantId("Casey")).toBe("casey");
    expect(normalizeTenantId("CASEY")).toBe("casey");
    expect(normalizeTenantId("  Casey  ")).toBe("casey");
    expect(normalizeTenantId("casey")).toBe("casey");
  });
});

describe("kvTenantStore", () => {
  it("reads a record under tenant:<id>, null for unknown/malformed", async () => {
    const s = kvTenantStore(memKv({ "tenant:alice": JSON.stringify(ALICE), "tenant:broken": "{ not json" }));
    expect(await s.get("alice")).toEqual(ALICE);
    expect(await s.get("nobody")).toBeNull();
    expect(await s.get("broken")).toBeNull();
  });

  it("looks up the lowercase key and canonicalizes the returned id", async () => {
    // Allowlist key is the canonical lowercase form; any casing of the lookup id
    // (the grant prop) must find it and resolve to the lowercase canonical id.
    const s = kvTenantStore(memKv({ "tenant:casey": JSON.stringify({ id: "casey" }) }));
    expect(await s.get("Casey")).toEqual({ id: "casey" });
    expect(await s.get("CASEY")).toEqual({ id: "casey" });
    // Even a stored mixed-case id is canonicalized on read (defensive).
    const s2 = kvTenantStore(memKv({ "tenant:casey": JSON.stringify({ id: "Casey" }) }));
    expect((await s2.get("casey"))?.id).toBe("casey");
  });

  it("lists every tenant id (the §8.2 group enumeration), ignoring non-tenant keys", async () => {
    const s = kvTenantStore(
      memKv({
        "tenant:alice": JSON.stringify(ALICE),
        "tenant:bob": JSON.stringify({ id: "bob" }),
        "invite:CODE": "alice",
      }),
    );
    expect((await s.list()).sort()).toEqual(["alice", "bob"]);
  });

  it("canonicalizes enumerated ids (a mixed-case directory key lists as lowercase)", async () => {
    // Group-aggregation tools derive users/<id>/... paths and profile:<id> keys
    // from list(); a non-canonical key must not leak its casing downstream.
    const s = kvTenantStore(memKv({ "tenant:Casey": JSON.stringify({ id: "Casey" }) }));
    expect(await s.list()).toEqual(["casey"]);
  });
});

describe("touchTenantActivity (admin-ui-redesign-members: throttled last-seen)", () => {
  function fakeEnv() {
    const fake = fakeD1({ tables: { tenant_activity: [] } });
    return fake.env;
  }

  it("writes first_seen_at and last_seen_at on the first touch", async () => {
    const e = fakeEnv();
    await touchTenantActivity(e, "casey", 1000);
    const row = await db(e).first<{ first_seen_at: number; last_seen_at: number }>(
      "SELECT first_seen_at, last_seen_at FROM tenant_activity WHERE tenant = ?1",
      "casey",
    );
    expect(row).toMatchObject({ first_seen_at: 1000, last_seen_at: 1000 });
  });

  it("does NOT re-write last_seen_at within the throttle window", async () => {
    const e = fakeEnv();
    await touchTenantActivity(e, "casey", 1000);
    await touchTenantActivity(e, "casey", 1000 + 30 * 60 * 1000); // 30 minutes later
    const row = await db(e).first<{ first_seen_at: number; last_seen_at: number }>(
      "SELECT first_seen_at, last_seen_at FROM tenant_activity WHERE tenant = ?1",
      "casey",
    );
    expect(row).toMatchObject({ first_seen_at: 1000, last_seen_at: 1000 }); // unchanged — still within the hour window
  });

  it("DOES refresh last_seen_at once the throttle window has elapsed, leaving first_seen_at untouched", async () => {
    const e = fakeEnv();
    await touchTenantActivity(e, "casey", 1000);
    const later = 1000 + 61 * 60 * 1000; // just past 1 hour
    await touchTenantActivity(e, "casey", later);
    const row = await db(e).first<{ first_seen_at: number; last_seen_at: number }>(
      "SELECT first_seen_at, last_seen_at FROM tenant_activity WHERE tenant = ?1",
      "casey",
    );
    expect(row).toMatchObject({ first_seen_at: 1000, last_seen_at: later });
  });

  it("is best-effort: a storage failure never throws", async () => {
    const throwing = {
      DB: {
        prepare() {
          throw new Error("boom");
        },
      },
    } as unknown as Env;
    await expect(touchTenantActivity(throwing, "casey")).resolves.toBeUndefined();
  });

  it("logs a structured warning on a swallowed write failure, so it is diagnosable (not silent)", async () => {
    const throwing = {
      DB: {
        prepare() {
          throw new Error("boom");
        },
      },
    } as unknown as Env;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await touchTenantActivity(throwing, "casey");
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0];
      expect(String(message)).toContain("touchTenantActivity");
      expect(String(message)).toContain("casey");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("resolveTenant recordSeen (admin-ui-redesign-members)", () => {
  it("touches tenant_activity only when recordSeen is true", async () => {
    const fake = fakeD1({ tables: { tenant_activity: [] } });
    const dir = store({ casey: { id: "casey" } });

    await resolveTenant(fake.env, "casey", dir, false);
    expect(await db(fake.env).all("SELECT * FROM tenant_activity")).toEqual([]);

    await resolveTenant(fake.env, "casey", dir, true);
    // Fire-and-forget: give the un-awaited touch a microtask tick to land.
    await new Promise((r) => setTimeout(r, 0));
    expect(await db(fake.env).all("SELECT * FROM tenant_activity")).toHaveLength(1);
  });

  it("defaults recordSeen to false (operator-driven resolutions don't count as activity)", async () => {
    const fake = fakeD1({ tables: { tenant_activity: [] } });
    const dir = store({ casey: { id: "casey" } });
    await resolveTenant(fake.env, "casey", dir);
    await new Promise((r) => setTimeout(r, 0));
    expect(await db(fake.env).all("SELECT * FROM tenant_activity")).toEqual([]);
  });
});

describe("invite grace control (webauthn-passkey-auth)", () => {
  const on = (override?: string) => ({ INVITE_GRACE: override } as unknown as Env);

  it("grace defaults on when INVITE_GRACE is unset", () => {
    expect(inviteGraceEnabled({} as Env)).toBe(true);
  });

  it("grace is on for any value other than 'off'", () => {
    expect(inviteGraceEnabled(on("on"))).toBe(true);
    expect(inviteGraceEnabled(on("anything"))).toBe(true);
  });

  it("grace is off only for exactly 'off'", () => {
    expect(inviteGraceEnabled(on("off"))).toBe(false);
  });

  it("a bootstrap code is accepted regardless of grace (the recovery bypass)", () => {
    const boot = { tenant: "alice", member: "alice", kind: "bootstrap" } as const;
    expect(inviteAccepted(boot, on("off"))).toBe(true);
    expect(inviteAccepted(boot, {} as Env)).toBe(true);
  });

  it("a legacy code is accepted only while grace is on", () => {
    const legacy = { tenant: "alice", member: "alice", kind: "legacy" } as const;
    expect(inviteAccepted(legacy, {} as Env)).toBe(true);
    expect(inviteAccepted(legacy, on("off"))).toBe(false);
  });
});
