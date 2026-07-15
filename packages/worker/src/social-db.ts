// D1 data layer for the social graph (households-friends-and-people-page, social-graph
// capability): friendships, social requests, member invite links, nicknames, and blocks
// (migration 0060). Function-per-query like members-db.ts, over an injectable `Db`
// (src/db.ts) — the admin lifecycle cleanup (src/admin.ts) closes over `deps.db` while
// the social operations (src/social.ts) pass `db(env)`. Every statement runs through
// src/db.ts (never `env.DB`), so a D1 failure surfaces as a structured `storage_error`.
//
// D24 posture notes live with the queries that carry them: `swallowed` rows are
// requester-visible ("Request sent") but reach NO inbox read; the outgoing cap counts
// pending + declined + swallowed alike; block probes evaluate HOUSEHOLD-wide.

import type { Db } from "./db.js";

/** The two relationship tiers a request/invite/block can carry. */
export type SocialTier = "household" | "friend";

/** Request lifecycle states. `pending`/`declined`/`swallowed` are indistinguishable on
 *  the requester's surface (D24's invisible decline). */
export type RequestState = "pending" | "accepted" | "declined" | "cancelled" | "swallowed";

/** The requester-visible states — what the awaiting list renders and the cap counts. */
export const REQUESTER_VISIBLE_STATES: readonly RequestState[] = ["pending", "declined", "swallowed"];

export interface FriendshipRow {
  tenant_a: string;
  tenant_b: string;
  requested_by: string;
  created_at: number;
}

export interface SocialRequestRow {
  id: string;
  tier: SocialTier;
  from_tenant: string;
  from_member: string;
  to_tenant: string;
  to_member: string;
  note: string | null;
  display_name: string | null;
  state: RequestState;
  created_at: number;
  resolved_at: number | null;
}

export interface MemberInviteRow {
  token: string;
  tenant: string;
  inviter_member: string;
  tier: SocialTier;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  redeemed_at: number | null;
  redeemed_by: string | null;
}

export interface NicknameRow {
  tenant: string;
  viewer_member: string;
  target_member: string;
  nickname: string;
  updated_at: number;
}

export interface BlockRow {
  tenant: string;
  blocking_member: string;
  tier: SocialTier;
  blocked_tenant: string;
  blocked_member: string | null;
  created_at: number;
}

// --- friendships ------------------------------------------------------------------

/** The canonical ordered pair the `friendships` PK + CHECK enforce (tenant_a < tenant_b). */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Mint the symmetric edge, idempotent in EITHER orientation (the canonical pair +
 *  INSERT OR IGNORE make a duplicate a no-op, and the CHECK makes a self-edge throw). */
export async function insertFriendship(
  d: Db,
  a: string,
  b: string,
  requestedBy: string,
  now: number,
): Promise<void> {
  const [lo, hi] = orderedPair(a, b);
  await d.run(
    "INSERT OR IGNORE INTO friendships (tenant_a, tenant_b, requested_by, created_at) VALUES (?1, ?2, ?3, ?4)",
    lo,
    hi,
    requestedBy,
    now,
  );
}

/** Sever the edge (unfriend / block-from-friend-row). Idempotent, orientation-free. */
export async function deleteFriendship(d: Db, a: string, b: string): Promise<void> {
  const [lo, hi] = orderedPair(a, b);
  await d.run("DELETE FROM friendships WHERE tenant_a = ?1 AND tenant_b = ?2", lo, hi);
}

/** Whether the two households are friends (orientation-free point probe). */
export async function friendshipExists(d: Db, a: string, b: string): Promise<boolean> {
  const [lo, hi] = orderedPair(a, b);
  const row = await d.first<{ one: number }>(
    "SELECT 1 AS one FROM friendships WHERE tenant_a = ?1 AND tenant_b = ?2",
    lo,
    hi,
  );
  return row !== null;
}

/** The tenant's friend households — the union of both orientations (the seam's shape;
 *  both arms are indexed: the PK prefix and idx_friendships_b). */
export async function listFriendTenants(d: Db, tenant: string): Promise<string[]> {
  const rows = await d.all<{ friend: string }>(
    "SELECT tenant_b AS friend FROM friendships WHERE tenant_a = ?1 " +
      "UNION SELECT tenant_a AS friend FROM friendships WHERE tenant_b = ?1",
    tenant,
  );
  return rows.map((r) => r.friend);
}

