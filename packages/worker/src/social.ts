// The social-graph operations (households-friends-and-people-page, social-graph
// capability): exact-handle lookup, request lifecycle (send / accept / decline /
// cancel), blocks, nicknames, invite links, and the People aggregate — the D24 engine.
// Throw-free toward the API surface: operations return discriminated outcomes (the
// signup idiom) that src/api/people.ts maps to HTTP once; only storage failures throw
// (structured storage_error from src/db.ts).
//
// D24 IS LOAD-BEARING PRIVACY — the invariants, enforced here and pinned by tests:
//   * Declines are INVISIBLE: the requester's rows render "Request sent" for pending,
//     declined, and swallowed alike; no read this module serves ever distinguishes them
//     to the requester.
//   * Sends answer BYTE-IDENTICALLY whether they delivered, deduped against a live
//     pending row, or swallowed (cooldown/block): one success shape, no id echo.
//   * Swallowed rows reach NO inbox and their note/display_name are never delivered.
//   * The outgoing cap counts EVERY requester-visible row (pending + declined +
//     swallowed), so hitting it discloses nothing.
//   * Blocks are evaluated HOUSEHOLD-wide (one member's block binds the household) and
//     everything about them is silent.
// Honest errors are reserved for facts the requester can already see: own household,
// an existing friendship, a full household, their own cap, the handle grammar.

import type { Env } from "./env.js";
import { db } from "./db.js";
import type { Tenant } from "./tenant.js";
import { ulid } from "./ids.js";
import { loadDeploymentProfile } from "./deployment.js";
import { underRateLimit } from "./rate-limit.js";
import {
  getMemberByHandle,
  getMember,
  listMembers,
  countMembers,
  HOUSEHOLD_MAX_MEMBERS,
  type MemberRow,
} from "./members-db.js";
import {
  insertRequest,
  getRequest,
  resolveRequest,
  listInbox,
  listAwaitingRequests,
  countOutgoingVisible,
  findPendingTo,
  latestDeclineAt,
  swallowPendingFrom,
  insertFriendship,
  deleteFriendship,
  friendshipExists,
  listFriendshipsFor,
  insertBlock,
  deleteBlock,
  blockMatches,
  listBlocks,
  countRecipeImports,
  insertInvite,
  getInvite,
  revokeInvite,
  listLiveInvites,
  upsertNickname,
  clearNickname,
  listNicknamesByViewer,
  MEMBER_INVITE_TTL_MS,
  NICKNAME_MAX_CHARS,
  type SocialTier,
  type MemberInviteRow,
} from "./social-db.js";
import { absorbSoleMemberHousehold, acceptPreflight, NOT_CARRIED_OVER, RECONNECT_NOTE } from "./member-move.js";

// --- the D24 budgets (placeholders, tunable — one place) ------------------------------

/** Lookup budget per member AND per client IP (fixed-window, fail-open). */
export const LOOKUP_BUDGET = { max: 30, windowS: 60 * 60 } as const;
/** Request-send budget per member AND per client IP. */
export const SEND_BUDGET = { max: 10, windowS: 24 * 60 * 60 } as const;
/** Standing outgoing cap: requester-visible rows per member (pending+declined+swallowed). */
export const OUTGOING_CAP = 25;
/** Re-request cooldown after a decline (from `resolved_at`). */
export const DECLINE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
/** Request-note cap (inert plain text). */
export const NOTE_MAX_CHARS = 200;
/** Display-name cap (the nickname seed rides the nickname column's own cap). */
export const DISPLAY_NAME_MAX_CHARS = NICKNAME_MAX_CHARS;

/**
 * The shared people-surface limiter: BOTH keys (per-member and per-IP) must admit.
 * Rides `underRateLimit` (fixed-window, self-expiring counters in KROGER_KV beside the
 * login limiter's) and inherits its FAIL-OPEN contract — a KV outage never blocks a
 * legitimate lookup or send.
 */
