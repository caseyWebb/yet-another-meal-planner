## Context

Identity today is one layer deep. The MCP path resolves a grant's props `{ tenantId }` through `resolveTenant` (KV `tenant:<id>` allowlist re-check) and builds the server for a `Tenant { id }`; the `/api` path reads `session:<token>` from `TENANT_KV` (`{ tenant, created_at, refreshed_at }`) and resolves the same `Tenant`. WebAuthn registration sets the user handle to the tenant id (`isoUint8Array.fromUTF8String(tenant)` in `src/webauthn.ts`) and stores tenant-keyed rows in `webauthn_credentials`; assertions resolve tenant straight off the credential row. Bootstrap invites (`invite:<code>` in KV, JSON `{ v, tenant, single_use, expires_at }` or a legacy bare-username string) resolve to a tenant. The cross-device approval record `authz:<ref>` binds a tenant. `recipe_notes.author` / `store_notes.author` receive the caller's tenant id. Operator revocation (`revoke()` in `src/admin.ts`) purges the whole tenant: `TENANT_TABLES` by `tenant`, `AUTHOR_TABLES` by `author`, the `tenants` registry row, the allowlist entry, invite/session KV scans, the Kroger token.

D10 (verified against this exact code) mandates the split: a `members` table; a founding member per tenant whose id equals the tenant id, because WebAuthn user handles are burned into authenticators and D9 forbids surgery; the member dimension added to grant props, session records, and `webauthn_credentials`; `(tenantId, memberId)` resolved on both paths before anything runs; invite codes minting/resolving pairs; the operator lifecycle split into member-revoke vs household-purge. Tenant remains the isolation boundary (D1: tenant = household); member is attribution within it.

Constraints from the repo: D1 schema changes ship a numbered migration under `packages/worker/migrations/d1/` (highest today: `0057`; the number space contains historical duplicates at 0018/0045/0047 — do not add another); all D1 access goes through `db(env)` (`src/db.ts`); production data converges through shipped pipeline changes, never manual surgery; the repo is public, no secrets. Remote production reads were permission-denied during planning, so current-shape claims are derived from migrations + code and re-verified pre-merge (see Migration Plan).

## Goals / Non-Goals

**Goals:**

- One `members` table as the deployment's member-identity substrate, with the founding-member invariant making every already-issued credential value a valid member id.
- One shared `(tenantId, memberId)` resolver used by the MCP handler, the `/api` session middleware, and the passkey login — allowlist re-check plus member liveness — so revocation semantics are identical on every surface.
- One legacy-defaulting rule (absent member dimension ⇒ founding member) applied uniformly to grant props, session records, bootstrap invites, and approval references.
- Member-bound credential issuance from this change forward: grants, sessions, passkeys, and invites all record which member they belong to.
- The operator lifecycle split, with today's revoke behavior preserved verbatim as household-purge.
- Zero re-keying, proven by tests over the real migration chain and by the gated production fixture capture.

**Non-Goals:**

- Member columns on domain tables; member-scoped splits of favorites/taste/cook-log/follows (each lands with its feature change, mostly `households-friends-and-people-page`).
- Handle grammar enforcement, handle lookup, rename, directory UX (People change, band 7b).
- Any tool contract change (`read_user_profile` members export deferred — see proposal non-goals), any persona edit, any member-facing or admin-facing UI change.
- Multi-member creation. After this change every household still has exactly one member; the People change mints the second and later members.
- Grant metadata / session metadata tables (band 7a), member-move (D23), block (D24), friend graph, lens work.
- Rewriting the stale `claude-ai-connector` Access-era text wholesale (flagged to the orchestrator; this change only adds the member-binding requirement).

## Decisions

### D1. `members` DDL: TEXT id, founding id = tenant id, deployment-unique handle

```sql
CREATE TABLE IF NOT EXISTS members (
  id         TEXT PRIMARY KEY,   -- opaque member id; founding member: equals the tenant id
  tenant     TEXT NOT NULL,      -- owning household (isolation column)
  handle     TEXT NOT NULL,      -- deployment-unique display key; founding: equals the tenant id
  created_at INTEGER NOT NULL    -- epoch ms, matching the tenants registry idiom
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_handle ON members(handle);
CREATE INDEX IF NOT EXISTS idx_members_tenant ON members(tenant);
```

