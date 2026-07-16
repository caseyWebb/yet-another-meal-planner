import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import {
  insertCredential,
  listCredentialsByTenant,
  getCredentialById,
  countCredentialsByTenant,
  countCredentialsByMember,
  touchCredential,
  type StoredCredential,
} from "../src/webauthn-db.js";

const makeEnv = () => fakeD1({ tables: { webauthn_credentials: [] } }).env;

const cred = (over: Partial<Omit<StoredCredential, "lastUsedAt">> = {}): Omit<StoredCredential, "lastUsedAt"> => ({
  tenant: "casey",
  member: "casey",
  credentialId: "cred-1",
  publicKey: "pk",
  signCount: 0,
  transports: ["internal"],
  label: null,
  createdAt: 1000,
  ...over,
});

describe("webauthn-db (per-tenant credential store)", () => {
  it("inserts and lists credentials per tenant — multiple devices per person", async () => {
    const env = makeEnv();
    await insertCredential(env, cred({ credentialId: "a" }));
    await insertCredential(env, cred({ credentialId: "b", label: "phone" }));
    await insertCredential(env, cred({ tenant: "alice", credentialId: "c" }));
    expect((await listCredentialsByTenant(env, "casey")).map((c) => c.credentialId).sort()).toEqual(["a", "b"]);
    expect(await countCredentialsByTenant(env, "casey")).toBe(2);
    expect(await countCredentialsByTenant(env, "alice")).toBe(1);
    expect(await countCredentialsByTenant(env, "nobody")).toBe(0);
  });

  it("resolves a credential (and its tenant + member) by id, decoding transports; null for unknown", async () => {
    const env = makeEnv();
    await insertCredential(env, cred({ credentialId: "a", transports: ["internal", "hybrid"] }));
    const got = await getCredentialById(env, "a");
    expect(got?.tenant).toBe("casey");
    expect(got?.member).toBe("casey");
    expect(got?.transports).toEqual(["internal", "hybrid"]);
    expect(await getCredentialById(env, "missing")).toBeNull();
  });

  it("defaults a NULL member to the founding member on read (pre-backfill row, D2 rule)", async () => {
    const fake = fakeD1({
      tables: {
        webauthn_credentials: [
          { tenant: "casey", member: null, credential_id: "old", public_key: "pk", sign_count: 0, transports: null, label: null, created_at: 1, last_used_at: null },
        ],
      },
    });
    const got = await getCredentialById(fake.env, "old");
    expect(got?.member).toBe("casey");
  });

  it("counts credentials per MEMBER — the member-scoped first-enrollment (0 → 1) rule", async () => {
    const env = makeEnv();
    await insertCredential(env, cred({ credentialId: "a", member: "casey" }));
    await insertCredential(env, cred({ credentialId: "b", member: "m2" }));
    expect(await countCredentialsByMember(env, "casey", "casey")).toBe(1);
    expect(await countCredentialsByMember(env, "casey", "m2")).toBe(1);
    expect(await countCredentialsByMember(env, "casey", "m3")).toBe(0);
    expect(await countCredentialsByTenant(env, "casey")).toBe(2);
  });

  it("touch stores the counter + last-used, WITHOUT enforcing monotonicity (synced passkeys)", async () => {
    const env = makeEnv();
    await insertCredential(env, cred({ credentialId: "a", signCount: 5 }));
    await touchCredential(env, "a", 0, 2000); // counter goes backward — must be accepted
    const got = await getCredentialById(env, "a");
    expect(got?.signCount).toBe(0);
    expect(got?.lastUsedAt).toBe(2000);
  });
});
