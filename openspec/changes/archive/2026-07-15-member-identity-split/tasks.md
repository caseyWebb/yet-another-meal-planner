## Scope guard

The frozen surface is the identity/auth layer only: `packages/worker/migrations/d1/0058_member_identity.sql`; `src/tenant.ts`, `src/index.ts`, `src/session.ts`, `src/api/session.ts`, `src/webauthn.ts`, `src/webauthn-db.ts`, `src/api/passkey.ts`, `src/authorize.ts`, `src/connect-approval.ts`, `src/signup.ts`, `src/signup-db.ts`, a new `src/members-db.ts`, `src/admin.ts`, `src/admin/api.ts`, `src/notes-tools.ts` (+ its `src/tools.ts` wiring); their worker tests; `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`; the five living specs at archive time. No domain-table member columns, no tool param/return change, no member-facing or admin UI change, no persona edit, no `wrangler.jsonc` change, no new dependency, no cron. If implementation appears to require any of those, stop and report to the main thread instead of widening the diff.

## 1. Migration and members store

- [x] 1.1 Add `packages/worker/migrations/d1/0058_member_identity.sql` per design D1/D9: `CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, handle TEXT NOT NULL, created_at INTEGER NOT NULL)` with the unique `handle` index and the `tenant` index; the idempotent founding-member seed `INSERT OR IGNORE ... SELECT id, id, id, created_at FROM tenants`; `ALTER TABLE webauthn_credentials ADD COLUMN member TEXT` and the NULL-guarded backfill `SET member = tenant`. Verify `0058` stays unique in the number space (0018/0045/0047 are historical duplicates — do not add another).
- [x] 1.2 Add `packages/worker/src/members-db.ts` over `db(env)` (never `env.DB`): get member by `(id, tenant)`, count members for tenant, insert founding member (idempotent `INSERT OR IGNORE`), delete member row. Follow the function-per-query idiom of `webauthn-db.ts`/`signup-db.ts`.
- [x] 1.3 Migration-chain tests (sqliteEnv over the full real migration chain): seed idempotency (run twice, one row per tenant, `id = tenant = handle`), webauthn backfill (`member = tenant` on pre-existing rows), unique-handle rejection, `members` purged with the tenant tables.

## 2. Shared identity resolution

- [x] 2.1 Extend `src/tenant.ts`: `Tenant` gains `member: string`; add the shared resolver step (design D3) — canonicalize + allowlist re-check unchanged, legacy defaulting (absent member ⇒ `memberId = tenantId`), member-liveness check against `members`, and the two-condition lazy founding-member convergence guard (mint only when `memberId === tenantId` AND the tenant has zero member rows). Missing member row otherwise ⇒ structured `unauthorized`.
- [x] 2.2 Wire the MCP handler (`src/index.ts`): read `props.memberId` beside `props.tenantId`, resolve the pair before `buildServer`, reject unresolvable pairs with the structured `unauthorized` and run no tool.
- [x] 2.3 Resolver tests: pre-split grant props `{ tenantId }` resolve to the founding member; `{ tenantId, memberId }` resolve exactly; revoked-member id with surviving tenant ⇒ `unauthorized` (no resurrection when other member rows exist); zero-member tenant converges via the lazy guard; purged tenant never reaches the guard (allowlist fails first); mixed-case tenant ids still canonicalize before every lookup.

## 3. Session path (`/api`)

- [x] 3.1 `src/session.ts`: `SessionRecord` gains `member`; `createSession(kv, tenant, member)`; `requireSession` resolves `(tenant, member)` through the shared resolver with legacy-record defaulting; the throttled rolling refresh re-writes the record carrying `member`.
- [x] 3.2 `src/api/session.ts` login: bind the minted session to the `(tenant, member)` pair returned by `resolveInvite`.
- [x] 3.3 Tests: legacy record (no `member`) resolves to founding member and converges on refresh; new records carry `member`; member-revoked session ⇒ 401 on next request; delisted tenant still ⇒ 401 before purge.

## 4. Passkeys and the connect approval

- [x] 4.1 `src/webauthn.ts` + `src/api/passkey.ts` registration: ceremony `userID` = the session's member id, `userName`/`userDisplayName` = the member's handle; `insertCredential` writes `member`; first-enrollment invite consumption becomes member-scoped (`deleteInvitesFor` matches invites resolving to that member, D2-aware).
- [x] 4.2 Passkey login: `getCredentialById` returns `(tenant, member)`; resolve through the shared resolver; mint the member-bound session. All failure modes (unverifiable assertion, unknown credential, delisted tenant, revoked member) return the same structured `unauthorized` 401.
- [x] 4.3 `src/connect-approval.ts` + `src/authorize.ts`: the `authz:<ref>` record gains `member` from the approving session; both `completeAuthorization` call sites pass props `{ tenantId, memberId }` with `userId` unchanged (= tenantId, roster-scan contract); the grace-path invite fallback binds the invite's resolved pair; pre-split `authz` records default to the founding member.
- [x] 4.4 Tests: enrollment row carries member and user handle = member id; backfilled credential still logs in (founding member) with zero authenticator interaction; approval flow issues `{ tenantId, memberId }` props and `userId = tenantId` (assert the roster grant-scan contract explicitly); member-revoked credential fails login indistinguishably.

