// The `join` area (self-service-signup fork + social-graph): member invite-link
// redemption at `/join/:token` — an SPA route absorbed by the asset fallback, with its
// reads/writes HERE under the existing `/api/*` dispatch (NO `run_worker_first` entry,
// no `wrangler.jsonc` change). The token read is PUBLIC (per-IP rate-limited); a dead
// token — unknown, expired, revoked, already-redeemed, or held by a blocked signed-in
// party — answers ONE uniform `invalid_or_expired` (revocation is oracle-free).
// Redemption consumes the single-use token atomically with what it creates
// (claim-then-create, the group-code refund idiom on collision):
//   * signed-out + household tier → a MEMBER (ULID id, grammar-valid chosen handle) in
//     the inviter's household, size-bound enforced, then the standard member-bound
//     session so the redeemer enrolls a passkey;
//   * signed-out + friend tier → a new TENANT (the signup core) PLUS the friendship
//     edge to the inviter's household;
//   * signed-in + household tier → the household-accept flow (confirmation + D23 move);
//   * signed-in + friend tier → the edge after confirm, idempotent when already friends.
// Member invite links are the THIRD invite kind: no shared namespace or redemption path
// with KV bootstrap invites or D1 group codes (the trio never crosses).

import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../db.js";
import { underRateLimit } from "../rate-limit.js";
import { operatorConfig } from "../deployment.js";
import { resolveIdentity, directoryFromEnv, type Tenant } from "../tenant.js";
import {
  createSession,
  setSessionCookie,
  readSession,
  SESSION_COOKIE,
  type ApiEnv,
} from "../session.js";
import { isValidUsername, finalizeNewTenant } from "../signup.js";
import { claimTenant } from "../signup-db.js";
import {
  insertMember,
  isValidHandle,
  HANDLE_GRAMMAR_MESSAGE,
  getMember,
  HOUSEHOLD_MAX_MEMBERS,
} from "../members-db.js";
import { claimInvite, refundInvite, insertFriendship, blockMatches } from "../social-db.js";
import {
  liveInvite,
  friendTierEnabled,
  householdHasRoom,
  seedNicknames,
  DISPLAY_NAME_MAX_CHARS,
} from "../social.js";
import { absorbSoleMemberHousehold, acceptPreflight, NOT_CARRIED_OVER, RECONNECT_NOTE } from "../member-move.js";

const JOIN_READ_RL = { max: 30, windowS: 60 * 60 } as const;
const JOIN_REDEEM_RL = { max: 10, windowS: 60 } as const;

/** The ONE dead-token reply — byte-identical for unknown, expired, revoked, redeemed,
 *  and blocked-party tokens. Any distinguishing detail here would be an oracle. */
function invalidOrExpired(c: Context<ApiEnv>) {
  return c.json({ error: "invalid_or_expired" as const, message: "This invite link is no longer valid" }, 404);
}

/** Resolve the request's session if one exists — the join surface serves signed-out
 *  visitors too, so this never rejects; it only shapes the flow. */
async function optionalSession(c: Context<ApiEnv>): Promise<Tenant | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const record = await readSession(c.env.TENANT_KV, token);
  if (!record) return null;
  const resolved = await resolveIdentity(c.env, record.tenant, record.member, directoryFromEnv(c.env));
  return "error" in resolved ? null : resolved;
}