export async function underPeopleLimit(
  env: Env,
  op: "lookup" | "send",
  member: string,
  ip: string,
  now: number,
): Promise<boolean> {
  const budget = op === "lookup" ? LOOKUP_BUDGET : SEND_BUDGET;
  const [byMember, byIp] = await Promise.all([
    underRateLimit(env.KROGER_KV, `people:${op}:m:${member}`, budget.max, budget.windowS, now),
    underRateLimit(env.KROGER_KV, `people:${op}:ip:${ip}`, budget.max, budget.windowS, now),
  ]);
  return byMember && byIp;
}

/** Whether the friend tier exists on this deployment (pages/08 profile gating). */
export async function friendTierEnabled(env: Env): Promise<boolean> {
  return (await loadDeploymentProfile(env)) === "saas";
}

// --- lookup ------------------------------------------------------------------------------

export type LookupOutcome =
  | { kind: "profile_disabled" }
  | { kind: "found"; handle: string }
  | { kind: "not_found" };

/**
 * Exact-@handle lookup — the ONLY member-directory access any member surface has (no
 * browse, search, prefix, or fuzzy path exists). Existence disclosure is accepted (the
 * signup "username taken" precedent); ENUMERATION is bounded by the limiter at the
 * route. Friend-tier lookups are refused under self-hosted.
 */
export async function lookupHandle(env: Env, tier: SocialTier, rawHandle: string): Promise<LookupOutcome> {
  if (tier === "friend" && !(await friendTierEnabled(env))) return { kind: "profile_disabled" };
  const handle = (rawHandle ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!handle) return { kind: "not_found" };
  const member = await getMemberByHandle(db(env), handle);
  return member ? { kind: "found", handle: member.handle } : { kind: "not_found" };
}

// --- send -----------------------------------------------------------------------------------

export type SendOutcome =
  | { kind: "profile_disabled" }
  | { kind: "validation_failed"; message: string }
  | { kind: "not_found" } // no such handle — honest (the lookup already disclosed it)
  | { kind: "own_household" }
  | { kind: "already_friends" }
  | { kind: "cap_reached" }
  /** Delivered, deduped against a live pending row, or silently swallowed — ONE shape. */
  | { kind: "ok" };

/**
 * Send a request. Honest refusals first (facts the requester can already see), then the
 * indistinguishable tail: a live pending row to the same party dedupes (idempotent
 * already-sent, no new row), an active decline cooldown or a household-wide block match
 * writes a SWALLOWED row (requester-visible, cap-counted, delivered nowhere), and
 * otherwise the pending row is written. All three return the SAME `ok`.
 */
export async function sendRequest(
  env: Env,
  sender: Tenant,
  input: { tier: SocialTier; handle: string; note?: string; display_name?: string },
  now: number = Date.now(),
): Promise<SendOutcome> {
  const d = db(env);
  if (input.tier !== "household" && input.tier !== "friend") {
    return { kind: "validation_failed", message: "tier must be 'household' or 'friend'" };
  }
  if (input.tier === "friend" && !(await friendTierEnabled(env))) return { kind: "profile_disabled" };

  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX_CHARS) {
    return { kind: "validation_failed", message: `Notes are at most ${NOTE_MAX_CHARS} characters` };
  }
  const displayName = (input.display_name ?? "").trim();
  if (displayName.length > DISPLAY_NAME_MAX_CHARS) {
    return { kind: "validation_failed", message: `Display names are at most ${DISPLAY_NAME_MAX_CHARS} characters` };
  }

  const handle = (input.handle ?? "").trim().toLowerCase().replace(/^@/, "");
  const target = handle ? await getMemberByHandle(d, handle) : null;
  if (!target) return { kind: "not_found" };
  if (target.tenant === sender.id) return { kind: "own_household" };
  if (input.tier === "friend" && (await friendshipExists(d, sender.id, target.tenant))) {
    return { kind: "already_friends" };
  }
  if ((await countOutgoingVisible(d, sender.member)) >= OUTGOING_CAP) return { kind: "cap_reached" };

  // ---- the indistinguishable tail: everything below answers the SAME `ok` ----
  const pairTarget = input.tier === "friend" ? { toTenant: target.tenant } : { toMember: target.id };

  // A live pending row to the same party: answered idempotently (no new row) — the
  // requester's own awaiting list already reads "Request sent" for it.
  if (await findPendingTo(d, input.tier, sender.id, pairTarget)) return { kind: "ok" };

  const declinedAt = await latestDeclineAt(d, input.tier, sender.id, pairTarget);
  const inCooldown = declinedAt !== null && now - declinedAt < DECLINE_COOLDOWN_MS;
  const blocked = await blockMatches(d, target.tenant, input.tier, {
    tenant: sender.id,
    member: sender.member,
  });

  await insertRequest(d, {
    id: ulid(now),
    tier: input.tier,
    from_tenant: sender.id,
    from_member: sender.member,
    to_tenant: target.tenant,
    to_member: target.id,
    note: note || null,
    display_name: displayName || null,
    state: inCooldown || blocked ? "swallowed" : "pending",
    created_at: now,
    resolved_at: inCooldown || blocked ? now : null,
  });
  return { kind: "ok" };
}

