import { describe, it, expect } from "vitest";
import { sqliteEnv } from "./sqlite-d1.js";
import { redeemGroupCode, backfillTenantRegistry } from "../src/signup.js";
import { redeemGroupInvite, getSignupInvite, listSignupInvites } from "../src/signup-db.js";
import { createGroupInvite, revokeGroupInvite, revoke, onboard } from "../src/admin.js";
import { db } from "../src/db.js";

const NOW = 1_800_000_000_000;

async function mint(env: Parameters<typeof createGroupInvite>[0], cap: number, opts?: { expiresAt?: number; label?: string }) {
  return createGroupInvite(env, { cap, expiresAt: opts?.expiresAt ?? null, label: opts?.label ?? null }, NOW);
}

describe("signup: cap enforcement", () => {
  it("redeems up to the cap, then rejects with a uniform code_unusable", async () => {
    const { env } = sqliteEnv();
    const { code } = await mint(env, 2);

    expect((await redeemGroupCode(env, code, "alice", NOW)).kind).toBe("ok");
    expect((await redeemGroupCode(env, code, "bob", NOW)).kind).toBe("ok");
    expect((await redeemGroupCode(env, code, "carol", NOW)).kind).toBe("code_unusable");

    expect((await getSignupInvite(env, code))?.used).toBe(2);
  });

  it("concurrent redemptions never exceed the cap", async () => {
    // NOTE: the sqlite harness is synchronous, so `Promise.all` here serializes rather than
    // truly interleaves — this asserts the cap accounting is correct across many redemptions.
    // The interleaved-safety argument rests on each guarded statement being individually atomic
    // (D1 serializes writes), covered by the guarded-UPDATE + ON-CONFLICT logic directly.
    const { env } = sqliteEnv();
    const { code } = await mint(env, 3);

    const names = ["u1", "u2", "u3", "u4", "u5", "u6"];
    const results = await Promise.all(names.map((n) => redeemGroupCode(env, code, n, NOW)));
    const ok = results.filter((r) => r.kind === "ok").length;

    expect(ok).toBe(3);
    expect((await getSignupInvite(env, code))?.used).toBe(3);
  });
});

describe("signup: username claim + slot accounting", () => {
  it("creates a new isolated tenant on the KV allowlist and in the D1 registry", async () => {
    const { env, rows } = sqliteEnv();
    const { code } = await mint(env, 5);

    const res = await redeemGroupCode(env, code, "Dave", NOW); // mixed case → normalized
    expect(res).toEqual({ kind: "ok", tenant: "dave" });
    expect(await env.TENANT_KV.get("tenant:dave")).toBe(JSON.stringify({ id: "dave" }));
    expect(rows<{ id: string; via_code: string }>("tenants")).toContainEqual(
      expect.objectContaining({ id: "dave", via_code: code }),
    );
  });

  it("a taken username rolls back and spends no slot", async () => {
    const { env } = sqliteEnv();
    const { code } = await mint(env, 5);

    expect((await redeemGroupCode(env, code, "eve", NOW)).kind).toBe("ok");
    expect((await redeemGroupCode(env, code, "eve", NOW)).kind).toBe("username_taken");

    // The refund means the collision cost no slot: used is 1, not 2.
    expect((await getSignupInvite(env, code))?.used).toBe(1);
  });

  it("a username colliding with an existing member is rejected before any write", async () => {
    const { env } = sqliteEnv(["casey"]); // seeds the KV allowlist entry tenant:casey
    const { code } = await mint(env, 5);

    expect((await redeemGroupCode(env, code, "casey", NOW)).kind).toBe("username_taken");
    expect((await getSignupInvite(env, code))?.used).toBe(0);
  });

  it("an UNUSABLE code + an existing username stays uniform (no membership oracle)", async () => {
    // Without a usable code, `username_taken` must NOT be disclosed — otherwise an
    // unauthenticated caller could probe which usernames are members. Both an existing name and
    // a free name yield the same code_unusable.
    const { env } = sqliteEnv(["casey"]);
    const { code } = await mint(env, 5);
    await revokeGroupInvite(env, code, NOW); // the code is now unusable

    expect((await redeemGroupCode(env, code, "casey", NOW)).kind).toBe("code_unusable");
    expect((await redeemGroupCode(env, code, "freename", NOW)).kind).toBe("code_unusable");
    // An unknown code behaves the same whether the name exists or not.
    expect((await redeemGroupCode(env, "no-such-code", "casey", NOW)).kind).toBe("code_unusable");
  });

  it("records provenance for each successful redemption", async () => {
    const { env, rows } = sqliteEnv();
    const { code } = await mint(env, 5);
    await redeemGroupCode(env, code, "frank", NOW);
    await redeemGroupCode(env, code, "grace", NOW);

    const reds = rows<{ code: string; tenant: string }>("signup_redemptions");
    expect(reds.map((r) => r.tenant).sort()).toEqual(["frank", "grace"]);
    expect(reds.every((r) => r.code === code)).toBe(true);

    const [listed] = await listSignupInvites(env);
    expect(listed.redemptions.sort()).toEqual(["frank", "grace"]);
  });
});