Exactly D10's column set. `id` is an opaque TEXT key: founding ids are tenant ids (usernames); ids minted for future non-founding members are expected to be ULIDs (the People change owns that mint — nothing in this change depends on the choice, and WebAuthn's 64-byte user-handle cap accommodates both). `handle` gets its unique index NOW so uniqueness is never retrofitted; founding handles are the tenant ids verbatim, grandfathered even where they fall outside the product handle grammar `[a-z0-9_]{3,20}` (the shipped `USERNAME_RE` admits hyphens and 2-31 chars — flagged in Risks). No FK to `tenants` — tenant identity is a KV/registry concept and per-tenant tables deliberately carry bare `tenant` columns; `members` follows the house idiom.

*Alternative rejected:* a surrogate ULID for founding members with a mapping table. It re-keys nothing physically but forces every legacy credential read through a mapping join and contradicts D10's stated mechanism (member id EQUALS tenant id).

### D2. One legacy-defaulting rule, stated once, applied everywhere

Any credential record that predates the split lacks a member dimension. Rule: **a missing member field resolves to the founding member — `memberId = tenantId`**. Applied to: OAuth grant props `{ tenantId }` (immutable in the library-managed store; defaulted forever), session records without `member` (converge naturally via the rolling refresh re-put, which now writes `member`), bootstrap invite records without `member` and legacy bare-string invites, and `authz:<ref>` approval records without `member`. `webauthn_credentials` is D1 and is backfilled in the migration (`member = tenant`), so no defaulting is needed at read time there — but the same rule holds if a NULL is ever observed.

*Alternative rejected:* a KV rewrite pass over grants/sessions/invites. The OAuth store is library-managed (grant props are not safely editable in place), sessions expire within 90 days anyway, and D9/D10 forbid surgery; defaulting is deterministic and testable.

### D3. One shared identity resolver; `Tenant` context gains `member`; guarded lazy convergence

`resolveTenant` grows into (or is wrapped by) a single `resolveIdentity(env, tenantId, memberId?)` used by the MCP handler (`src/index.ts`), `requireSession` (`src/session.ts`), and passkey login. Steps: canonicalize + allowlist re-check exactly as today; apply D2's defaulting when `memberId` is absent; then member liveness — the `(id, tenant)` row must exist in `members`. The resolved context type `Tenant` gains a `member: string` field (`{ id, member }`), so `buildServer(env, tenant, origin)` and every `/api` handler get attribution without signature churn; tools keep closing over `tenant.id` for isolation and now read `tenant.member` for attribution.

**Lazy convergence guard:** if the member row is missing AND `memberId === tenantId` AND the tenant has zero `members` rows, the resolver upserts the founding member row and proceeds. This heals any tenant the migration seed missed (the seed reads the `tenants` registry, which is itself a backfill-converged copy of the KV allowlist — a KV-only straggler would otherwise 401). The two guards are load-bearing: minting only when the tenant has *zero* member rows means a revoked founding member of a future multi-member household can never be resurrected by an old token, and minting only the founding id means no other id can be conjured. A missing member row in any other case is a structured `unauthorized` — this is exactly how member-revoke kills grants/sessions/passkeys without touching the OAuth store.

*Alternative rejected:* migration-seed only, no lazy guard. It leaves a theoretical KV-allowlisted-but-unregistered tenant hard-locked out; the guard is the repo's "heal existing data organically" doctrine applied to identity.

### D4. WebAuthn: user handle IS the member id; `member` column backfilled to `tenant`