// --- accept / decline / cancel ---------------------------------------------------------------

export type AcceptOutcome =
  | { kind: "profile_disabled" }
  | { kind: "not_found" } // unknown id, not addressed to the actor, or already resolved
  | { kind: "household_full" }
  | { kind: "multi_member"; message: string } // household tier: leave-household first
  /** Household tier, existing sole-member account, `confirm` not yet given: the
   *  server-supplied manifest the client renders before completing (D23 consent). */
  | { kind: "confirm_required"; not_carried_over: readonly string[]; reconnect: string }
  | { kind: "ok" };

/**
 * Accept a request. FRIEND tier: any member of the target household may accept
 * (household authority) — mints the canonical edge, resolves the row, seeds nicknames
 * from the carried display names. HOUSEHOLD tier: only the invitee personally; their
 * accept is the D23 move — sole-member movers run move + dissolution AFTER the explicit
 * confirmation (the `confirm` flag; the manifest is served, never client-authored),
 * multi-member movers are refused with the leave-first pointer.
 */
export async function acceptRequest(
  env: Env,
  actor: Tenant,
  requestId: string,
  opts: { confirm?: boolean; display_name?: string } = {},
  now: number = Date.now(),
): Promise<AcceptOutcome> {
  const d = db(env);
  const r = await getRequest(d, requestId);
  if (!r || r.state !== "pending") return { kind: "not_found" };

  if (r.tier === "friend") {
    if (!(await friendTierEnabled(env))) return { kind: "profile_disabled" };
    if (r.to_tenant !== actor.id) return { kind: "not_found" };
    // Claim-then-do with a refund (the join.ts idiom): the one-winner claim serializes
    // racing resolutions, and a failure minting the edge REVERTS the claim so the
    // request stays pending and retryable — an accept must never consume the request
    // without delivering the relationship.
    if (!(await resolveRequest(d, r.id, "accepted", now))) return { kind: "not_found" };
    try {
      await insertFriendship(d, r.from_tenant, r.to_tenant, r.from_member, now);
    } catch (e) {
      await revertAcceptClaim(d, r.id).catch(() => {}); // best-effort; the original error surfaces
      throw e;
    }
    // Nickname seeds (Decision 6): the sender's self-introduction seeds every accepting-
    // household viewer without an existing alias for them; the acceptor's optional
    // display_name seeds the sender's household symmetrically. (Best-effort tail — the
    // relationship is already committed; a seed failure never un-accepts.)
    if (r.display_name) await seedNicknames(env, r.to_tenant, r.from_member, r.display_name, now);
    const acceptorName = (opts.display_name ?? "").trim().slice(0, DISPLAY_NAME_MAX_CHARS);
    if (acceptorName) await seedNicknames(env, r.from_tenant, actor.member, acceptorName, now);
    return { kind: "ok" };
  }

  // Household tier: an INVITATION into the sender's household, accepted only by the
  // invitee (the mover — the party whose old household state is purged must be the one
  // consenting, D23).
  if (r.to_member !== actor.member) return { kind: "not_found" };
  const mover = await getMember(d, actor.member, actor.id);
  if (!mover) return { kind: "not_found" };
  const preflight = await acceptPreflight(env, mover, r.from_tenant);
  if (preflight.destination_full) return { kind: "household_full" };
  if (preflight.shape === "multi") {
    return {
      kind: "multi_member",
      message: "You're in a household with other members — leave your household first, then accept",
    };
  }
  if (!opts.confirm) {
    return { kind: "confirm_required", not_carried_over: NOT_CARRIED_OVER, reconnect: RECONNECT_NOTE };
  }
  // Claim, then move — and REVERT the claim if the move fails (a storage hiccup or the
  // size-bound losing a race against a concurrent join must leave the invitation
  // pending and retryable, never consumed-without-moving).
  if (!(await resolveRequest(d, r.id, "accepted", now))) return { kind: "not_found" };
  try {
    await absorbSoleMemberHousehold(env, mover, r.from_tenant, now);
  } catch (e) {
    await revertAcceptClaim(d, r.id).catch(() => {}); // best-effort; the original error surfaces
    throw e;
  }
  // Seeds: the inviter's self-introduction for the mover's view; the mover's optional
  // display_name for every destination viewer. (Best-effort tail — the move committed.)
  if (r.display_name) {
    await seedNicknames(env, r.from_tenant, r.from_member, r.display_name, now, { onlyViewer: mover.id });
  }
  const moverName = (opts.display_name ?? "").trim().slice(0, DISPLAY_NAME_MAX_CHARS);
  if (moverName) await seedNicknames(env, r.from_tenant, mover.id, moverName, now);
  return { kind: "ok" };
}

