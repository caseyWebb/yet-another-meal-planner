import { describe, it, expect } from "vitest";
import {
  resolveTenant,
  resolveInvite,
  tenantFromRecord,
  kvTenantStore,
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
  return { async get(id) { return records[id] ?? null; } };
}

/** In-memory KV holding `tenant:<id>` allowlist entries + `invite:<code>` codes. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return { async get(key: string) { return m.get(key) ?? null; } } as unknown as KVNamespace;
}

const isUnauthorized = (r: Tenant | Unauthorized): r is Unauthorized =>
  (r as Unauthorized).error === "unauthorized";

describe("resolveTenant (from a provider-validated tenantId)", () => {
  it("builds the Tenant, joining data-repo coords + users/<id> prefix from env", async () => {
    const t = (await resolveTenant(env, "alice", store({ alice: ALICE }))) as Tenant;
    expect(isUnauthorized(t)).toBe(false);
    expect(t.id).toBe("alice");
    expect(t.dataRepo).toEqual({ owner: "caseyWebb", repo: "grocery-data", ref: "main" });
    expect(t.userPrefix).toBe("users/alice");
    expect(t.installationId).toBe("42");
  });

  it("rejects a missing tenantId", async () => {
    expect(isUnauthorized(await resolveTenant(env, undefined, store({ alice: ALICE })))).toBe(true);
    expect(isUnauthorized(await resolveTenant(env, "", store({ alice: ALICE })))).toBe(true);
  });

  it("rejects a tenantId absent from the allowlist", async () => {
    expect(isUnauthorized(await resolveTenant(env, "ghost", store({ alice: ALICE })))).toBe(true);
  });

  it("isolates tenants: each id resolves only to its own subtree", async () => {
    const dir = store({ alice: { id: "alice" }, bob: { id: "bob" } });
    const a = (await resolveTenant(env, "alice", dir)) as Tenant;
    const b = (await resolveTenant(env, "bob", dir)) as Tenant;
    expect(a.dataRepo).toEqual(b.dataRepo); // same repo
    expect(a.userPrefix).toBe("users/alice");
    expect(b.userPrefix).toBe("users/bob"); // disjoint subtree
  });
});

describe("tenantFromRecord", () => {
  it("derives userPrefix + global coords from the record id", () => {
    expect(tenantFromRecord(env, { id: "bob" })).toEqual({
      id: "bob",
      dataRepo: { owner: "caseyWebb", repo: "grocery-data", ref: "main" },
      userPrefix: "users/bob",
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
});

describe("kvTenantStore", () => {
  it("reads a record under tenant:<id>, null for unknown/malformed", async () => {
    const s = kvTenantStore(memKv({ "tenant:alice": JSON.stringify(ALICE), "tenant:broken": "{ not json" }));
    expect(await s.get("alice")).toEqual(ALICE);
    expect(await s.get("nobody")).toBeNull();
    expect(await s.get("broken")).toBeNull();
  });
});
