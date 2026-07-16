// The `people` area (member-app-core / social-graph): the People page's API — the
// aggregate read, exact-handle lookup, the request lifecycle, blocks, unfriend,
// nicknames, invite links, and the governance flows (leave, remove). Every route is
// session-gated. Operations live in src/social.ts / src/member-move.ts and return
// discriminated outcomes; this file maps them to HTTP ONCE. Write classifications
// (member-app-offline): the nickname PUT is the page's one class (b) write — everything
// else here is online-only by construction (never entered into the mutation cache).
//
// D24 riders visible at this layer: lookup and send ride the shared fixed-window
// limiter on BOTH a per-member and a per-IP key (fail-open); the send response is one
// success shape whether the request delivered, deduped, or silently swallowed; and the
// awaiting rows this API serves carry NO state field.

import { Hono } from "hono";
import type { Context } from "hono";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonBody } from "./middleware.js";
import {
  assemblePeople,
  lookupHandle,
  sendRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  blockFromRequest,
  blockFriend,
  unblock,
  unfriend,
  setNickname,
  mintInvite,
  cancelInvite,
  underPeopleLimit,
  type SendOutcome,
  type AcceptOutcome,
} from "../social.js";
import { moveIntoSpawn, requireMemberRow } from "../member-move.js";
import type { SocialTier } from "../social-db.js";

const rateLimited = (c: Context<ApiEnv>) =>
  c.json({ error: "rate_limited" as const, message: "Too many attempts — try again later" }, 429);
const profileDisabled = (c: Context<ApiEnv>) =>
  c.json({ error: "profile_disabled" as const, message: "Friend features aren't available on this deployment" }, 403);
const notFound = (c: Context<ApiEnv>, message: string) =>
  c.json({ error: "not_found" as const, message }, 404);

function tierOf(v: unknown): SocialTier | null {
  return v === "household" || v === "friend" ? v : null;
}

/** Map a send outcome to HTTP — the honest errors are distinguishable; delivered,
 *  deduped, and swallowed sends share ONE body. */
function sendResponse(c: Context<ApiEnv>, outcome: SendOutcome) {
  switch (outcome.kind) {
    case "profile_disabled":
      return profileDisabled(c);
    case "validation_failed":
      return c.json({ error: "validation_failed" as const, message: outcome.message }, 400);
    case "not_found":
      return notFound(c, "No member with that handle");
    case "own_household":
      return c.json({ error: "own_household" as const, message: "They're already in your household" }, 409);
    case "already_friends":
      return c.json({ error: "already_friends" as const, message: "You're already friends with their household" }, 409);
    case "cap_reached":
      return c.json(
        { error: "cap_reached" as const, message: "You have too many outstanding requests — cancel some first" },
        409,
      );
    case "ok":
      return c.json({ sent: true as const });
  }
}

function acceptResponse(c: Context<ApiEnv>, outcome: AcceptOutcome) {
  switch (outcome.kind) {
    case "profile_disabled":
      return profileDisabled(c);
    case "not_found":
      return notFound(c, "That request is gone");
    case "household_full":
      return c.json({ error: "household_full" as const, message: "That household is full" }, 409);
    case "multi_member":
      return c.json({ error: "leave_first" as const, message: outcome.message }, 409);
    case "confirm_required":
      return c.json({
        status: "confirm_required" as const,
        not_carried_over: outcome.not_carried_over,
        reconnect: outcome.reconnect,
      });
    case "ok":
      return c.json({ status: "ok" as const });
  }
}