/** Roll an accept's one-winner claim back to `pending` (only ever from the claim's own
 *  failure path — the guarded WHERE keeps it from reviving anything else). */
async function revertAcceptClaim(d: ReturnType<typeof db>, id: string): Promise<void> {
  await d.run(
    "UPDATE social_requests SET state = 'pending', resolved_at = NULL WHERE id = ?1 AND state = 'accepted'",
    id,
  );
}

/**
 * Seed nickname rows from a self-supplied display name: every member of
 * `viewerTenant` (or just `onlyViewer`) who has NO existing alias for `target` gains
 * one — ordinary rows, editable and clearable (INSERT OR IGNORE keeps existing
 * aliases). Also used by join-link redemption (src/api/join.ts) for the newcomer's
 * self-introduction.
 */
export async function seedNicknames(
  env: Env,
  viewerTenant: string,
  target: string,
  name: string,
  now: number,
  opts: { onlyViewer?: string } = {},
): Promise<void> {
  const d = db(env);
  const nickname = name.trim().slice(0, NICKNAME_MAX_CHARS);
  if (!nickname) return;
  if (opts.onlyViewer) {
    await d.run(
      "INSERT OR IGNORE INTO nicknames (tenant, viewer_member, target_member, nickname, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5)",
      viewerTenant,
      opts.onlyViewer,
      target,
      nickname,
      now,
    );
    return;
  }
  await d.run(
    "INSERT OR IGNORE INTO nicknames (tenant, viewer_member, target_member, nickname, updated_at) " +
      "SELECT m.tenant, m.id, ?2, ?3, ?4 FROM members m WHERE m.tenant = ?1 AND m.id <> ?2",
    viewerTenant,
    target,
    nickname,
    now,
  );
}

export type SimpleOutcome = { kind: "not_found" } | { kind: "ok" };

/** Decline: the state flips, `resolved_at` stamps the cooldown anchor, and NOTHING else
 *  happens — no notification, no visible change anywhere the requester can see. */