The invariant becomes: **the WebAuthn user handle is always the member id.** For every existing credential the burned-in handle is the tenant id, which the founding-member invariant makes the correct member id — this is the whole reason D10 pins founding id = tenant id. The migration adds `member TEXT` to `webauthn_credentials` (SQLite ALTER ADD COLUMN, nullable) and backfills `member = tenant`; code treats the column as required and always writes it. `beginRegistration` sets `userID = member id` and `userName`/`userDisplayName` = the member's handle; enrollment binds the session's resolved member. Assertion → `getCredentialById` → `(tenant, member)` → `resolveIdentity` → member-bound session. First enrollment consumes the invites resolving to that member (today: `deleteInvitesFor(kv, tenant)` — becomes member-scoped matching, which is value-identical for founding members).

### D5. Grant props gain `memberId`; `userId` stays the tenant id

Both `completeAuthorization` call sites in `src/authorize.ts` change props to `{ tenantId, memberId }`, where `memberId` comes from the approval reference (cross-device path) or the invite resolution (legacy grace path). `userId` **stays `tenantId`**: the admin roster's active/pending derivation prefix-scans `OAUTH_KV` `grant:<userId>:*` and maps userId → tenant; keying grants by member would silently break the roster and change the library's grant grouping. The `authz:<ref>` connect-approval record gains `member` (the approving session's member).

### D6. Invites mint/resolve `(tenant, member)`

The bootstrap invite JSON gains `member` (`{ v, tenant, member, single_use, expires_at }`); `resolveInvite` returns `{ tenant, member, kind }`, applying D2 to legacy records. `onboard()` mints tenant + founding member row (D1 `members` insert beside the existing `tenants` registry insert) + a founding-member invite. `rotate()` becomes member-addressed with the founding member as the default — the admin surface passes only the tenant id today, which is also the founding member id, so the endpoint contract is unchanged. Group-code signup (`redeemGroupCode`) inserts the founding member row in the same flow that claims the username and writes the allowlist entry, and the signup session is minted member-bound.

### D7. Operator lifecycle: household-purge = today's revoke (+ members rows); member-revoke is new and refuses the last member

- **Household-purge** is `revoke()` as it stands, with `members` added to `TENANT_TABLES` so members rows purge with the household. Same admin route, same observable behavior — the rename is conceptual.
- **Member-revoke** (`revokeMember(deps, tenant, member)`, new Access-gated admin operation): deletes the member row, the member's `webauthn_credentials` rows, every `session:*` record resolving to that member (D2-aware match), every `invite:*` resolving to that member, and the member's `AUTHOR_TABLES` rows (`author = member id`). It does NOT touch the allowlist, the `tenants` registry, the Kroger token, or household tables. The member's outstanding MCP grants die via D3's liveness check — the same posture the existing revoke takes toward the OAuth store.
- **Last-member rule:** member-revoke of a tenant's only member is refused with a structured error naming household-purge as the operation the operator wants. An empty-but-allowlisted household would be a half-revoked zombie no flow expects; and the open household-governance question (story 01 §5 q3, which also governs last-member revoke for member-initiated flows) stays open — this rule is operator-surface-only and the People change can relax it deliberately.
- No admin UI change: with one member per household the roster's Revoke action maps to household-purge exactly as today. Member-revoke ships as an admin API operation; the roster-by-household UI regrouping belongs to the People change.

### D8. Attribution writers stamp `ctx.member`

`notes-tools.ts` (and the `store_notes` path) pass `tenant.member` as `author` instead of `tenant.id`. Byte-identical today (founding member), correct the day the People change mints member #2. The notes read path's self-scoping (`author = caller`, private-note visibility) switches to the member id the same way. No other writer changes: `cooking_log` etc. have no author column and get their member dimension with their own feature changes.

### D9. Migration `0058_member_identity.sql` — one file, three statements groups

(1) `CREATE TABLE members` + indexes; (2) idempotent founding-member seed: `INSERT OR IGNORE INTO members (id, tenant, handle, created_at) SELECT id, id, id, created_at FROM tenants`; (3) `ALTER TABLE webauthn_credentials ADD COLUMN member TEXT` + `UPDATE webauthn_credentials SET member = tenant WHERE member IS NULL`. All idempotent-shaped (`IF NOT EXISTS`, `OR IGNORE`, NULL-guarded UPDATE) except the ALTER, which the migration runner applies exactly once. The seed reading `tenants` (not KV) is what D3's lazy guard backstops.

### D10. Production fixture capture is a gated pre-merge verification, not a planning blocker

CHANGES.md lists the spike "production D1 shapes — existing grants/sessions/credentials rows as the zero-re-keying acceptance fixture". Remote reads are permission-denied in the planning session, and grants/sessions live in KV (not D1) anyway. Resolution: shapes were derived from `migrations/d1/*` DDL and the live code paths, which reproduce D10's grill-verified claims exactly; the capture runs pre-merge under operator permission with the exact read-only commands recorded in tasks.md (task 8.1), and observed rows become the acceptance fixtures for the zero-re-keying tests if they diverge from the derived shapes.

## Risks / Trade-offs

- **[Grandfathered handles]** Founding handles = tenant ids, and the shipped `USERNAME_RE` (`/^[a-z0-9][a-z0-9_-]{1,30}$/`) admits values outside the product handle grammar `[a-z0-9_]{3,20}` (hyphens, 2 chars, up to 31). → Deliberate: the unique index doesn't care, no rename surface exists yet, and the People/7b changes own grammar enforcement for new mints and renames. Flagged to the orchestrator as a product-spec/code divergence to arbitrate there.
- **[Immutable pre-split grant props]** Grants minted before the split carry `{ tenantId }` forever, so their member attribution is permanently "founding member". → Correct by construction (only founding members existed when they were minted); documented in SCHEMAS.md; a member who wants a member-bound grant re-connects (band 7a's Disconnect-all makes that easy later).
- **[Lazy-mint resurrection hazard]** A convergence guard that upserts identity rows on the hot path could resurrect revoked identities. → The two-condition guard (memberId equals tenantId AND zero member rows for the tenant) makes resurrection impossible after any member row exists; household-purge deletes the allowlist entry first, so a purged tenant never reaches the guard. Covered by explicit tests.
- **[Session-scan revoke matching]** `deleteSessionsFor` matches session records by stored tenant; member-revoke needs member-aware matching including D2 defaulting (a legacy record with no `member` belongs to the founding member). → One shared predicate used by both revoke paths, unit-tested against legacy and new record shapes.
- **[Roster status regression]** The roster derives active/pending from `grant:<userId>:*` scans. → D5 pins `userId = tenantId`; an assertion-level test guards the scan contract.
- **[KV/registry drift]** The migration seed reads the `tenants` registry; a KV-allowlisted tenant missing from the registry would get no seeded member. → D3's lazy guard converges them on first request; the pre-merge capture (task 8.1) counts allowlist vs registry vs members to observe whether the case even exists.
- **[Serial-surface collisions]** Every band-5 sibling deltas overlapping specs; member-session-auth/passkey-auth are shared with band 7a. → Planning may parallelize; implementation of this change must complete (through merge) before any sibling's implementation starts, per CHANGES.md.

## Migration Plan

1. Land `0058_member_identity.sql` with the code that writes/reads the member dimension in the same deploy (the Worker deploys atomically; migrations apply before traffic).
2. From the first post-deploy request: resolution applies D2 defaulting + D3 liveness/guard; new sessions/invites/approvals/grants carry the member; rolling refresh converges live sessions; `webauthn_credentials` is already backfilled.
3. Pre-merge (operator-gated) fixture capture, task 8.1: read-only production checks — allowlist/registry/member counts, credential member backfill shape, a sample session/grant record shape — recorded as acceptance evidence.
4. Rollback: revert the Worker deploy. The migration is additive (a new table and a nullable column no old code reads), so the previous Worker version runs unchanged against the migrated schema.

## Open Questions

None left open for the implementer. Two divergences are flagged for the orchestrator to arbitrate outside this change: (a) the `claude-ai-connector` living spec still describes Cloudflare Access Managed OAuth as the primary path while the shipped system is the Worker-served provider with cross-device approval — this change only adds its member-binding requirement; (b) the tenant-username grammar vs product handle grammar mismatch (see Risks).
