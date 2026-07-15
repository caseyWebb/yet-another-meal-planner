// The member-move primitive (households-friends-and-people-page D23, multi-tenancy
// capability): ONE atomic relocation of member-scoped state between tenants, reused by
// leave-household, member-remove (eviction), and household-accept-with-dissolution.
//
// The explicit MOVE MANIFEST (design Decision 7) — what relocates:
//   * the `members` row (`tenant` column; id and handle NEVER change — WebAuthn user
//     handles are burned into authenticators),
//   * `webauthn_credentials` rows (`tenant` update),
//   * `nicknames` rows the member SET (`tenant` update; rows targeting them are stable
//     member-id references and survive untouched),
//   * live web sessions — a `session:*` scan re-writes records whose member matches to
//     the new tenant (the revoke paths' scan idiom, sharing the D2-aware
//     `resolvedPairOf` predicate), so sessions survive a move,
//   * outstanding KV bootstrap invites resolving to the member are DELETED (they encode
//     the old tenant; rotation re-mints if needed).
// Authored recipe_notes/store_notes are keyed by the stable member id — nothing to
// re-key. MCP grants deliberately do NOT survive (grant props are immutable): a moved
// member's old grants fail the resolver's `(tenant, member)` liveness pairing and the
// member re-connects Claude.ai — the flows state this.
//
// v1 deliberately EXCLUDES not-yet-member-keyed state (design Decision 8, flagged):
// overlay favorites/rejects, taste and dietary text, and cooking history remain
// HOUSEHOLD state — a leaver does not take them, and the household-accept confirmation
// enumerates them. A follow-on change member-keys those tables and EXTENDS this
// manifest; the primitive is manifest-shaped precisely so that extension is additive.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import {
  getMember,
  countMembers,
  listMembers,
  HOUSEHOLD_MAX_MEMBERS,
  type MemberRow,
} from "./members-db.js";
import { claimTenant } from "./signup-db.js";
import { SESSION_PREFIX, type SessionRecord } from "./session.js";
import {
  TENANT_TABLES,
  deleteInvitesFor,
  deleteInvitesForMember,
  resolvedPairOf,
} from "./admin.js";
import { KROGER_REFRESH_PREFIX, type KvStore } from "./kroger-user.js";

const TENANT_PREFIX = "tenant:"; // mirrors src/tenant.ts (the allowlist directory)

/**
 * The server-supplied NOT-CARRIED-OVER manifest the household-accept confirmation
 * renders (multi-tenancy: "every flow whose confirmation enumerates what does not carry
 * over SHALL include them"). One list, served — never duplicated client-side — so the
 * copy and the purge can't drift.
 */
export const NOT_CARRIED_OVER = [
  "pantry",
  "meal plan",
  "grocery list",
  "staples",
  "stock-up list",
  "ready-to-eat",
  "stores and store notes",
  "Kroger link",
  "favorites and rejects", // v1 reduction (Decision 8): not yet member-keyed
  "taste and dietary text", // v1 reduction (Decision 8)
  "cooking history", // v1 reduction (Decision 8)
] as const;

/** The re-connect line every move flow states (grants do not survive a move). */
export const RECONNECT_NOTE = "Your Claude.ai connection must be re-connected after the move.";

/**
 * Relocate one member `fromTenant` → `toTenant` per the manifest. Refuses to move a
 * tenant's LAST member unless `allowLastMember` (household-accept dissolution retires
 * the tenant in the same flow) and refuses a destination at the size bound. The D1 arms
 * run as ONE batch; the KV fixups (sessions, bootstrap invites) follow — a session this
 * scan missed is dead anyway (the resolver's `(id, tenant)` pairing rejects it, never
 * serving the old household's context).
 */