export async function declineRequest(
  env: Env,
  actor: Tenant,
  requestId: string,
  now: number = Date.now(),
): Promise<SimpleOutcome> {
  const d = db(env);
  const r = await getRequest(d, requestId);
  if (!r || r.state !== "pending") return { kind: "not_found" };
  const addressed = r.tier === "friend" ? r.to_tenant === actor.id : r.to_member === actor.member;
  if (!addressed) return { kind: "not_found" };
  return (await resolveRequest(d, r.id, "declined", now)) ? { kind: "ok" } : { kind: "not_found" };
}

/**
 * Cancel an outgoing row (any member of the sending household — household authority).
 * Applies to ANY requester-visible row — pending, declined, or swallowed — freeing a
 * cap slot without notifying anyone. A cancelled row's `resolved_at` is kept ONLY when
 * the row was DECLINED (its decline time is the pair's cooldown anchor, and the probe
 * reads cancelled rows with a non-null `resolved_at` precisely so cancelling never
 * erases a decliner's 30-day protection); a cancelled pending/swallowed row nulls it
 * (an ordinary cancel+resend must deliver, not swallow).
 */
export async function cancelRequest(env: Env, actor: Tenant, requestId: string): Promise<SimpleOutcome> {
  const d = db(env);
  const r = await getRequest(d, requestId);
  if (!r || r.from_tenant !== actor.id) return { kind: "not_found" };
  if (r.state !== "pending" && r.state !== "declined" && r.state !== "swallowed") return { kind: "not_found" };
  const res = await d.run(
    "UPDATE social_requests SET resolved_at = CASE WHEN state = 'declined' THEN resolved_at ELSE NULL END, state = 'cancelled' " +
      "WHERE id = ?1 AND from_tenant = ?2 AND state IN ('pending', 'declined', 'swallowed')",
    r.id,
    actor.id,
  );
  return res.changes === 1 ? { kind: "ok" } : { kind: "not_found" };
}

// --- blocks -----------------------------------------------------------------------------------

export type BlockOutcome = { kind: "not_found" } | { kind: "ok" };

/**
 * Mint a block from an INBOX row or an AWAITING row (tier-scoped; household-tier
 * records `blocked_member` so the suppression follows the person). Effects, all silent:
 * the counterparty's existing pending inbound rows are swallowed; a block minted from
 * an awaiting row also cancels the household's own outgoing request.
 */
export async function blockFromRequest(
  env: Env,
  actor: Tenant,
  requestId: string,
  now: number = Date.now(),
): Promise<BlockOutcome> {
  const d = db(env);
  const r = await getRequest(d, requestId);
  if (!r) return { kind: "not_found" };

  const inbound = r.tier === "friend" ? r.to_tenant === actor.id : r.to_member === actor.member;
  const outbound = r.from_tenant === actor.id;
  if (!inbound && !outbound) return { kind: "not_found" };

  const counter = inbound
    ? { tenant: r.from_tenant, member: r.from_member }
    : { tenant: r.to_tenant, member: r.to_member };

  await insertBlock(
    d,
    {
      tenant: actor.id,
      blockingMember: actor.member,
      tier: r.tier,
      blockedTenant: counter.tenant,
      blockedMember: r.tier === "household" ? counter.member : null,
    },
    now,
  );
  // Swallow the counterparty's pending inbound rows on this tier (this row included,
  // when inbound). Their view is unchanged — still "Request sent".
  await swallowPendingFrom(
    d,
    r.tier,
    actor.id,
    r.tier === "friend" ? { fromTenant: counter.tenant } : { fromMember: counter.member },
    now,
  );
  // Block-from-awaiting also cancels the household's own outgoing request (silently,
  // like any cancel).
  if (outbound && (r.state === "pending" || r.state === "declined" || r.state === "swallowed")) {
    await cancelRequest(env, actor, r.id);
  }
  // A friend-tier block severs an existing edge in the same operation (D30: the live
  // lens hides their recipes on the next read).
  if (r.tier === "friend") await deleteFriendship(d, actor.id, counter.tenant);
  return { kind: "ok" };
}

