import { describe, it, expect } from "vitest";
import {
  resolveTenant,
  resolveInvite,
  tenantFromRecord,
  kvTenantStore,
  normalizeTenantId,
  type TenantRecord,
  type TenantStore,
  type Unauthorized,
  type Tenant,
} from "../src/tenant.js";
import type { Env } from "../src/env.js";

const env = {
  DATA_OWNER: "caseyWebb",
  DATA_REPO: "grocery-data",
  DATA_REF: "main",
  GITHUB_INSTALLATION_ID: "42",
} as unknown as Env;

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
  it("builds the Tenant, joining data-repo coords from env", async () => {
    const t = (await resolveTenant(env, "alice", store({ alice: ALICE }))) as Tenant;
    expect(isUnauthorized(t)).toBe(false);
    expect(t.id).toBe("alice");
    expect(t.dataRepo).toEqual({ owner: "caseyWebb", repo: "grocery-data", ref: "main" });
    expect(t.installationId).toBe("42");
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
    // The allowlist key is the canonical lowercase form (as data-onboard.yml mints).
    const dir = store({ casey: { id: "casey" } });
    for (const given of ["Casey", "CASEY", "casey", "  Casey  "]) {
      const t = (await resolveTenant(env, given, dir)) as Tenant;
      expect(isUnauthorized(t)).toBe(false);
      expect(t.id).toBe("casey");
    }
  });

  it("isolates tenants: distinct ids over the one shared repo", async () => {
    const dir = store({ alice: { id: "alice" }, bob: { id: "bob" } });
    const a = (await resolveTenant(env, "alice", dir)) as Tenant;
    const b = (await resolveTenant(env, "bob", dir)) as Tenant;
    expect(a.dataRepo).toEqual(b.dataRepo); // same repo
    expect(a.id).toBe("alice");
    expect(b.id).toBe("bob"); // distinct tenant identity
  });
});

describe("tenantFromRecord", () => {
  it("derives global coords from the record id", () => {
    expect(tenantFromRecord(env, { id: "bob" })).toEqual({
      id: "bob",
      dataRepo: { owner: "caseyWebb", repo: "grocery-data", ref: "main" },
      installationId: "42",
    });
  });
});

describe("resolveInvite (the §3.2 identity step)", () => {
  it("maps a valid code to its allowlisted username", async () => {
    const kv = memKv({ "invite:LET-ME-IN": "alice", "tenant:alice": JSON.stringify(ALICE) });
    expect(await resolveInvite(kv, "LET-ME-IN")).toBe("alice");
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
    expect(await resolveInvite(kv, "CODE")).toBe("casey");
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