/** Full friendship rows touching the tenant (the People page's FRIENDS section source). */
export async function listFriendshipsFor(d: Db, tenant: string): Promise<FriendshipRow[]> {
  return d.all<FriendshipRow>(
    "SELECT tenant_a, tenant_b, requested_by, created_at FROM friendships WHERE tenant_a = ?1 OR tenant_b = ?1",
    tenant,
  );
}

// --- social requests --------------------------------------------------------------

/** Append one request row (state supplied by the caller: 'pending' or 'swallowed'). */
export async function insertRequest(d: Db, row: SocialRequestRow): Promise<void> {
  await d.run(
    "INSERT INTO social_requests (id, tier, from_tenant, from_member, to_tenant, to_member, note, display_name, state, created_at, resolved_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    row.id,
    row.tier,
    row.from_tenant,
    row.from_member,
    row.to_tenant,
    row.to_member,
    row.note,
    row.display_name,
    row.state,
    row.created_at,
    row.resolved_at,
  );
}

export async function getRequest(d: Db, id: string): Promise<SocialRequestRow | null> {
  return d.first<SocialRequestRow>("SELECT * FROM social_requests WHERE id = ?1", id);
}

/** Flip ONE pending request to a terminal state (accept/decline/cancel/swallow). The
 *  `state = 'pending'` guard makes racing resolutions one-winner: the loser sees 0
 *  changes and treats the row as already resolved. */
export async function resolveRequest(
  d: Db,
  id: string,
  state: Exclude<RequestState, "pending">,
  now: number,
): Promise<boolean> {
  const res = await d.run(
    "UPDATE social_requests SET state = ?2, resolved_at = ?3 WHERE id = ?1 AND state = 'pending'",
    id,
    state,
    now,
  );
  return res.changes === 1;
}

/** The member's inbox: pending FRIEND requests addressed to their household (any member
 *  may act — household authority) plus pending HOUSEHOLD invitations addressed to them
 *  PERSONALLY. Swallowed/resolved rows never appear (the index carries `state`). */
export async function listInbox(d: Db, tenant: string, member: string): Promise<SocialRequestRow[]> {
  return d.all<SocialRequestRow>(
    "SELECT * FROM social_requests WHERE state = 'pending' AND " +
      "((tier = 'friend' AND to_tenant = ?1) OR (tier = 'household' AND to_member = ?2)) " +
      "ORDER BY created_at DESC",
    tenant,
    member,
  );
}

/** The household's awaiting-response rows: every requester-visible outgoing request.
 *  `pending`, `declined`, and `swallowed` all render "Request sent" — the caller MUST
 *  NOT branch on the distinction anywhere a requester can observe (D24). */
export async function listAwaitingRequests(d: Db, tenant: string): Promise<SocialRequestRow[]> {
  return d.all<SocialRequestRow>(
    "SELECT * FROM social_requests WHERE from_tenant = ?1 AND state IN ('pending', 'declined', 'swallowed') " +
      "ORDER BY created_at DESC",
    tenant,
  );
}

/** The standing-cap count: EVERY requester-visible row of one member — pending,
 *  declined, and swallowed alike, so the cap can never become a decline oracle. */
export async function countOutgoingVisible(d: Db, member: string): Promise<number> {
  const row = await d.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM social_requests WHERE from_member = ?1 AND state IN ('pending', 'declined', 'swallowed')",
    member,
  );
  return row?.n ?? 0;
}

/** A live duplicate: the household's pending request to the same party on the same tier
 *  (friend: keyed by target household; household: keyed by target member). */
export async function findPendingTo(
  d: Db,
  tier: SocialTier,
  fromTenant: string,
  target: { toTenant?: string; toMember?: string },
): Promise<SocialRequestRow | null> {
  if (tier === "friend") {
    return d.first<SocialRequestRow>(
      "SELECT * FROM social_requests WHERE tier = 'friend' AND from_tenant = ?1 AND to_tenant = ?2 AND state = 'pending'",
      fromTenant,
      target.toTenant,
    );
  }
  return d.first<SocialRequestRow>(
    "SELECT * FROM social_requests WHERE tier = 'household' AND from_tenant = ?1 AND to_member = ?2 AND state = 'pending'",
    fromTenant,
    target.toMember,
  );
}