/** Block minted from a FRIEND row: sever the edge and suppress the friend tier, in one
 *  silent operation. */
export async function blockFriend(
  env: Env,
  actor: Tenant,
  friendTenant: string,
  now: number = Date.now(),
): Promise<BlockOutcome> {
  const d = db(env);
  await insertBlock(
    d,
    { tenant: actor.id, blockingMember: actor.member, tier: "friend", blockedTenant: friendTenant, blockedMember: null },
    now,
  );
  await swallowPendingFrom(d, "friend", actor.id, { fromTenant: friendTenant }, now);
  await deleteFriendship(d, actor.id, friendTenant);
  return { kind: "ok" };
}

/** Unblock: a plain delete. Nothing swallowed while blocked is retroactively delivered. */
export async function unblock(env: Env, actor: Tenant, tier: SocialTier, blockedTenant: string): Promise<BlockOutcome> {
  const removed = await deleteBlock(db(env), actor.id, tier, blockedTenant);
  return removed ? { kind: "ok" } : { kind: "not_found" };
}

/** Unfriend: sever the edge, silently (any member of either household). */
export async function unfriend(env: Env, actor: Tenant, friendTenant: string): Promise<void> {
  await deleteFriendship(db(env), actor.id, friendTenant);
}

// --- nicknames -------------------------------------------------------------------------------

export type NicknameOutcome =
  | { kind: "validation_failed"; message: string }
  | { kind: "not_found" } // no such live member
  | { kind: "self" } // others-only
  | { kind: "ok"; cleared: boolean };

/**
 * Upsert (or empty-save-clear) the caller's alias for another member. Others-only;
 * the target may be ANY live member of the deployment (D9 — under self-hosted,
 * nicknames still apply to everyone); never disclosed to the target or any third
 * member. The canonical `(viewer, target)` key makes the class (b) replay converge.
 */
export async function setNickname(
  env: Env,
  viewer: Tenant,
  targetMemberId: string,
  rawNickname: string,
  now: number = Date.now(),
): Promise<NicknameOutcome> {
  const d = db(env);
  const nickname = (rawNickname ?? "").trim();
  if (nickname.length > NICKNAME_MAX_CHARS) {
    return { kind: "validation_failed", message: `Nicknames are at most ${NICKNAME_MAX_CHARS} characters` };
  }
  if (targetMemberId === viewer.member) return { kind: "self" };
  const target = await d.first<MemberRow>("SELECT * FROM members WHERE id = ?1", targetMemberId);
  if (!target) return { kind: "not_found" };
  if (!nickname) {
    await clearNickname(d, viewer.member, targetMemberId);
    return { kind: "ok", cleared: true };
  }
  await upsertNickname(d, viewer.id, viewer.member, targetMemberId, nickname, now);
  return { kind: "ok", cleared: false };
}

// --- invite links -----------------------------------------------------------------------------

/** Mint an unguessable URL-safe token: 16 random bytes (128 bits) as base64url. */
export function mintInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type InviteMintOutcome =
  | { kind: "profile_disabled" }
  | { kind: "ok"; token: string; tier: SocialTier; expires_at: number };

/** Mint a member invite link: single-use, 14-day expiry, per-invite `inviter_member` +
 *  `tier` (fixed in v1 — no member knobs). Friend-tier mints are profile-gated. */
export async function mintInvite(
  env: Env,
  actor: Tenant,
  tier: SocialTier,
  now: number = Date.now(),
): Promise<InviteMintOutcome> {
  if (tier === "friend" && !(await friendTierEnabled(env))) return { kind: "profile_disabled" };
  const token = mintInviteToken();
  const expires = now + MEMBER_INVITE_TTL_MS;
  await insertInvite(db(env), {
    token,
    tenant: actor.id,
    inviter_member: actor.member,
    tier,
    created_at: now,
    expires_at: expires,
    revoked_at: null,
    redeemed_at: null,
    redeemed_by: null,
  });
  return { kind: "ok", token, tier, expires_at: expires };
}

