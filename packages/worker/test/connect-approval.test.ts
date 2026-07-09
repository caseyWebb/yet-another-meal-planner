import { describe, it, expect } from "vitest";
import { mintApproval, viewApproval, approveApproval, claimApproved } from "../src/connect-approval.js";
import type { Env } from "../src/env.js";

/** In-memory KV supporting the get/put/delete the approval lifecycle uses. */
function memKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  } as unknown as KVNamespace;
}
const env = (kv: KVNamespace) => ({ TENANT_KV: kv }) as unknown as Env;
const OAUTH_B64 = btoa(JSON.stringify({ clientId: "claude", scope: ["mcp"] }));

describe("connect-approval (cross-device approval references)", () => {
  it("mints a pending ref with a client name + verification code; viewable, not yet claimable", async () => {
    const e = env(memKv());
    const { ref, code } = await mintApproval(e, OAUTH_B64, "Claude");
    expect(ref).toBeTruthy();
    expect(code).toHaveLength(6);
    expect(await viewApproval(e, ref)).toEqual({ clientName: "Claude", code, status: "pending" });
    expect(await claimApproved(e, ref)).toBeNull(); // not approved → nothing to complete
  });

  it("binds a tenant on approval; claim returns oauth+tenant exactly once (single-use)", async () => {
    const e = env(memKv());
    const { ref } = await mintApproval(e, OAUTH_B64, "Claude");
    expect(await approveApproval(e, ref, "casey")).toBe("ok");
    expect((await viewApproval(e, ref))?.status).toBe("approved");
    expect(await claimApproved(e, ref)).toEqual({ oauth: OAUTH_B64, tenant: "casey" });
    // A second poll (double claim) yields nothing and the reference is gone.
    expect(await claimApproved(e, ref)).toBeNull();
    expect(await viewApproval(e, ref)).toBeNull();
  });

  it("an unknown/expired ref is not_found on approve and null on view/claim", async () => {
    const e = env(memKv());
    expect(await approveApproval(e, "nope", "casey")).toBe("not_found");
    expect(await viewApproval(e, "nope")).toBeNull();
    expect(await claimApproved(e, "nope")).toBeNull();
  });

  it("approval is pending-only and one-shot: a different member can't re-bind an approved ref", async () => {
    const e = env(memKv());
    const { ref } = await mintApproval(e, OAUTH_B64, "Claude");
    expect(await approveApproval(e, ref, "casey")).toBe("ok");
    // Re-approve by the SAME member is idempotent; a DIFFERENT member is refused with no re-bind.
    expect(await approveApproval(e, ref, "casey")).toBe("ok");
    expect(await approveApproval(e, ref, "mallory")).toBe("not_found");
    // The binding is unchanged — the claim still yields casey.
    expect(await claimApproved(e, ref)).toEqual({ oauth: OAUTH_B64, tenant: "casey" });
  });
});