export async function moveMember(
  env: Env,
  member: MemberRow,
  toTenant: string,
  opts: { allowLastMember?: boolean } = {},
): Promise<void> {
  const d = db(env);
  const fromTenant = member.tenant;
  if (!opts.allowLastMember && (await countMembers(d, fromTenant)) <= 1) {
    throw new ToolError(
      "conflict",
      "You're the last member of your household — accept into another household (which dissolves this one) or ask your operator to remove it",
    );
  }
  if ((await countMembers(d, toTenant)) >= HOUSEHOLD_MAX_MEMBERS) {
    throw new ToolError(
      "conflict",
      `That household is full (max ${HOUSEHOLD_MAX_MEMBERS} members)`,
    );
  }
  await d.batch([
    d.prepare("UPDATE members SET tenant = ?2 WHERE id = ?1", member.id, toTenant),
    d.prepare(
      "UPDATE webauthn_credentials SET tenant = ?3 WHERE tenant = ?2 AND member = ?1",
      member.id,
      fromTenant,
      toTenant,
    ),
    d.prepare("UPDATE nicknames SET tenant = ?2 WHERE viewer_member = ?1", member.id, toTenant),
  ]);
  await rekeySessionsFor(env.TENANT_KV, fromTenant, member.id, toTenant);
  await deleteInvitesForMember(env.TENANT_KV, fromTenant, member.id);
}

/**
 * Re-write every live `session:*` record resolving to `(fromTenant, member)` so it
 * carries `toTenant` — the same scan-by-value pattern and the same D2-aware
 * `resolvedPairOf` matching as the revoke paths (a pre-split record with no member
 * field belongs to the founding member). Sessions survive a move (D23).
 */
async function rekeySessionsFor(
  kv: KVNamespace,
  fromTenant: string,
  member: string,
  toTenant: string,
): Promise<number> {
  let rekeyed = 0;
  let cursor: string | undefined;
  for (;;) {
    const res = await kv.list({ prefix: SESSION_PREFIX, cursor });
    for (const k of res.keys) {
      const value = await kv.get(k.name);
      if (value === null) continue;
      try {
        const record = JSON.parse(value) as SessionRecord;
        const pair = resolvedPairOf(record);
        if (pair && pair.tenant === fromTenant && pair.member === member) {
          const rewritten: SessionRecord = { ...record, tenant: toTenant, member };
          await kv.put(k.name, JSON.stringify(rewritten));
          rekeyed++;
        }
      } catch {
        // Not a session record shape — leave it to the KV TTL.
      }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return rekeyed;
}

/**
 * Mint the tenant id a leave/eviction spawn targets: the mover's handle when free, else
 * the smallest `-N` hyphen suffix (N from 2). The hyphen is deliberately OUTSIDE the
 * new-mint handle grammar, so suffixed ids can never collide with a future mint. "Free"
 * is decided by the atomic D1 registry claim (`claimTenant`) after a KV-allowlist
 * pre-check (a legacy allowlisted tenant may trail the registry).
 */
export async function claimSpawnTenantId(env: Env, handle: string, now: number): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? handle : `${handle}-${n}`;
    if (await env.TENANT_KV.get(`${TENANT_PREFIX}${candidate}`)) continue;
    if (await claimTenant(env, candidate, now)) return candidate;
  }
  throw new ToolError("conflict", "Could not find a free household id — contact your operator");
}

/**
 * Leave-household / member-remove: move `member` into a FRESHLY SPAWNED single-member
 * household (registry row via the atomic claim, blank state, allowlist entry written
 * AFTER the member row moves so an allowlisted tenant always has its member). The
 * mover keeps their id and handle (the spawned household's founder — the founding
 * id-equals-tenant invariant is scoped to onboarding/signup-created tenants); the old
 * household keeps ALL household-scoped state including its whole cookbook (the mover
 * takes NO recipe_imports rows — the D3 cold start).
 */
export async function moveIntoSpawn(env: Env, member: MemberRow, now: number): Promise<{ tenant: string }> {
  const d = db(env);
  if ((await countMembers(d, member.tenant)) <= 1) {
    throw new ToolError(
      "conflict",
      "The last member can't leave or be removed — accept into another household (dissolving this one) or ask your operator to purge the household",
    );
  }
  const spawned = await claimSpawnTenantId(env, member.handle, now);
  await moveMember(env, member, spawned);
  await env.TENANT_KV.put(`${TENANT_PREFIX}${spawned}`, JSON.stringify({ id: spawned }));
  return { tenant: spawned };
}

