// The social store over the REAL migration chain (households-friends-and-people-page
// §1): migration 0060's five tables — the canonical-pair CHECK, the write helpers'
// dedup semantics, the indexes, and the household-purge sweep clearing every table.
import { describe, it, expect } from "vitest";
import { sqliteEnv, memKv, type SqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import { insertFoundingMember, insertMember } from "../src/members-db.js";
import {
  orderedPair,
  insertFriendship,
  deleteFriendship,
  friendshipExists,
  listFriendTenants,
  insertRequest,
  resolveRequest,
  latestDeclineAt,
  countOutgoingVisible,
  insertInvite,
  claimInvite,
  refundInvite,
  revokeInvite,
  upsertNickname,
  clearNickname,
  listNicknamesByViewer,
  insertBlock,
  blockMatches,
  deleteBlock,
  countRecipeImports,
} from "../src/social-db.js";
import { revoke, type AdminDeps } from "../src/admin.js";
import type { KvStore } from "../src/kroger-user.js";

const NOW = 1_800_000_000_000;

function adminDepsOf(h: SqliteEnv): AdminDeps {
  return {
    tenantKv: h.env.TENANT_KV,
    krogerKv: memKv() as unknown as KvStore,
    oauthKv: memKv() as unknown as KvStore,
    db: db(h.env),
    randomCode: () => "code",
  };
}

async function seedHousehold(h: SqliteEnv, tenant: string): Promise<void> {
  await insertFoundingMember(db(h.env), tenant, NOW);
}

describe("migration 0060: friendships shape", () => {
  it("the CHECK rejects an unordered pair and a self edge at the schema", () => {
    const h = sqliteEnv();
    // Unordered (tenant_a > tenant_b) violates the CHECK.
    expect(() =>
      h.raw
        .prepare("INSERT INTO friendships (tenant_a, tenant_b, requested_by, created_at) VALUES ('zed', 'abe', 'zed', 1)")
        .run(),
    ).toThrow();
    // A self edge violates it too (a < a is false).
    expect(() =>
      h.raw
        .prepare("INSERT INTO friendships (tenant_a, tenant_b, requested_by, created_at) VALUES ('abe', 'abe', 'abe', 1)")
        .run(),
    ).toThrow();
  });

  it("the write helper canonicalizes, so both orientations dedupe to one row", async () => {
    const h = sqliteEnv();
    const d = db(h.env);
    await insertFriendship(d, "pat", "casey", "pat", NOW);
    await insertFriendship(d, "casey", "pat", "casey", NOW + 1); // reverse orientation: no-op
    expect(h.rows("friendships")).toHaveLength(1);
    expect(h.rows("friendships")[0]).toMatchObject({ tenant_a: "casey", tenant_b: "pat", requested_by: "pat" });
    expect(await friendshipExists(d, "casey", "pat")).toBe(true);
    expect(await friendshipExists(d, "pat", "casey")).toBe(true);
    expect(await listFriendTenants(d, "casey")).toEqual(["pat"]);
    expect(await listFriendTenants(d, "pat")).toEqual(["casey"]);
    await deleteFriendship(d, "pat", "casey"); // orientation-free delete
    expect(h.rows("friendships")).toHaveLength(0);
  });

  it("orderedPair orders lexicographically", () => {
    expect(orderedPair("b", "a")).toEqual(["a", "b"]);
    expect(orderedPair("a", "b")).toEqual(["a", "b"]);
  });
});

describe("migration 0060: indexes", () => {
  it("every declared index exists", () => {
    const names = h_indexNames(sqliteEnv());
    for (const idx of [
      "idx_friendships_b",
      "idx_social_requests_to",
      "idx_social_requests_from",
      "idx_member_invites_tenant",
      "idx_nicknames_tenant",
    ]) {
      expect(names, idx).toContain(idx);
    }
  });
});

function h_indexNames(h: SqliteEnv): string[] {
  return (h.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
    (r) => r.name,
  );
}

describe("request store semantics", () => {
  it("resolveRequest is one-winner: only a pending row flips", async () => {
    const h = sqliteEnv();
    const d = db(h.env);
    await insertRequest(d, {
      id: "r1",
      tier: "friend",
      from_tenant: "casey",
      from_member: "casey",
      to_tenant: "pat",
      to_member: "pat",
      note: null,
      display_name: null,
      state: "pending",
      created_at: NOW,
      resolved_at: null,
    });
    expect(await resolveRequest(d, "r1", "accepted", NOW + 1)).toBe(true);
    expect(await resolveRequest(d, "r1", "declined", NOW + 2)).toBe(false); // already resolved
    expect(h.rows("social_requests")[0]).toMatchObject({ state: "accepted", resolved_at: NOW + 1 });
  });

  it("the cap count and the cooldown probe read exactly the D24 state sets", async () => {
    const h = sqliteEnv();
    const d = db(h.env);
    const mk = (id: string, state: string, resolvedAt: number | null) =>
      h.raw
        .prepare(
          "INSERT INTO social_requests (id, tier, from_tenant, from_member, to_tenant, to_member, note, display_name, state, created_at, resolved_at) " +
            "VALUES (?, 'friend', 'casey', 'casey', 'pat', 'pat', NULL, NULL, ?, 1, ?)",
        )
        .run(id, state, resolvedAt);
    mk("p", "pending", null);
    mk("d", "declined", NOW);
    mk("s", "swallowed", NOW - 5);
    mk("a", "accepted", NOW - 10); // NOT requester-visible (resolved on the page)
    mk("c", "cancelled", null); // cancelled-from-pending: no anchor
    // Cap: pending + declined + swallowed only.
    expect(await countOutgoingVisible(d, "casey")).toBe(3);
    // Cooldown anchor: the declined row's resolved_at.
    expect(await latestDeclineAt(d, "friend", "casey", { toTenant: "pat" })).toBe(NOW);
    // A cancelled row KEEPING a decline-time resolved_at still anchors (cancel never
    // erases a decliner's cooldown).
    h.raw.prepare("UPDATE social_requests SET state = 'cancelled' WHERE id = 'd'").run();
    expect(await latestDeclineAt(d, "friend", "casey", { toTenant: "pat" })).toBe(NOW);
  });
});

describe("invite store semantics", () => {
  it("claim is single-use and atomic; refund restores the claim", async () => {
    const h = sqliteEnv();
    const d = db(h.env);
    await insertInvite(d, {
      token: "tok",
      tenant: "casey",
      inviter_member: "casey",
      tier: "household",
      created_at: NOW,
      expires_at: NOW + 1000,
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    });
    expect(await claimInvite(d, "tok", "winner", NOW + 1)).toBe(true);
    expect(await claimInvite(d, "tok", "loser", NOW + 2)).toBe(false); // one winner
    await refundInvite(d, "tok");
    expect(await claimInvite(d, "tok", "retry", NOW + 3)).toBe(true); // refund frees it
    // An expired or revoked token never claims.
    await insertInvite(d, {
      token: "old",
      tenant: "casey",
      inviter_member: "casey",
      tier: "household",
      created_at: NOW,
      expires_at: NOW + 1,
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    });
    expect(await claimInvite(d, "old", "x", NOW + 5)).toBe(false);
    await insertInvite(d, {
      token: "rev",
      tenant: "casey",
      inviter_member: "casey",
      tier: "household",
      created_at: NOW,
      expires_at: NOW + 1000,
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    });
    expect(await revokeInvite(d, "rev", NOW + 1)).toBe(true);
    expect(await claimInvite(d, "rev", "x", NOW + 2)).toBe(false);
  });
});

describe("nickname + block store semantics", () => {
  it("nickname upsert converges on the (viewer, target) key; clear deletes", async () => {
    const h = sqliteEnv();
    const d = db(h.env);
    await upsertNickname(d, "casey", "casey", "m2", "Mom", NOW);
    await upsertNickname(d, "casey", "casey", "m2", "Mother", NOW + 1); // replay/edit converges
    expect(h.rows("nicknames")).toHaveLength(1);
    expect((await listNicknamesByViewer(d, "casey"))[0]).toMatchObject({ nickname: "Mother" });
    await clearNickname(d, "casey", "m2");
    expect(h.rows("nicknames")).toHaveLength(0);
  });

  it("block probes: friend tier matches by household, household tier by member OR household", async () => {
    const h = sqliteEnv();
    const d = db(h.env);
    await insertBlock(d, { tenant: "pat", blockingMember: "pat", tier: "friend", blockedTenant: "casey" }, NOW);
    expect(await blockMatches(d, "pat", "friend", { tenant: "casey" })).toBe(true);
    expect(await blockMatches(d, "pat", "household", { tenant: "casey", member: "casey" })).toBe(false); // tier-scoped
    await insertBlock(
      d,
      { tenant: "pat", blockingMember: "pat", tier: "household", blockedTenant: "casey", blockedMember: "mem1" },
      NOW,
    );
    // The member match FOLLOWS the person: a new household, same member id, still matches.
    expect(await blockMatches(d, "pat", "household", { tenant: "elsewhere", member: "mem1" })).toBe(true);
    expect(await blockMatches(d, "pat", "household", { tenant: "elsewhere", member: "mem2" })).toBe(false);
    expect(await deleteBlock(d, "pat", "friend", "casey")).toBe(true);
    expect(await blockMatches(d, "pat", "friend", { tenant: "casey" })).toBe(false);
  });
});

describe("shared count (D27)", () => {
  it("counts the household's recipe_imports rows; curated rows belong to the reserved tenant", async () => {
    const h = sqliteEnv();
    const d = db(h.env);
    h.raw.prepare("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('a', 'pat', 'pat', 'agent', '2026-01-01')").run();
    h.raw.prepare("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('b', 'pat', 'pat', 'agent', '2026-01-01')").run();
    h.raw.prepare("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('c', '~curated', '~curated', 'curated', '2026-01-01')").run();
    expect(await countRecipeImports(d, "pat")).toBe(2);
  });
});

describe("household purge clears every social table (both directions)", () => {
  it("no friendships/social_requests/member_invites/nicknames/blocks row referencing the tenant or its members survives", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    const d = db(h.env);
    await seedHousehold(h, "casey");
    await seedHousehold(h, "pat");
    const sam = await insertMember(d, "casey", "sam_j", NOW);
    if (sam.kind !== "ok") throw new Error("mint failed");

    // Both directions of everything.
    await insertFriendship(d, "casey", "pat", "casey", NOW);
    h.raw
      .prepare(
        "INSERT INTO social_requests (id, tier, from_tenant, from_member, to_tenant, to_member, note, display_name, state, created_at, resolved_at) " +
          "VALUES ('out', 'friend', 'casey', 'casey', 'zoe', 'zoe', NULL, NULL, 'pending', 1, NULL)",
      )
      .run();
    h.raw
      .prepare(
        "INSERT INTO social_requests (id, tier, from_tenant, from_member, to_tenant, to_member, note, display_name, state, created_at, resolved_at) " +
          "VALUES ('inb', 'friend', 'pat', 'pat', 'casey', 'casey', NULL, NULL, 'pending', 1, NULL)",
      )
      .run();
    await insertInvite(d, {
      token: "t1",
      tenant: "casey",
      inviter_member: sam.member.id,
      tier: "household",
      created_at: NOW,
      expires_at: NOW + 1000,
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    });
    await upsertNickname(d, "casey", sam.member.id, "pat", "Neighbor", NOW); // held by the household
    await upsertNickname(d, "pat", "pat", sam.member.id, "Sam", NOW); // TARGETING its member
    await insertBlock(d, { tenant: "casey", blockingMember: "casey", tier: "friend", blockedTenant: "zoe" }, NOW); // minted
    await insertBlock(d, { tenant: "pat", blockingMember: "pat", tier: "friend", blockedTenant: "casey" }, NOW); // against it
    await insertBlock(
      d,
      { tenant: "pat", blockingMember: "pat", tier: "household", blockedTenant: "old", blockedMember: sam.member.id },
      NOW,
    ); // against its member

    await revoke(adminDepsOf(h), "casey");

    expect(h.rows("friendships")).toHaveLength(0);
    expect(h.rows("social_requests")).toHaveLength(0);
    expect(h.rows("member_invites")).toHaveLength(0);
    expect(h.rows("nicknames")).toHaveLength(0);
    expect(h.rows("blocks")).toHaveLength(0);
    expect(h.rows("members").filter((m) => (m as { tenant: string }).tenant === "casey")).toHaveLength(0);
  });
});
