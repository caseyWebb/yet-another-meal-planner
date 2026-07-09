// D1 access for self-service signup (self-service-signup capability): the operator's group
// invite codes (`signup_invites`), their provenance (`signup_redemptions`), and the tenant
// uniqueness registry (`tenants`). All access goes through src/db.ts — never `env.DB`
// directly — so every failure maps to a structured storage_error. This store is deliberately
// SEPARATE from the KV `invite:<code>` bootstrap path (src/tenant.ts): a group code CREATES a
// tenant here, whereas a KV bootstrap RESOLVES an existing one.

import { db } from "./db.js";
import type { Env } from "./env.js";

export interface SignupInviteRow {
  code: string;
  max_redemptions: number;
  used: number;
  expires_at: number | null;
  revoked_at: number | null;
  label: string | null;
  created_at: number;
}

/** A group code plus the tenant ids created through it (provenance), for the admin roster. */
export interface SignupInviteWithUsage extends SignupInviteRow {
  redemptions: string[];
}

export type RedeemResult =
  | { kind: "ok" }
  | { kind: "username_taken" }
  | { kind: "code_unusable" };

/** Create a group invite code (operator mint). */
export async function createSignupInvite(
  env: Env,
  row: { code: string; maxRedemptions: number; expiresAt: number | null; label: string | null; now: number },
): Promise<void> {
  await db(env).run(
    `INSERT INTO signup_invites(code, max_redemptions, used, expires_at, revoked_at, label, created_at)
       VALUES(?1, ?2, 0, ?3, NULL, ?4, ?5)`,
    row.code,
    row.maxRedemptions,
    row.expiresAt,
    row.label,
    row.now,
  );
}

export async function getSignupInvite(env: Env, code: string): Promise<SignupInviteRow | null> {
  return db(env).first<SignupInviteRow>(`SELECT * FROM signup_invites WHERE code = ?1`, code);
}

/** Every group code with its live usage and provenance, newest first. */
export async function listSignupInvites(env: Env): Promise<SignupInviteWithUsage[]> {
  const d = db(env);
  const invites = await d.all<SignupInviteRow>(`SELECT * FROM signup_invites ORDER BY created_at DESC`);
  const reds = await d.all<{ code: string; tenant: string }>(
    `SELECT code, tenant FROM signup_redemptions ORDER BY created_at ASC`,
  );
  const byCode = new Map<string, string[]>();
  for (const r of reds) {
    const list = byCode.get(r.code) ?? [];
    list.push(r.tenant);
    byCode.set(r.code, list);
  }
  return invites.map((inv) => ({ ...inv, redemptions: byCode.get(inv.code) ?? [] }));
}

/** Revoke a group code so it admits no further signups. Accounts already created are untouched. */
export async function revokeSignupInvite(env: Env, code: string, now: number): Promise<{ revoked: boolean }> {
  const res = await db(env).run(
    `UPDATE signup_invites SET revoked_at = ?2 WHERE code = ?1 AND revoked_at IS NULL`,
    code,
    now,
  );
  return { revoked: res.changes === 1 };
}

/**
 * Redeem one slot of a group code and atomically claim `tenantId`. Phased so every
 * intermediate state fails toward UNDER-granting, never over-granting — no cross-statement
 * transaction is required (see design D3):
 *
 *   1. Guarded cap UPDATE — the atomic gate. `used < max_redemptions` is evaluated inside a
 *      single serialized statement, so at most `max_redemptions` of these can ever succeed:
 *      the cap is never exceeded, even under concurrent redemptions.
 *   2. INSERT tenants ON CONFLICT DO NOTHING — the atomic uniqueness gate. Two racers for the
 *      same brand-new username: exactly one gets changes === 1. On collision we REFUND the
 *      slot, so a taken name spends nothing.
 *   3. Record provenance.
 *
 * A crash between phases can at worst waste a slot (safe direction); it can never exceed the
 * cap or let two people claim one name. A genuine D1 failure throws a storage_error (the
 * ON CONFLICT clause means a name collision is a 0-row no-op, NOT a throw).
 */
export async function redeemGroupInvite(
  env: Env,
  code: string,
  tenantId: string,
  now: number,
): Promise<RedeemResult> {
  const d = db(env);

  const spend = await d.run(
    `UPDATE signup_invites SET used = used + 1
       WHERE code = ?1 AND used < max_redemptions
         AND (expires_at IS NULL OR expires_at > ?2)
         AND revoked_at IS NULL`,
    code,
    now,
  );
  if (spend.changes !== 1) return { kind: "code_unusable" };

  const claim = await d.run(
    `INSERT INTO tenants(id, created_at, via_code) VALUES(?1, ?2, ?3)
       ON CONFLICT(id) DO NOTHING`,
    tenantId,
    now,
    code,
  );
  if (claim.changes !== 1) {
    await d.run(`UPDATE signup_invites SET used = used - 1 WHERE code = ?1`, code);
    return { kind: "username_taken" };
  }

  await d.run(
    `INSERT INTO signup_redemptions(code, tenant, created_at) VALUES(?1, ?2, ?3)`,
    code,
    tenantId,
    now,
  );
  return { kind: "ok" };
}

/** Whether a tenant id already exists in the D1 registry. */
export async function tenantExists(env: Env, id: string): Promise<boolean> {
  const row = await db(env).first<{ one: number }>(`SELECT 1 AS one FROM tenants WHERE id = ?1`, id);
  return row != null;
}

/**
 * Idempotently register an existing (operator-onboarded) tenant in the registry — the
 * backfill of the KV allowlist. `via_code` is NULL because it predates any group code.
 */
export async function registerExistingTenant(env: Env, id: string, now: number): Promise<void> {
  await db(env).run(
    `INSERT INTO tenants(id, created_at, via_code) VALUES(?1, ?2, NULL) ON CONFLICT(id) DO NOTHING`,
    id,
    now,
  );
}