describe("signup: operator onboarding claims the D1 registry", () => {
  it("onboard writes a tenants row so a concurrent self-service signup for the same name is rejected", async () => {
    const { env, rows } = sqliteEnv();
    const deps = {
      tenantKv: env.TENANT_KV,
      krogerKv: env.KROGER_KV as never,
      oauthKv: env.KROGER_KV as never,
      db: db(env),
      randomCode: () => "code",
    };
    await onboard(deps as never, "Alex"); // normalizes to "alex"

    // The uniqueness authority (not just the KV allowlist) now holds the id — this is the
    // strong-consistency guarantee the KV pre-check alone can't give for a just-onboarded member.
    expect(rows<{ id: string; via_code: string | null }>("tenants")).toContainEqual(
      expect.objectContaining({ id: "alex", via_code: null }),
    );
    const { code } = await createGroupInvite(env, { cap: 5, expiresAt: null, label: null }, NOW);
    expect((await redeemGroupCode(env, code, "alex", NOW)).kind).toBe("username_taken");
  });
});

describe("signup: invalid usernames and unusable codes", () => {
  it("rejects invalid usernames with validation, creating nothing", async () => {
    const { env } = sqliteEnv();
    const { code } = await mint(env, 5);
    for (const bad of ["", "a", "Has Space", "no!", "x".repeat(40)]) {
      expect((await redeemGroupCode(env, code, bad, NOW)).kind).toBe("invalid_username");
    }
    expect((await getSignupInvite(env, code))?.used).toBe(0);
  });

  it("an unknown, expired, or revoked code all collapse to code_unusable", async () => {
    const { env } = sqliteEnv();

    expect((await redeemGroupCode(env, "nope", "amy", NOW)).kind).toBe("code_unusable");

    const { code: expiring } = await mint(env, 5, { expiresAt: NOW + 1000 });
    expect((await redeemGroupCode(env, expiring, "ben", NOW + 5000)).kind).toBe("code_unusable");

    const { code: revocable } = await mint(env, 5);
    await revokeGroupInvite(env, revocable, NOW);
    expect((await redeemGroupCode(env, revocable, "cara", NOW)).kind).toBe("code_unusable");
  });
});

describe("signup: tenant-registry backfill (idempotent)", () => {
  it("registers every KV-allowlist tenant exactly once, and re-running is a no-op", async () => {
    const { env, rows } = sqliteEnv(["casey", "sam"]);

    expect((await backfillTenantRegistry(env, NOW)).registered).toBe(2);
    expect((await backfillTenantRegistry(env, NOW)).registered).toBe(2); // idempotent

    const ids = rows<{ id: string; via_code: string | null }>("tenants");
    expect(ids.map((r) => r.id).sort()).toEqual(["casey", "sam"]);
    expect(ids.every((r) => r.via_code === null)).toBe(true); // operator-onboarded → no code
  });
});

describe("signup: revoke frees the username and purges provenance", () => {
  it("removes the tenants registry row and signup_redemptions, keeps the code", async () => {
    const { env, rows } = sqliteEnv();
    const { code } = await mint(env, 5);
    await redeemGroupCode(env, code, "trish", NOW);

    // A member-revoke uses the AdminDeps shape; build it against the sqlite env.
    const deps = {
      tenantKv: env.TENANT_KV,
      krogerKv: env.KROGER_KV as never,
      oauthKv: env.KROGER_KV as never,
      db: (await import("../src/db.js")).db(env),
      randomCode: () => "x",
    };
    await revoke(deps as never, "trish");

    expect(rows("tenants").length).toBe(0);
    expect(rows("signup_redemptions").length).toBe(0);
    expect(await env.TENANT_KV.get("tenant:trish")).toBeNull();
    // The code itself survives (it is operator-owned, not per-tenant).
    expect(await getSignupInvite(env, code)).not.toBeNull();
    // And the freed username can be claimed again.
    expect((await redeemGroupCode(env, code, "trish", NOW)).kind).toBe("ok");
  });
});

describe("signup-db: the atomic gate directly (spike verification)", () => {
  it("ON CONFLICT DO NOTHING yields no second claim and refunds the slot", async () => {
    const { env } = sqliteEnv();
    await createGroupInvite(env, { cap: 5, expiresAt: null, label: null }, NOW);
    const code = (await listSignupInvites(env))[0].code;

    expect(await redeemGroupInvite(env, code, "zoe", NOW)).toEqual({ kind: "ok" });
    // Same id again → the tenants PK conflict is a 0-row no-op (not a throw), and the slot
    // spent in phase 1 is refunded, so used stays at 1.
    expect(await redeemGroupInvite(env, code, "zoe", NOW)).toEqual({ kind: "username_taken" });
    expect((await getSignupInvite(env, code))?.used).toBe(1);
  });
});