export const joinArea = new Hono<ApiEnv>()
  // The public token read: inviter handle + tier framing for a valid token; the uniform
  // dead state otherwise. Per-IP rate-limited (fail-open, the shared limiter contract).
  .get("/join/:token", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underRateLimit(c.env.KROGER_KV, `join:rl:${ip}`, JOIN_READ_RL.max, JOIN_READ_RL.windowS, Date.now()))) {
      return c.json({ error: "rate_limited" as const, message: "Too many attempts — try again later" }, 429);
    }
    const invite = await liveInvite(c.env, c.req.param("token"));
    if (!invite) return invalidOrExpired(c);
    // A friend-tier link on a deployment without the friend tier is dead, uniformly.
    if (invite.tier === "friend" && !(await friendTierEnabled(c.env))) return invalidOrExpired(c);
    const inviter = await getMember(db(c.env), invite.inviter_member, invite.tenant);
    if (!inviter) return invalidOrExpired(c); // the inviter was revoked — the link died with them
    // A signed-in visitor the inviter household has blocked sees the SAME dead state
    // (the swallow posture) — nothing marks it as a block.
    const session = await optionalSession(c);
    if (session && (await blockMatches(db(c.env), invite.tenant, invite.tier, { tenant: session.id, member: session.member }))) {
      return invalidOrExpired(c);
    }
    return c.json({
      inviter_handle: inviter.handle,
      tier: invite.tier,
      deployment: operatorConfig(c.env).name,
      signed_in: session !== null,
      household_max: HOUSEHOLD_MAX_MEMBERS,
    });
  })
  // Redemption. The body shapes per flow: signed-out household `{ handle, display_name? }`,
  // signed-out friend `{ username, display_name? }`, signed-in `{ confirm, display_name? }`.
  .post("/join/:token", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underRateLimit(c.env.KROGER_KV, `join:redeem:rl:${ip}`, JOIN_REDEEM_RL.max, JOIN_REDEEM_RL.windowS, Date.now()))) {
      return c.json({ error: "rate_limited" as const, message: "Too many attempts — try again in a minute" }, 429);
    }
    const now = Date.now();
    const token = c.req.param("token");
    const invite = await liveInvite(c.env, token, now);
    if (!invite) return invalidOrExpired(c);
    if (invite.tier === "friend" && !(await friendTierEnabled(c.env))) return invalidOrExpired(c);

    let body: { handle?: unknown; username?: unknown; display_name?: unknown; confirm?: unknown } = {};
    try {
      body = await c.req.json();
    } catch {
      // a malformed body falls through to the per-flow validation below
    }
    const displayName =
      typeof body.display_name === "string" ? body.display_name.trim().slice(0, DISPLAY_NAME_MAX_CHARS) : "";

    const session = await optionalSession(c);

    // A blocked party's redemption CONSUMES the token and creates nothing — to the
    // redeemer it is indistinguishable from any dead link (the swallow posture).
    if (session && (await blockMatches(db(c.env), invite.tenant, invite.tier, { tenant: session.id, member: session.member }))) {
      await claimInvite(db(c.env), token, session.member, now);
      return invalidOrExpired(c);
    }

    if (session) {
      if (body.confirm !== true) {
        // The client renders the confirmation from this server-supplied shape (the D23
        // manifest for household tier; a plain confirm for friend tier).
        if (invite.tier === "household") {
          const mover = await getMember(db(c.env), session.member, session.id);
          if (!mover) return c.json({ error: "unauthorized" as const, message: "No session" }, 401);
          if (mover.tenant === invite.tenant) {
            return c.json({ error: "own_household" as const, message: "You're already in this household" }, 409);
          }
          const preflight = await acceptPreflight(c.env, mover, invite.tenant);
          if (preflight.destination_full) {
            return c.json({ error: "household_full" as const, message: `That household is full (max ${HOUSEHOLD_MAX_MEMBERS} members)` }, 409);
          }
          if (preflight.shape === "multi") {
            return c.json(
              { error: "leave_first" as const, message: "You're in a household with other members — leave your household first, then accept" },
              409,
            );
          }
          return c.json({
            status: "confirm_required" as const,
            tier: invite.tier,
            not_carried_over: NOT_CARRIED_OVER,
            reconnect: RECONNECT_NOTE,
          });
        }
        return c.json({ status: "confirm_required" as const, tier: invite.tier, not_carried_over: [], reconnect: "" });
      }

      if (invite.tier === "friend") {
        // Idempotent when already friends; the single-use token is spent either way.
        if (!(await claimInvite(db(c.env), token, session.id, now))) return invalidOrExpired(c);
        if (session.id === invite.tenant) return c.json({ status: "ok" as const, tier: invite.tier });
        await insertFriendship(db(c.env), session.id, invite.tenant, invite.inviter_member, now);
        return c.json({ status: "ok" as const, tier: invite.tier });
      }

      // Household tier, confirmed: the D23 accept flow — claim, then move + dissolve.
      const mover = await getMember(db(c.env), session.member, session.id);
      if (!mover) return c.json({ error: "unauthorized" as const, message: "No session" }, 401);
      if (mover.tenant === invite.tenant) {
        return c.json({ error: "own_household" as const, message: "You're already in this household" }, 409);
      }
      if (!(await householdHasRoom(c.env, invite.tenant))) {
        return c.json({ error: "household_full" as const, message: `That household is full (max ${HOUSEHOLD_MAX_MEMBERS} members)` }, 409);
      }
      if (!(await claimInvite(db(c.env), token, mover.id, now))) return invalidOrExpired(c);
      try {
        await absorbSoleMemberHousehold(c.env, mover, invite.tenant, now);
      } catch (e) {
        await refundInvite(db(c.env), token);
        throw e;
      }
      if (displayName) await seedNicknames(c.env, invite.tenant, mover.id, displayName, now);
      return c.json({ status: "ok" as const, tier: invite.tier, tenant: { id: invite.tenant, member: mover.id } });
    }

    // ---- signed-out flows: the account mint ----
    if (invite.tier === "household") {
      const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
      if (!isValidHandle(handle)) {
        return c.json({ error: "validation_failed" as const, message: HANDLE_GRAMMAR_MESSAGE }, 400);
      }
      if (!(await householdHasRoom(c.env, invite.tenant))) {
        return c.json({ error: "household_full" as const, message: `That household is full (max ${HOUSEHOLD_MAX_MEMBERS} members)` }, 409);
      }
      // Claim-then-create: the token is the single-use gate; a handle collision refunds
      // it (the group-code idiom), so a taken handle never burns the link.
      if (!(await claimInvite(db(c.env), token, handle, now))) return invalidOrExpired(c);
      const mint = await insertMember(db(c.env), invite.tenant, handle, now);
      if (mint.kind !== "ok") {
        await refundInvite(db(c.env), token);
        return c.json({ error: "handle_taken" as const, message: "That handle is taken — try another" }, 409);
      }
      await db(c.env).run("UPDATE member_invites SET redeemed_by = ?2 WHERE token = ?1", token, mint.member.id);
      if (displayName) await seedNicknames(c.env, invite.tenant, mint.member.id, displayName, now);
      const sessionToken = await createSession(c.env.TENANT_KV, invite.tenant, mint.member.id, now);
      setSessionCookie(c, sessionToken);
      return c.json({
        status: "ok" as const,
        tier: invite.tier,
        tenant: { id: invite.tenant, member: mint.member.id },
        handle: mint.member.handle,
      });
    }

    // Friend tier, signed out: a new tenant (the signup core) PLUS the edge.
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!isValidUsername(username)) {
      return c.json({ error: "validation_failed" as const, message: HANDLE_GRAMMAR_MESSAGE }, 400);
    }
    if (await c.env.TENANT_KV.get(`tenant:${username}`)) {
      return c.json({ error: "username_taken" as const, message: "That username is taken — try another" }, 409);
    }
    if (!(await claimInvite(db(c.env), token, username, now))) return invalidOrExpired(c);
    if (!(await claimTenant(c.env, username, now))) {
      await refundInvite(db(c.env), token);
      return c.json({ error: "username_taken" as const, message: "That username is taken — try another" }, 409);
    }
    await finalizeNewTenant(c.env, username, now);
    await insertFriendship(db(c.env), username, invite.tenant, invite.inviter_member, now);
    if (displayName) await seedNicknames(c.env, invite.tenant, username, displayName, now);
    const sessionToken = await createSession(c.env.TENANT_KV, username, username, now);
    setSessionCookie(c, sessionToken);
    return c.json({
      status: "ok" as const,
      tier: invite.tier,
      tenant: { id: username, member: username },
    });
  });
