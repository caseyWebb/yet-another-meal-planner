// Handle grammar + member minting (households-friends-and-people-page §2): the ONE
// new-mint grammar at every mint site, the grandfather class untouched, ULID member
// mints, the deployment-wide unique-handle gate, and the household size bound.
import { describe, it, expect } from "vitest";
import { sqliteEnv, memKv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import {
  HANDLE_RE,
  isValidHandle,
  insertMember,
  insertFoundingMember,
  HOUSEHOLD_MAX_MEMBERS,
} from "../src/members-db.js";
import { isValidUsername, redeemGroupCode } from "../src/signup.js";
import { onboard, createGroupInvite, type AdminDeps } from "../src/admin.js";
import { resolveIdentity, directoryFromEnv } from "../src/tenant.js";
import { householdHasRoom } from "../src/social.js";
import type { KvStore } from "../src/kroger-user.js";

const NOW = 1_800_000_000_000;

describe("the one new-mint handle grammar", () => {
  it("accepts and rejects per ^[a-z0-9_]{3,20}$", () => {
    expect(isValidHandle("grandma_j")).toBe(true); // underscore ok
    expect(isValidHandle("abc")).toBe(true); // 3 chars ok
    expect(isValidHandle("a".repeat(20))).toBe(true); // 20 chars ok
    expect(isValidHandle("case9")).toBe(true);
    expect(isValidHandle("caseys-kitchen")).toBe(false); // hyphen rejected (reserved for spawn suffixes)
    expect(isValidHandle("ab")).toBe(false); // 2 chars rejected
    expect(isValidHandle("a".repeat(21))).toBe(false); // 21 chars rejected
    expect(isValidHandle("Casey")).toBe(false); // uppercase rejected
    expect(isValidHandle("")).toBe(false);
    expect(HANDLE_RE.source).toBe("^[a-z0-9_]{3,20}$");
  });

  it("gates the self-service username (the tenant id + founding handle mint)", async () => {
    const { env } = sqliteEnv();
    const { code } = await createGroupInvite(env, { cap: 5 }, NOW);
    expect(isValidUsername("caseys-kitchen")).toBe(false);
    expect((await redeemGroupCode(env, code, "caseys-kitchen", NOW)).kind).toBe("invalid_username");
    expect((await redeemGroupCode(env, code, "cj", NOW)).kind).toBe("invalid_username");
    expect((await redeemGroupCode(env, code, "casey_j", NOW)).kind).toBe("ok");
  });

  it("gates operator onboarding with a structured error naming the grammar", async () => {
    const h = sqliteEnv();
    const deps: AdminDeps = {
      tenantKv: h.env.TENANT_KV,
      krogerKv: memKv() as unknown as KvStore,
      oauthKv: memKv() as unknown as KvStore,
      db: db(h.env),
      randomCode: () => "code",
    };
    await expect(onboard(deps, "caseys-kitchen")).rejects.toMatchObject({
      code: "validation_failed",
      message: expect.stringContaining("3–20"),
    });
    await expect(onboard(deps, "cj")).rejects.toMatchObject({ code: "validation_failed" });
    // Nothing was written for the refused mints.
    expect(h.rows("tenants")).toHaveLength(0);
    await expect(onboard(deps, "casey")).resolves.toMatchObject({ username: "casey" });
  });
});

describe("the grandfather class", () => {
  it("a pre-existing hyphenated tenant still resolves identity unmodified", async () => {
    const h = sqliteEnv(["caseys-kitchen"]); // allowlisted, outside the new grammar
    await insertFoundingMember(db(h.env), "caseys-kitchen", NOW);
    const resolved = await resolveIdentity(h.env, "caseys-kitchen", undefined, directoryFromEnv(h.env));
    expect(resolved).toEqual({ id: "caseys-kitchen", member: "caseys-kitchen" });
  });
});

describe("non-founding member mint", () => {
  it("mints a server ULID id with the chosen handle", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const res = await insertMember(d, "casey", "grandma_j", NOW);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.member.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // a ULID, never the handle
    expect(res.member.id).not.toBe("grandma_j");
    expect(res.member).toMatchObject({ tenant: "casey", handle: "grandma_j" });
  });

  it("a handle colliding with a founding handle (= a tenant id) is refused", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    await insertFoundingMember(d, "pat", NOW);
    // Handles are deployment-unique: pat's founding handle is taken everywhere.
    expect((await insertMember(d, "casey", "pat", NOW)).kind).toBe("handle_taken");
    // …and a collision with a non-founding handle too.
    expect((await insertMember(d, "casey", "sam_j", NOW)).kind).toBe("ok");
    expect((await insertMember(d, "pat", "sam_j", NOW)).kind).toBe("handle_taken");
  });

  it("the size bound closes the household at 8", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    for (let i = 2; i <= HOUSEHOLD_MAX_MEMBERS; i++) {
      expect((await insertMember(d, "casey", `member_${i}`, NOW)).kind).toBe("ok");
    }
    expect(await householdHasRoom(h.env, "casey")).toBe(false);
    const h2 = sqliteEnv(["pat"]);
    await insertFoundingMember(db(h2.env), "pat", NOW);
    expect(await householdHasRoom(h2.env, "pat")).toBe(true);
  });
});
