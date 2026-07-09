import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import {
  insertCredential,
  listCredentialsByTenant,
  getCredentialById,
  countCredentialsByTenant,
  touchCredential,
  type StoredCredential,
} from "../src/webauthn-db.js";

const makeEnv = () => fakeD1({ tables: { webauthn_credentials: [] } }).env;

const cred = (over: Partial<Omit<StoredCredential, "lastUsedAt">> = {}): Omit<StoredCredential, "lastUsedAt"> => ({
  tenant: "casey",
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

  it("resolves a credential (and its tenant) by id, decoding transports; null for unknown", async () => {
    const env = makeEnv();
    await insertCredential(env, cred({ credentialId: "a", transports: ["internal", "hybrid"] }));
    const got = await getCredentialById(env, "a");
    expect(got?.tenant).toBe("casey");
    expect(got?.transports).toEqual(["internal", "hybrid"]);
    expect(await getCredentialById(env, "missing")).toBeNull();
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