## 5. Invites, signup, and operator lifecycle

- [x] 5.1 `src/tenant.ts` invite records: bootstrap JSON gains `member`; `resolveInvite` returns `{ tenant, member, kind }` with legacy/bare-string records defaulting to the founding member; allowlist re-check unchanged.
- [x] 5.2 `src/admin.ts` `onboard()`: insert the founding member row (via `members-db`) beside the existing `tenants` registry insert and allowlist write; mint the invite resolving to the pair. `rotate()`: member-addressed with founding default (existing endpoint contract unchanged).
- [x] 5.3 `src/signup.ts`/`src/signup-db.ts`: group-code redemption inserts the founding member row in the same flow that claims the username and writes the allowlist entry; the signup session is member-bound.
- [x] 5.4 `src/admin.ts`: add `members` to `TENANT_TABLES` (household-purge now clears it); implement `revokeMember(deps, tenant, member)` per operator-admin's added requirement — member row, member's credentials, member's sessions (shared D2-aware matching predicate with the purge path), member's invites, `AUTHOR_TABLES` by `author = member` — refusing the last member with a structured error naming household purge. No allowlist/registry/Kroger/household-table touch.
- [x] 5.5 `src/admin/api.ts`: expose member-revoke as an Access-gated admin route beside the existing tenant routes; the existing revoke route keeps its path and household-purge behavior. No admin UI change.
- [x] 5.6 Tests: onboard/signup mint founding members; rotate re-mints the member-addressed invite; member-revoke deletes exactly the member-scoped set and leaves household state; last-member refusal; household-purge clears `members` and behaves byte-for-byte like today's revoke otherwise; first-enrollment consumption is member-scoped.

## 6. Attribution stamp

- [x] 6.1 `src/notes-tools.ts` (+ `src/tools.ts` wiring): note create/update/remove and note reads pass `tenant.member` as `author`/caller where `tenant.id` is passed today — recipe and store notes both. Assert byte-identical behavior for founding members (existing tests keep passing unmodified where they assert author values).

## 7. Docs lockstep (Appendix B band 5, this change's slice)

- [x] 7.1 `docs/SCHEMAS.md`: add the `members` table section; add `member` to the `webauthn_credentials` section; update the web-session and invite-record KV shapes (member field + legacy defaulting rule); document grant props `{ tenantId, memberId }` and the `authz:<ref>` member field where those shapes are described. Current-state language only — no "used to"/"now" narration.
- [x] 7.2 `docs/ARCHITECTURE.md` "Multi-tenant identity": update the identity-resolution paragraphs — both MCP and `/api` resolve `(tenantId, memberId)` before anything runs; tenant = isolation boundary, member = attribution; founding-member invariant and legacy defaulting. Do NOT rewrite the section wholesale — the full multi-tenant identity rewrite belongs to `deployment-profiles-and-visibility-lens`.
- [x] 7.3 `docs/TOOLS.md`: explicitly no edit — no tool param, return, or guarantee changes in this change; the `read_user_profile` household-members + nicknames export (Appendix A/C band 5) is deferred to `households-friends-and-people-page` per the proposal. Re-verify at implementation time that no tool description mentions tenant-as-identity in a way the split falsifies; if one does, that sentence is in scope.
- [x] 7.4 `AGENT_INSTRUCTIONS.md` + `aubr build:plugin --check`: explicitly no persona edit — Appendix C band 5's "session-start profile read carries household members + nicknames" binds to the People change that delivers multi-member data. Run the parse-only plugin check anyway to confirm no generated-artifact drift.

## 8. Verification and handoff

- [ ] 8.1 Production fixture capture (GATED on operator permission for remote reads; run pre-merge, read-only): D1 — `SELECT COUNT(*) FROM tenants;`, `SELECT COUNT(*) FROM webauthn_credentials WHERE member IS NULL OR member != tenant;` (post-migration expect 0), `SELECT COUNT(*) FROM members WHERE id != tenant OR handle != tenant;` (expect 0), `SELECT COUNT(*) FROM tenants t LEFT JOIN members m ON m.tenant = t.id WHERE m.id IS NULL;` (expect 0), `SELECT DISTINCT author FROM recipe_notes WHERE author NOT IN (SELECT id FROM members);` (expect empty). KV — list a sample of `session:*` values in `TENANT_KV` and `grant:*` keys in `OAUTH_KV` to confirm the pre-split shapes (`{tenant, created_at, refreshed_at}`; props `{tenantId}`, key `grant:<tenantId>:<grantId>`). If any observed shape diverges from the derived fixtures, encode the observed rows as test fixtures before merging.
- [x] 8.2 Run `aubr typecheck` and `aubr test` (worker suite; the identity tests of sections 1-6 plus the untouched suites — existing auth tests must pass with only deliberate assertion updates). Run `aubr test:admin` to confirm the admin panel is behaviorally unchanged.
- [x] 8.3 Run `openspec validate member-identity-split --strict`, the plugin `--check` from 7.4, and `git diff --check`; sync the approved deltas into the five living specs at archive time.
- [x] 8.4 Recount the merge-base diff against the proposal's ~24-30 file forecast and report the exact footprint plus any unresolved findings (including the two flagged divergences: the stale Access-era `claude-ai-connector` text and the username-vs-handle grammar mismatch) to the main thread.
