// Self-service signup orchestration (self-service-signup capability): validate a chosen
// username, redeem one slot of a group invite code, atomically claim the username in the D1
// registry, and — only after the claim wins — write the KV `tenant:<id>` allowlist entry that
// is the hot-path resolution authority. The caller (src/api/signup.ts) mints the standard
// session on success. This is web-app-only; the MCP `/authorize` surface never sees group codes.

import { directoryFromEnv, normalizeTenantId } from "./tenant.js";
import { getSignupInvite, redeemGroupInvite, registerExistingTenant } from "./signup-db.js";
import type { Env } from "./env.js";

const TENANT_PREFIX = "tenant:"; // mirrors src/tenant.ts (the allowlist directory)

export type SignupOutcome =
  | { kind: "ok"; tenant: string }
  | { kind: "username_taken" }
  | { kind: "code_unusable" }
  | { kind: "invalid_username"; message: string };

// 2–31 chars, canonical lowercase: a letter/digit start then letters/digits/hyphen/underscore.
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;

export function isValidUsername(id: string): boolean {
  return USERNAME_RE.test(id);
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
    return {
      kind: "invalid_username",
      message: "Usernames are 2–31 characters: lowercase letters, numbers, hyphens, underscores",
    };
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

  // The D1 claim won — write the KV allowlist entry now that we own the name, mirroring
  // onboard()'s `tenant:<id>` record shape (src/admin.ts).
  await env.TENANT_KV.put(`${TENANT_PREFIX}${id}`, JSON.stringify({ id }));
  return { kind: "ok", tenant: id };
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
