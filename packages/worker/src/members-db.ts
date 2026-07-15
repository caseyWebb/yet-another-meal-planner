// D1 data layer for the `members` table (member-identity-split, multi-tenancy
// capability). One row per member within a tenant; the FOUNDING MEMBER's id and handle
// equal the canonical tenant id, which is what keeps every pre-split credential value a
// valid member id. This is the SINGLE place those rows are read/written, function-per-
// query like webauthn-db.ts/signup-db.ts — but over an injectable `Db` (src/db.ts)
// rather than an Env, because the admin lifecycle operations (src/admin.ts) close over
// an injected `deps.db` while the resolver (src/tenant.ts) passes `db(env)`. Either
// way every statement runs through src/db.ts (never `env.DB`), so a D1 failure
// surfaces as a structured `storage_error`.

import type { Db } from "./db.js";
import { ulid } from "./ids.js";

/**
 * The ONE new-mint handle grammar (households-friends-and-people-page Decision 2): every
 * NEW identity mint — member handles from join links and invitations, self-service
 * usernames (which become tenant ids and founding handles), operator-onboarded usernames
 * — validates against this. Everything already issued is grandfathered verbatim (no
 * read-path validation anywhere). Hyphens are deliberately OUTSIDE the grammar and
 * deliberately used by the member-move spawn suffix (`<handle>-2`), so machine-suffixed
 * tenant ids can never collide with a future mint.
 */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** True when `handle` satisfies the new-mint grammar. */
export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

/** The one human-facing description of the grammar (structured-error copy). */
export const HANDLE_GRAMMAR_MESSAGE =
  "Handles are 3–20 characters: lowercase letters, numbers, underscores";

/** Max members per household (Decision 3's placeholder bound — the household is a
 *  kitchen, not a group-share channel). Enforced at household-accept and join-link
 *  redemption, beside the D24 budgets in src/social.ts. */
export const HOUSEHOLD_MAX_MEMBERS = 8;

/** A member row: identity + display handle within the owning tenant (household). */
export interface MemberRow {
  id: string;
  tenant: string;
  handle: string;
  created_at: number;
}

/** The member `(id, tenant)` row, or null — the resolver's liveness check. */
export async function getMember(d: Db, id: string, tenant: string): Promise<MemberRow | null> {
  return d.first<MemberRow>(
    "SELECT id, tenant, handle, created_at FROM members WHERE tenant = ?1 AND id = ?2",
    tenant,
    id,
  );
}

/** How many members a tenant holds — drives the lazy founding-member convergence guard
 *  (mint only at zero) and the last-member refusal on member-revoke. */
export async function countMembers(d: Db, tenant: string): Promise<number> {
  const row = await d.first<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE tenant = ?1", tenant);
  return row?.n ?? 0;
}

/** Idempotently mint a tenant's founding member: `id = tenant = handle` (the invariant
 *  that makes every pre-split credential value a valid member id). INSERT OR IGNORE, so
 *  every tenant-creation path and the lazy convergence guard can call it safely. */
export async function insertFoundingMember(d: Db, tenant: string, now: number): Promise<void> {
  await d.run(
    "INSERT OR IGNORE INTO members (id, tenant, handle, created_at) VALUES (?1, ?2, ?3, ?4)",
    tenant,
    tenant,
    tenant,
    now,
  );
}

/** Delete one member row (member-revoke). Idempotent; the household's other rows stay. */
export async function deleteMember(d: Db, id: string, tenant: string): Promise<void> {
  await d.run("DELETE FROM members WHERE tenant = ?1 AND id = ?2", tenant, id);
}

/** Every member of a household, founding first then join order (the roster read). */
export async function listMembers(d: Db, tenant: string): Promise<MemberRow[]> {
  return d.all<MemberRow>(
    "SELECT id, tenant, handle, created_at FROM members WHERE tenant = ?1 ORDER BY (id = tenant) DESC, created_at ASC, id ASC",
    tenant,
  );
}

/** Exact-handle member lookup — the ONLY directory access shape any member surface has
 *  (no browse/search/prefix; `idx_members_handle` makes it a point read). */
export async function getMemberByHandle(d: Db, handle: string): Promise<MemberRow | null> {
  return d.first<MemberRow>(
    "SELECT id, tenant, handle, created_at FROM members WHERE handle = ?1",
    handle,
  );
}

/** The outcome of a non-founding member mint. `handle_taken` is the unique-index
 *  collision, surfaced structurally (deployment-wide handles, the signup precedent). */
export type MemberMintOutcome = { kind: "ok"; member: MemberRow } | { kind: "handle_taken" };

/**
 * Mint a NON-FOUNDING member: server-generated ULID id, member-chosen handle (the
 * caller validates the grammar and the size bound first). INSERT OR IGNORE + a changes
 * check turns the unique-handle race into a structured `handle_taken` rather than a
 * thrown storage_error — the atomic uniqueness gate, same idiom as the tenant claim.
 */
export async function insertMember(d: Db, tenant: string, handle: string, now: number): Promise<MemberMintOutcome> {
  const id = ulid(now);
  const res = await d.run(
    "INSERT OR IGNORE INTO members (id, tenant, handle, created_at) VALUES (?1, ?2, ?3, ?4)",
    id,
    tenant,
    handle,
    now,
  );
  if (res.changes !== 1) return { kind: "handle_taken" };
  return { kind: "ok", member: { id, tenant, handle, created_at: now } };
}

/** Re-home one member row (the member-move primitive's members-table arm). The id and
 *  handle NEVER change — WebAuthn user handles are burned into authenticators. */
export async function updateMemberTenant(d: Db, id: string, toTenant: string): Promise<void> {
  await d.run("UPDATE members SET tenant = ?2 WHERE id = ?1", id, toTenant);
}