/** Cancel an invite link = revoke the token (any member of the minting household).
 *  Oracle-free downstream: a revoked token is indistinguishable from an expired or
 *  never-existent one on `/join`. */
export async function cancelInvite(env: Env, actor: Tenant, token: string, now: number = Date.now()): Promise<SimpleOutcome> {
  const d = db(env);
  const row = await getInvite(d, token);
  if (!row || row.tenant !== actor.id) return { kind: "not_found" };
  return (await revokeInvite(d, token, now)) ? { kind: "ok" } : { kind: "not_found" };
}

/** A token's live view, or null — the ONE aliveness rule (`/join`'s uniform
 *  `invalid_or_expired` collapses unknown/expired/revoked/redeemed to this null). */
export async function liveInvite(env: Env, token: string, now: number = Date.now()): Promise<MemberInviteRow | null> {
  if (!token) return null;
  const row = await getInvite(db(env), token);
  if (!row || row.revoked_at !== null || row.redeemed_at !== null || row.expires_at <= now) return null;
  return row;
}

// --- the People aggregate ----------------------------------------------------------------------

export interface PeopleMemberView {
  id: string;
  handle: string;
  you: boolean;
  /** The CALLER's alias only (null when unset) — never someone else's, never a self-alias. */
  nickname: string | null;
  joined_at: number;
}

export interface PeopleFriendView {
  tenant: string;
  /** The friend household's representative member (the People row identity). */
  member: { id: string; handle: string };
  nickname: string | null;
  /** "N shared" (D27): the friend household's cookbook size. */
  shared: number;
  since: number;
}

export interface PeopleInboxView {
  id: string;
  tier: SocialTier;
  /** The sending member (an opaque id — the accept flow's nickname-seed edit targets it). */
  from_member: string;
  from_handle: string;
  display_name: string | null;
  note: string | null;
  created_at: number;
}

export interface PeopleAwaitingRequestView {
  /** NO state field — pending, declined, and swallowed rows are requester-visible and
   *  byte-identical by construction (D24). */
  id: string;
  tier: SocialTier;
  to_handle: string;
  created_at: number;
}

export interface PeopleInviteView {
  token: string;
  tier: SocialTier;
  created_at: number;
  expires_at: number;
}

export interface PeopleBlockView {
  tier: SocialTier;
  tenant: string;
  handle: string | null;
  created_at: number;
}

export interface PeoplePayload {
  profile: "self-hosted" | "saas";
  members: PeopleMemberView[];
  /** Absent (empty) under self-hosted — no friend-tier data is served there. */
  friends: PeopleFriendView[];
  inbox: PeopleInboxView[];
  awaiting: { requests: PeopleAwaitingRequestView[]; invites: PeopleInviteView[] };
  blocked: PeopleBlockView[];
  household_max: number;
}

/**
 * The one People aggregate (`GET /api/people`): household members with the VIEWER's
 * nicknames, friends with "N shared", the inbox, awaiting rows (requests + live invite
 * links), and the household's block records. Friend sections are empty under
 * self-hosted (no friend-tier data is fetched or served). The sidebar badge derives
 * from `inbox.length` of this same read (the shared-derivation rule).
 */