/** The cooldown probe: the latest decline time for the pair key — friend tier keys
 *  `(tier, from_tenant, to_tenant)`, household tier `(tier, from_tenant, to_member)`.
 *  Reads `declined` rows AND `cancelled` rows with a non-null `resolved_at`: a cancel
 *  keeps a declined row's decline time (and ONLY that — cancelled pending/swallowed
 *  rows null it), so cancelling an awaiting row never erases a decliner's cooldown. */
export async function latestDeclineAt(
  d: Db,
  tier: SocialTier,
  fromTenant: string,
  target: { toTenant?: string; toMember?: string },
): Promise<number | null> {
  const anchor =
    "state IN ('declined', 'cancelled') AND resolved_at IS NOT NULL";
  const row =
    tier === "friend"
      ? await d.first<{ at: number | null }>(
          `SELECT MAX(resolved_at) AS at FROM social_requests WHERE tier = 'friend' AND from_tenant = ?1 AND to_tenant = ?2 AND ${anchor}`,
          fromTenant,
          target.toTenant,
        )
      : await d.first<{ at: number | null }>(
          `SELECT MAX(resolved_at) AS at FROM social_requests WHERE tier = 'household' AND from_tenant = ?1 AND to_member = ?2 AND ${anchor}`,
          fromTenant,
          target.toMember,
        );
  return row?.at ?? null;
}

/** Swallow a counterparty's existing PENDING inbound rows at block time: friend-tier
 *  rows from their household, or household-tier rows from the blocked member. The
 *  requester's view is unchanged (swallowed still renders "Request sent"). */
export async function swallowPendingFrom(
  d: Db,
  tier: SocialTier,
  toTenant: string,
  counterparty: { fromTenant?: string; fromMember?: string },
  now: number,
): Promise<number> {
  if (tier === "friend") {
    const res = await d.run(
      "UPDATE social_requests SET state = 'swallowed', resolved_at = ?3 " +
        "WHERE tier = 'friend' AND to_tenant = ?1 AND from_tenant = ?2 AND state = 'pending'",
      toTenant,
      counterparty.fromTenant,
      now,
    );
    return res.changes;
  }
  const res = await d.run(
    "UPDATE social_requests SET state = 'swallowed', resolved_at = ?3 " +
      "WHERE tier = 'household' AND to_tenant = ?1 AND from_member = ?2 AND state = 'pending'",
    toTenant,
    counterparty.fromMember,
    now,
  );
  return res.changes;
}

// --- member invite links ----------------------------------------------------------

/** Invite-link lifetime: 14 days (fixed in v1 — no member knobs). */
export const MEMBER_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function insertInvite(d: Db, row: MemberInviteRow): Promise<void> {
  await d.run(
    "INSERT INTO member_invites (token, tenant, inviter_member, tier, created_at, expires_at, revoked_at, redeemed_at, redeemed_by) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL)",
    row.token,
    row.tenant,
    row.inviter_member,
    row.tier,
    row.created_at,
    row.expires_at,
  );
}

export async function getInvite(d: Db, token: string): Promise<MemberInviteRow | null> {
  return d.first<MemberInviteRow>("SELECT * FROM member_invites WHERE token = ?1", token);
}

/** Revoke an unredeemed link (cancel). Idempotent; a redeemed link is never un-redeemed. */
export async function revokeInvite(d: Db, token: string, now: number): Promise<boolean> {
  const res = await d.run(
    "UPDATE member_invites SET revoked_at = ?2 WHERE token = ?1 AND revoked_at IS NULL AND redeemed_at IS NULL",
    token,
    now,
  );
  return res.changes === 1;
}

/** The atomic single-use claim (the group-code idiom): exactly ONE concurrent redeemer
 *  wins the guarded UPDATE; losers see 0 changes and take the uniform dead-token path. */
export async function claimInvite(d: Db, token: string, redeemedBy: string, now: number): Promise<boolean> {
  const res = await d.run(
    "UPDATE member_invites SET redeemed_at = ?2, redeemed_by = ?3 " +
      "WHERE token = ?1 AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?2",
    token,
    now,
    redeemedBy,
  );
  return res.changes === 1;
}