/**
 * Household-accept for a mover who is the SOLE member of their existing household:
 * member-move PLUS tenant dissolution (design Decision 9). The caller has already
 * gathered the explicit confirmation rendered from NOT_CARRIED_OVER. Steps: (1) refuse
 * multi-member movers (leave-household first — v1 never merges wholesale) and a full
 * destination; (2) move the member; (3) re-key the old tenant's `recipe_imports` to the
 * absorbing household (INSERT OR IGNORE under the `(recipe, tenant)` PK — first
 * provenance wins where the absorber already holds a grant — then delete the old rows);
 * (4) purge the old household state via the revoke-shaped table sweep MINUS
 * member-scoped rows (the mover's rows already relocated) with outgoing requests
 * cancelled, invite links revoked, and friendships severed; (5) retire the old tenant:
 * allowlist entry, registry row, bootstrap invites, Kroger token.
 */
export async function absorbSoleMemberHousehold(
  env: Env,
  member: MemberRow,
  destTenant: string,
  now: number,
): Promise<void> {
  const d = db(env);
  const oldTenant = member.tenant;
  if ((await countMembers(d, oldTenant)) > 1) {
    throw new ToolError(
      "conflict",
      "You're in a household with other members — leave your household first, then accept",
    );
  }
  // (2) The move itself (allowLastMember: this flow retires the old tenant).
  await moveMember(env, member, destTenant, { allowLastMember: true });

  // (3) + (4) One atomic batch: grant re-key, then the revoke-shaped household sweep.
  // The member-scoped rows (members, webauthn_credentials, viewer nicknames) already
  // carry the new tenant, so the `tenant = old` sweeps are no-ops for them by
  // construction — no member-scoped exclusion list to maintain.
  await d.batch([
    d.prepare(
      "INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) " +
        "SELECT recipe, ?2, member, via, imported_at FROM recipe_imports WHERE tenant = ?1",
      oldTenant,
      destTenant,
    ),
    // The old tenant's outgoing requests are CANCELLED (never delivered again); inbound
    // pending rows are left — their senders' awaiting rows keep reading "Request sent",
    // indistinguishable from an unanswered request (D24's posture). resolved_at stays
    // NULL so these flips never read as decline anchors in the cooldown probe.
    d.prepare(
      "UPDATE social_requests SET state = 'cancelled', resolved_at = NULL WHERE from_tenant = ?1 AND state = 'pending'",
      oldTenant,
    ),
    d.prepare(
      "UPDATE member_invites SET revoked_at = ?2 WHERE tenant = ?1 AND revoked_at IS NULL AND redeemed_at IS NULL",
      oldTenant,
      now,
    ),
    d.prepare("DELETE FROM friendships WHERE tenant_a = ?1 OR tenant_b = ?1", oldTenant),
    ...TENANT_TABLES.map((t) => d.prepare(`DELETE FROM ${t} WHERE tenant = ?1`, oldTenant)),
    d.prepare("DELETE FROM tenants WHERE id = ?1", oldTenant),
  ]);

  // (5) Retirement lock-out: the allowlist entry, remaining bootstrap invites, the
  // Kroger refresh token. The mover's sessions were re-keyed by the move itself.
  await env.TENANT_KV.delete(`${TENANT_PREFIX}${oldTenant}`);
  await deleteInvitesFor(env.TENANT_KV, oldTenant);
  await (env.KROGER_KV as unknown as KvStore).delete(`${KROGER_REFRESH_PREFIX}${oldTenant}`);
}

/**
 * Guard for household-accept entry points: the mover's current membership shape decides
 * the flow — `sole` (move + dissolution after the confirmation), `multi` (refused with
 * the leave-first pointer). Also re-checks the destination bound so the client can
 * refuse before rendering the confirmation.
 */
export async function acceptPreflight(
  env: Env,
  mover: MemberRow,
  destTenant: string,
): Promise<{ shape: "sole" | "multi"; destination_full: boolean }> {
  const d = db(env);
  const [own, dest] = await Promise.all([countMembers(d, mover.tenant), countMembers(d, destTenant)]);
  return { shape: own <= 1 ? "sole" : "multi", destination_full: dest >= HOUSEHOLD_MAX_MEMBERS };
}

/** Convenience: resolve a member row or reject with the shared unauthorized shape. */
export async function requireMemberRow(env: Env, tenant: string, member: string): Promise<MemberRow> {
  const row = await getMember(db(env), member, tenant);
  if (!row) throw new ToolError("not_found", `No member ${member} in ${tenant}`);
  return row;
}

/** The full roster read the People page and profile export share. */
export async function householdMembers(env: Env, tenant: string): Promise<MemberRow[]> {
  return listMembers(db(env), tenant);
}