export const peopleArea = new Hono<ApiEnv>()
  // The one aggregate the page AND the sidebar badge derive from (shared-derivation).
  .get("/people", requireSession, async (c) => {
    return c.json(await assemblePeople(c.env, c.get("tenant")));
  })
  // Exact-@handle lookup (no browse/search/prefix path exists anywhere).
  .post("/people/lookup", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underPeopleLimit(c.env, "lookup", tenant.member, ip, Date.now()))) return rateLimited(c);
    const body = await jsonBody<{ tier?: unknown; handle?: unknown }>(c);
    const tier = tierOf(body.tier);
    if (!tier || typeof body.handle !== "string") {
      return c.json({ error: "validation_failed" as const, message: "tier and handle are required" }, 400);
    }
    const outcome = await lookupHandle(c.env, tier, body.handle);
    if (outcome.kind === "profile_disabled") return profileDisabled(c);
    if (outcome.kind === "not_found") return c.json({ found: false as const });
    return c.json({ found: true as const, handle: outcome.handle });
  })
  // Send a request (both tiers). One success body for delivered/deduped/swallowed.
  .post("/people/requests", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underPeopleLimit(c.env, "send", tenant.member, ip, Date.now()))) return rateLimited(c);
    const body = await jsonBody<{ tier?: unknown; handle?: unknown; note?: unknown; display_name?: unknown }>(c);
    const tier = tierOf(body.tier);
    if (!tier || typeof body.handle !== "string") {
      return c.json({ error: "validation_failed" as const, message: "tier and handle are required" }, 400);
    }
    const outcome = await sendRequest(c.env, tenant, {
      tier,
      handle: body.handle,
      note: typeof body.note === "string" ? body.note : undefined,
      display_name: typeof body.display_name === "string" ? body.display_name : undefined,
    });
    return sendResponse(c, outcome);
  })
  .post("/people/requests/:id/accept", requireSession, async (c) => {
    const body = await jsonBody<{ confirm?: unknown; display_name?: unknown }>(c).catch(() => ({}) as Record<string, unknown>);
    const outcome = await acceptRequest(c.env, c.get("tenant"), c.req.param("id"), {
      confirm: body.confirm === true,
      display_name: typeof body.display_name === "string" ? body.display_name : undefined,
    });
    return acceptResponse(c, outcome);
  })
  .post("/people/requests/:id/decline", requireSession, async (c) => {
    const outcome = await declineRequest(c.env, c.get("tenant"), c.req.param("id"));
    return outcome.kind === "ok" ? c.json({ status: "ok" as const }) : notFound(c, "That request is gone");
  })
  .post("/people/requests/:id/cancel", requireSession, async (c) => {
    const outcome = await cancelRequest(c.env, c.get("tenant"), c.req.param("id"));
    return outcome.kind === "ok" ? c.json({ status: "ok" as const }) : notFound(c, "That request is gone");
  })
  // Mint a block from an inbox/awaiting row (`request_id`) or a friend row (`tenant`).
  .post("/people/blocks", requireSession, async (c) => {
    const body = await jsonBody<{ request_id?: unknown; tenant?: unknown }>(c);
    if (typeof body.request_id === "string" && body.request_id) {
      const outcome = await blockFromRequest(c.env, c.get("tenant"), body.request_id);
      return outcome.kind === "ok" ? c.json({ status: "ok" as const }) : notFound(c, "That request is gone");
    }
    if (typeof body.tenant === "string" && body.tenant) {
      await blockFriend(c.env, c.get("tenant"), body.tenant);
      return c.json({ status: "ok" as const });
    }
    return c.json({ error: "validation_failed" as const, message: "request_id or tenant is required" }, 400);
  })
  // Unblock: a plain delete; nothing swallowed while blocked is retroactively delivered.
  .delete("/people/blocks", requireSession, async (c) => {
    const body = await jsonBody<{ tier?: unknown; tenant?: unknown }>(c);
    const tier = tierOf(body.tier);
    if (!tier || typeof body.tenant !== "string") {
      return c.json({ error: "validation_failed" as const, message: "tier and tenant are required" }, 400);
    }
    const outcome = await unblock(c.env, c.get("tenant"), tier, body.tenant);
    return outcome.kind === "ok" ? c.json({ status: "ok" as const }) : notFound(c, "No such block");
  })
  // Unfriend: silent, any member of either household, behind a client-side confirm.
  .delete("/people/friends/:tenant", requireSession, async (c) => {
    await unfriend(c.env, c.get("tenant"), c.req.param("tenant"));
    return c.json({ status: "ok" as const });
  })
  // Nickname upsert / empty-save clear — the page's ONE class (b) write, keyed by the
  // canonical (viewer, target) pair so an offline replay converges.
  .put("/people/nicknames/:member", requireSession, async (c) => {
    const body = await jsonBody<{ nickname?: unknown }>(c);
    const outcome = await setNickname(
      c.env,
      c.get("tenant"),
      c.req.param("member"),
      typeof body.nickname === "string" ? body.nickname : "",
    );
    switch (outcome.kind) {
      case "validation_failed":
        return c.json({ error: "validation_failed" as const, message: outcome.message }, 400);
      case "self":
        return c.json({ error: "validation_failed" as const, message: "You can't nickname yourself" }, 400);
      case "not_found":
        return notFound(c, "No such member");
      case "ok":
        return c.json({ status: "ok" as const, cleared: outcome.cleared });
    }
  })
  // Invite links: mint + cancel (= revoke, oracle-free downstream on /join).
  .post("/people/invites", requireSession, async (c) => {
    const body = await jsonBody<{ tier?: unknown }>(c);
    const tier = tierOf(body.tier);
    if (!tier) return c.json({ error: "validation_failed" as const, message: "tier is required" }, 400);
    const outcome = await mintInvite(c.env, c.get("tenant"), tier);
    if (outcome.kind === "profile_disabled") return profileDisabled(c);
    return c.json({ token: outcome.token, tier: outcome.tier, expires_at: outcome.expires_at });
  })
  .delete("/people/invites/:token", requireSession, async (c) => {
    const outcome = await cancelInvite(c.env, c.get("tenant"), c.req.param("token"));
    return outcome.kind === "ok" ? c.json({ status: "ok" as const }) : notFound(c, "That link is gone");
  })
  // Leave-household: move into a freshly spawned single-member household (D23). The
  // caller's session record is re-keyed by the move, so the SPA just refetches whoami.
  .post("/people/leave", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const row = await requireMemberRow(c.env, tenant.id, tenant.member);
    const { tenant: spawned } = await moveIntoSpawn(c.env, row, Date.now());
    return c.json({ status: "ok" as const, tenant: { id: spawned, member: tenant.member } });
  })
  // Member-remove (eviction): any-member authority, confirm client-side; the evictee
  // keeps their account/credentials/handle in a spawned household.
  .post("/people/members/:member/remove", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const target = c.req.param("member");
    if (target === tenant.member) {
      return c.json({ error: "validation_failed" as const, message: "Use leave-household to remove yourself" }, 400);
    }
    const row = await requireMemberRow(c.env, tenant.id, target);
    const { tenant: spawned } = await moveIntoSpawn(c.env, row, Date.now());
    return c.json({ status: "ok" as const, moved_to: spawned });
  });