/** Refund a claim whose downstream mint lost its own race (handle/username collision) —
 *  the group-code refund idiom, so a failed redemption never burns the single use. */
export async function refundInvite(d: Db, token: string): Promise<void> {
  await d.run("UPDATE member_invites SET redeemed_at = NULL, redeemed_by = NULL WHERE token = ?1", token);
}

/** The household's live (unredeemed, unrevoked, unexpired) invite links — the awaiting
 *  list's invite rows. */
export async function listLiveInvites(d: Db, tenant: string, now: number): Promise<MemberInviteRow[]> {
  return d.all<MemberInviteRow>(
    "SELECT * FROM member_invites WHERE tenant = ?1 AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?2 " +
      "ORDER BY created_at DESC",
    tenant,
    now,
  );
}

// --- nicknames ----------------------------------------------------------------------

/** Nickname length cap (plain text). */
export const NICKNAME_MAX_CHARS = 40;

/** Upsert the viewer's alias for a target (the canonical `(viewer, target)` key — the
 *  class (b) replay converges). `tenant` is the VIEWER's household. */
export async function upsertNickname(
  d: Db,
  tenant: string,
  viewer: string,
  target: string,
  nickname: string,
  now: number,
): Promise<void> {
  await d.run(
    "INSERT INTO nicknames (tenant, viewer_member, target_member, nickname, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(viewer_member, target_member) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at, tenant = excluded.tenant",
    tenant,
    viewer,
    target,
    nickname,
    now,
  );
}

/** Clear the viewer's alias (the empty-save delete). Idempotent. */
export async function clearNickname(d: Db, viewer: string, target: string): Promise<void> {
  await d.run("DELETE FROM nicknames WHERE viewer_member = ?1 AND target_member = ?2", viewer, target);
}

/** Every alias the viewer has set — the ONLY read shape any surface uses (a nickname is
 *  never disclosed to its subject or any third member; there is no by-target read). */
export async function listNicknamesByViewer(d: Db, viewer: string): Promise<NicknameRow[]> {
  return d.all<NicknameRow>("SELECT * FROM nicknames WHERE viewer_member = ?1", viewer);
}

export async function getNickname(d: Db, viewer: string, target: string): Promise<NicknameRow | null> {
  return d.first<NicknameRow>(
    "SELECT * FROM nicknames WHERE viewer_member = ?1 AND target_member = ?2",
    viewer,
    target,
  );
}

// --- blocks ---------------------------------------------------------------------------

/** Mint a block (idempotent on the `(tenant, tier, blocked_tenant)` PK). Household-tier
 *  blocks carry `blockedMember` so the suppression follows the person across moves. */
export async function insertBlock(
  d: Db,
  row: { tenant: string; blockingMember: string; tier: SocialTier; blockedTenant: string; blockedMember?: string | null },
  now: number,
): Promise<void> {
  await d.run(
    "INSERT OR IGNORE INTO blocks (tenant, blocking_member, tier, blocked_tenant, blocked_member, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    row.tenant,
    row.blockingMember,
    row.tier,
    row.blockedTenant,
    row.blockedMember ?? null,
    now,
  );
}

/** Unblock: a plain delete (nothing is retroactively delivered). */
export async function deleteBlock(d: Db, tenant: string, tier: SocialTier, blockedTenant: string): Promise<boolean> {
  const res = await d.run(
    "DELETE FROM blocks WHERE tenant = ?1 AND tier = ?2 AND blocked_tenant = ?3",
    tenant,
    tier,
    blockedTenant,
  );
  return res.changes >= 1;
}

/** The household-wide swallow probe: does ANY member of `tenant` hold a block on this
 *  tier matching the counterparty? Friend tier matches by household; household tier by
 *  member id (the person, wherever they now live) OR the recorded household. */
export async function blockMatches(
  d: Db,
  tenant: string,
  tier: SocialTier,
  counterparty: { tenant: string; member?: string | null },
): Promise<boolean> {
  if (tier === "friend") {
    const row = await d.first<{ one: number }>(
      "SELECT 1 AS one FROM blocks WHERE tenant = ?1 AND tier = 'friend' AND blocked_tenant = ?2 LIMIT 1",
      tenant,
      counterparty.tenant,
    );
    return row !== null;
  }
  const row = await d.first<{ one: number }>(
    "SELECT 1 AS one FROM blocks WHERE tenant = ?1 AND tier = 'household' AND " +
      "(blocked_tenant = ?2 OR (blocked_member IS NOT NULL AND blocked_member = ?3)) LIMIT 1",
    tenant,
    counterparty.tenant,
    counterparty.member ?? "",
  );
  return row !== null;
}

