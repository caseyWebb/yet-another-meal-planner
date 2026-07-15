// Self-service signup orchestration (self-service-signup capability): validate a chosen
// username, redeem one slot of a group invite code, atomically claim the username in the D1
// registry, and — only after the claim wins — write the KV `tenant:<id>` allowlist entry that
// is the hot-path resolution authority. The caller (src/api/signup.ts) mints the standard
// session on success. This is web-app-only; the MCP `/authorize` surface never sees group codes.

import { directoryFromEnv, normalizeTenantId } from "./tenant.js";
import { getSignupInvite, redeemGroupInvite, registerExistingTenant } from "./signup-db.js";
import { insertFoundingMember, isValidHandle, HANDLE_GRAMMAR_MESSAGE } from "./members-db.js";
import { db } from "./db.js";
import type { Env } from "./env.js";

const TENANT_PREFIX = "tenant:"; // mirrors src/tenant.ts (the allowlist directory)

export type SignupOutcome =
  | { kind: "ok"; tenant: string }
  | { kind: "username_taken" }
  | { kind: "code_unusable" }
  | { kind: "invalid_username"; message: string };

/** Every NEW username validates the ONE product handle grammar (`HANDLE_RE`,
 *  src/members-db.ts) — a chosen username becomes the tenant id AND the founding
 *  handle, so tightening here is what stops the grandfather class regrowing.
 *  Everything already issued is grandfathered (no read-path validation anywhere). */
export function isValidUsername(id: string): boolean {
  return isValidHandle(id);
}

/**
 * Redeem a group invite code under a user-chosen username, creating a new isolated tenant.
 * Returns a discriminated outcome the endpoint maps to HTTP: `username_taken` is a deliberate,
 * bounded disclosure (design D9); every unusable-code case collapses to one uniform failure.
 */
export async function redeemGroupCode(
  env: Env,
  rawCode: string,
  rawUsername: string,
  now: number = Date.now(),
): Promise<SignupOutcome> {
  const code = (rawCode ?? "").trim();
  const id = normalizeTenantId(rawUsername ?? "");
  if (!id) return { kind: "invalid_username", message: "Choose a username" };
  if (!isValidUsername(id)) {
    return { kind: "invalid_username", message: HANDLE_GRAMMAR_MESSAGE };
  }

  if (!code) return { kind: "code_unusable" };

  // Gate the `username_taken` disclosure behind a usable code: without this, an unauthenticated
  // caller holding no valid code could probe which usernames are group members (a membership
  // oracle) — an unusable code + an existing name would 409, a free name would 401. So an
  // unusable code fails uniformly regardless of the username. The atomic spend in
  // redeemGroupInvite stays the real gate; this pre-read only closes the oracle, and any TOCTOU
  // between it and the spend can only under-grant (safe).
  const invite = await getSignupInvite(env, code);
  if (
    !invite ||
    invite.revoked_at != null ||
    (invite.expires_at != null && invite.expires_at <= now) ||
    invite.used >= invite.max_redemptions
  ) {
    return { kind: "code_unusable" };
  }

  // A plausibly-usable code is held, so `username_taken` is disclosed only to a real redeemer
  // (design D9). This KV pre-check catches a collision with an already-onboarded member; the D1
  // ON CONFLICT in redeemGroupInvite is the authority for the concurrent brand-new-name race.
  if (await env.TENANT_KV.get(`${TENANT_PREFIX}${id}`)) return { kind: "username_taken" };

  const outcome = await redeemGroupInvite(env, code, id, now);
  if (outcome.kind !== "ok") return outcome;

  // The D1 claim won — finish minting the tenant. NO friendship edge: a group code has
  // no inviter household to befriend (the edge belongs to the friend-invite path only).
  await finalizeNewTenant(env, id, now);
  return { kind: "ok", tenant: id };
}

/**
 * The tenant-creation CORE shared by every tenant-creating signup path (group codes
 * above, the friend-tier invite-link redemption in src/api/join.ts): mint the founding
 * member (id = handle = the claimed username), then write the KV allowlist entry,
 * mirroring onboard() (src/admin.ts). Member before allowlist so an allowlisted tenant
 * always has its member row (fails under-granting). The caller has already WON the D1
 * registry claim for `id` (redeemGroupInvite / claimTenant) and mints the session after.
 */
export async function finalizeNewTenant(env: Env, id: string, now: number): Promise<void> {
  await insertFoundingMember(db(env), id, now);
  await env.TENANT_KV.put(`${TENANT_PREFIX}${id}`, JSON.stringify({ id }));
}

/**
 * Idempotently register every KV-allowlist tenant into the D1 registry — the backfill that
 * makes the registry the complete forward record (design D8). Safe to re-run (ON CONFLICT DO
 * NOTHING); converges existing members with no operator action. Wired into the scheduled
 * reconcile. Correctness of collision-prevention does not depend on this having run — the KV
 * allowlist pre-check in redeemGroupCode already catches a collision with an existing member.
 */
export async function backfillTenantRegistry(
  env: Env,
  now: number = Date.now(),
): Promise<{ registered: number }> {
  const ids = await directoryFromEnv(env).list();
  for (const id of ids) await registerExistingTenant(env, id, now);
  return { registered: ids.length };
}