export async function assemblePeople(env: Env, viewer: Tenant, now: number = Date.now()): Promise<PeoplePayload> {
  const d = db(env);
  const profile = await loadDeploymentProfile(env);
  const saas = profile === "saas";

  const [members, nicknameRows, inboxRows, awaitingRows, inviteRows, blockRows] = await Promise.all([
    listMembers(d, viewer.id),
    listNicknamesByViewer(d, viewer.member),
    listInbox(d, viewer.id, viewer.member),
    listAwaitingRequests(d, viewer.id),
    listLiveInvites(d, viewer.id, now),
    listBlocks(d, viewer.id),
  ]);
  const nicknameOf = new Map(nicknameRows.map((r) => [r.target_member, r.nickname]));

  // Handles for request counterparties (senders + targets) resolved in one pass.
  const counterpartyIds = new Set<string>();
  for (const r of inboxRows) counterpartyIds.add(r.from_member);
  for (const r of awaitingRows) counterpartyIds.add(r.to_member);
  for (const b of blockRows) if (b.blocked_member) counterpartyIds.add(b.blocked_member);
  const handleOf = await memberHandles(env, [...counterpartyIds]);

  const inbox: PeopleInboxView[] = inboxRows.flatMap((r) => {
    if (r.tier === "friend" && !saas) return []; // no friend-tier data under self-hosted
    const from = handleOf.get(r.from_member);
    if (!from) return []; // dead sender (revoked) — the row is unactionable noise
    return [
      {
        id: r.id,
        tier: r.tier,
        from_member: r.from_member,
        from_handle: from,
        display_name: r.display_name,
        note: r.note,
        created_at: r.created_at,
      },
    ];
  });

  const awaitingRequests: PeopleAwaitingRequestView[] = awaitingRows.flatMap((r) => {
    if (r.tier === "friend" && !saas) return [];
    return [
      {
        id: r.id,
        tier: r.tier,
        to_handle: handleOf.get(r.to_member) ?? r.to_tenant,
        created_at: r.created_at,
      },
    ];
  });

  const friends: PeopleFriendView[] = [];
  if (saas) {
    const edges = await listFriendshipsFor(d, viewer.id);
    for (const e of edges) {
      const friendTenant = e.tenant_a === viewer.id ? e.tenant_b : e.tenant_a;
      const friendMembers = await listMembers(d, friendTenant);
      if (friendMembers.length === 0) continue; // a purged household's stray edge
      // The row's representative member: the request's originator when they live in the
      // friend household (the person you actually interacted with), else the household's
      // first (founding/eldest) member.
      const rep = friendMembers.find((m) => m.id === e.requested_by) ?? friendMembers[0];
      friends.push({
        tenant: friendTenant,
        member: { id: rep.id, handle: rep.handle },
        nickname: nicknameOf.get(rep.id) ?? null,
        shared: await countRecipeImports(d, friendTenant),
        since: e.created_at,
      });
    }
    friends.sort((a, b) => b.since - a.since);
  }

  return {
    profile,
    members: members.map((m) => ({
      id: m.id,
      handle: m.handle,
      you: m.id === viewer.member,
      nickname: m.id === viewer.member ? null : (nicknameOf.get(m.id) ?? null),
      joined_at: m.created_at,
    })),
    friends,
    inbox,
    awaiting: {
      requests: awaitingRequests,
      invites: inviteRows
        .filter((i) => saas || i.tier === "household")
        .map((i) => ({ token: i.token, tier: i.tier, created_at: i.created_at, expires_at: i.expires_at })),
    },
    blocked: blockRows
      .filter((b) => saas || b.tier === "household")
      .map((b) => ({
        tier: b.tier,
        tenant: b.blocked_tenant,
        handle: b.blocked_member ? (handleOf.get(b.blocked_member) ?? null) : null,
        created_at: b.created_at,
      })),
    household_max: HOUSEHOLD_MAX_MEMBERS,
  };
}

/** Resolve a set of member ids to handles in one query. */
async function memberHandles(env: Env, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db(env).all<{ id: string; handle: string }>(
    `SELECT id, handle FROM members WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})`,
    ...ids,
  );
  return new Map(rows.map((r) => [r.id, r.handle]));
}

/** How many members the household still admits (join-link redemption's bound check). */
export async function householdHasRoom(env: Env, tenant: string): Promise<boolean> {
  return (await countMembers(db(env), tenant)) < HOUSEHOLD_MAX_MEMBERS;
}