/** The household's block records (the People page's unblock management affordance). */
export async function listBlocks(d: Db, tenant: string): Promise<BlockRow[]> {
  return d.all<BlockRow>("SELECT * FROM blocks WHERE tenant = ?1 ORDER BY created_at DESC", tenant);
}

// --- shared counts ----------------------------------------------------------------------

/** "N shared" (D27): the friend household's whole cookbook size — its `recipe_imports`
 *  row count. Curated rows belong to the reserved tenant and never inflate it. */
export async function countRecipeImports(d: Db, tenant: string): Promise<number> {
  const row = await d.first<{ n: number }>("SELECT COUNT(*) AS n FROM recipe_imports WHERE tenant = ?1", tenant);
  return row?.n ?? 0;
}

// --- lifecycle cleanup (household-purge / member-revoke, src/admin.ts) --------------------

/**
 * Household-purge's CROSS-DIRECTION social cleanup (operator-admin Decision 12) — the
 * rows a bare `tenant = ?` sweep cannot reach: friendships and requests where the
 * tenant is EITHER party, nicknames TARGETING its members, and blocks recorded AGAINST
 * it or its members. (The tenant-keyed halves — `member_invites`, `nicknames`, `blocks`
 * by their `tenant` column — ride TENANT_TABLES in src/admin.ts like every per-tenant
 * table.) Returned as prepared statements so the purge runs them in ITS one atomic
 * batch, ORDERED BEFORE the `members` delete (the member-set subqueries must still see
 * the rows).
 */
export function tenantSocialPurgeStatements(d: Db, tenant: string): D1PreparedStatement[] {
  return [
    d.prepare("DELETE FROM friendships WHERE tenant_a = ?1 OR tenant_b = ?1", tenant),
    d.prepare("DELETE FROM social_requests WHERE from_tenant = ?1 OR to_tenant = ?1", tenant),
    d.prepare(
      "DELETE FROM nicknames WHERE target_member IN (SELECT id FROM members WHERE tenant = ?1)",
      tenant,
    ),
    d.prepare(
      "DELETE FROM blocks WHERE blocked_tenant = ?1 OR blocked_member IN (SELECT id FROM members WHERE tenant = ?1)",
      tenant,
    ),
  ];
}

/**
 * Member-revoke's social cleanup (the member-scoped half of the shared lifecycle):
 * nicknames they set and nicknames targeting them, their outgoing requests cancelled,
 * invite links they minted revoked, and block records naming them as `blocked_member`
 * (a revoked id can never send again — dead weight). Every statement carries the
 * `NOT EXISTS (members.id = member)` guard: it fires ONLY when the batch's conditional
 * `members` delete actually removed the row, so a revoke that loses the concurrent
 * last-two-members race (the delete no-ops) leaves the surviving member's data intact —
 * the whole batch degenerates to a no-op instead of half-revoking a live member.
 */
export function memberSocialRevokeStatements(d: Db, member: string, now: number): D1PreparedStatement[] {
  const gone = "NOT EXISTS (SELECT 1 FROM members WHERE id = ?1)";
  return [
    d.prepare(`DELETE FROM nicknames WHERE (viewer_member = ?1 OR target_member = ?1) AND ${gone}`, member),
    // resolved_at stays NULL: a cancelled-from-pending row must never read as a decline
    // anchor in the cooldown probe (latestDeclineAt).
    d.prepare(
      `UPDATE social_requests SET state = 'cancelled', resolved_at = NULL WHERE from_member = ?1 AND state = 'pending' AND ${gone}`,
      member,
    ),
    d.prepare(
      `UPDATE member_invites SET revoked_at = ?2 WHERE inviter_member = ?1 AND revoked_at IS NULL AND redeemed_at IS NULL AND ${gone}`,
      member,
      now,
    ),
    d.prepare(`DELETE FROM blocks WHERE blocked_member = ?1 AND ${gone}`, member),
  ];
}
