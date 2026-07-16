## Why

Band 5's social layer (multi-member households, friends, member-attributed notes and activity) needs a member identity, and today no credential layer knows one: the OAuth grant carries props `{ tenantId }` only, web sessions store `{ tenant, created_at, refreshed_at }`, WebAuthn credentials are tenant-keyed with the user handle equal to the tenant id, and `recipe_notes.author` is tenant-valued (all verified in `packages/worker/src/authorize.ts`, `src/session.ts`, `src/webauthn.ts`, `src/corpus-db.ts` — D10's ground truth holds in code). D10 makes this split band 5's opening change: every member-scoped feature in the band depends on it, and it must land with zero re-keying because WebAuthn user handles are burned into authenticators and D9 forbids data surgery.

## What Changes

- **A `members` D1 table** becomes the member-identity substrate: `members(id, tenant, handle, created_at)` with deployment-wide handle uniqueness. Every existing tenant declares a **founding member whose member id EQUALS the tenant id** — so every credential value already in the wild (grant props, session records, WebAuthn user handles, invite mappings, note-author values) is already a valid member id. Zero re-keying, by construction.
- **Every tenant-creation path mints the founding member atomically**: operator onboarding, group-code self-service signup, and an idempotent seed of all existing tenants (migration seed from the `tenants` registry plus a lazy convergence guard at identity resolution for any tenant the registry missed).
- **Credential records gain the member dimension**: OAuth grant props become `{ tenantId, memberId }` (approval binds the approving member); session records gain `member`; `webauthn_credentials` gains a `member` column (backfilled to `tenant` — exactly what the burned-in user handles already assert); bootstrap invite records gain `member`; the cross-device approval reference (`authz:<ref>`) records the approving member. One shared legacy-defaulting rule covers every record minted before the split: **an absent member dimension resolves to the founding member (`memberId = tenantId`)**.
- **Both identity paths resolve `(tenantId, memberId)` before anything runs**: the MCP handler and the `/api` session middleware resolve the pair through one shared resolver — tenant allowlist re-check as today, plus a member-liveness check so a revoked member's grants, sessions, and passkeys stop resolving. Tenant stays the isolation boundary; member is attribution within it. Tools receive the member on the resolved context; no tool param, return shape, or D1 domain-table schema changes.
- **Invite codes mint/resolve `(tenant, member)` pairs**: onboarding and rotation address a member (defaulting to the founding member), `resolveInvite` returns the pair, login binds the session to it, and first passkey enrollment consumes the invites resolving to that member.
- **Operator lifecycle splits into member-revoke vs household-purge**: household-purge is today's full revocation (allowlist, invites, sessions, Kroger token, all per-tenant D1 rows — now including `members`); member-revoke removes one member (member row, their passkeys, their sessions, their invites, their authored notes) without disturbing the household, and is refused for a tenant's last member (the operator must explicitly choose household-purge; member-initiated governance is deferred to the People change per story 01 §5 q3). The existing admin revoke endpoint keeps its route and observable behavior as household-purge; member-revoke is a new Access-gated admin operation. No admin UI change (every household has exactly one member until the People change; the roster-by-household regrouping lands there).
- **Attribution writers stamp the resolved member id**: `recipe_notes.author` / `store_notes.author` writes take the context's member id instead of the tenant id — byte-identical values today (founding member id = tenant id), correct forever after.
- **Docs lockstep**: SCHEMAS.md (members table, `webauthn_credentials.member`, session/invite/grant/approval record shapes), ARCHITECTURE.md (the "Multi-tenant identity" resolution paragraphs only — the full identity rewrite belongs to the lens change).

### Explicit non-goals

- No `member` column on any domain table (`cooking_log`, `overlay`, `discovery_matches`, `taste_derived`, vibes, profile, ...). Member-scoped re-keying of domain data lands with the change that ships each member-scoped feature (People page, note tiers, discovery follows), per the band plan.
- No `read_user_profile` change and no TOOLS.md edit: no tool param, return, or guarantee changes. The household-members + nicknames profile export (Appendix A/C band 5) is deferred to `households-friends-and-people-page` with rationale: nickname storage does not exist yet and every household has exactly one member after this change, so exporting a members list now would churn the tool contract twice for a vacuous payload. The AGENT_INSTRUCTIONS.md persona edit and plugin check ride that same change.
- No member-facing UI, no People page, no handle lookup/rename surface, no friend or request machinery, no member-move (D23), no block (D24), no self-service-signup fork (`/join/:token`), no session/grant metadata tables (band 7a), no new member `/api` endpoints.
- No new handle grammar enforcement: founding handles equal tenant ids verbatim (grandfathered even where they fall outside the product handle grammar `[a-z0-9_]{3,20}`); handle minting/validation/rename rules land with the People change and 7b.
- No OAuth grant-store surgery: pre-split grants keep props `{ tenantId }` forever and resolve through the legacy-defaulting rule; revocation continues to work by resolution re-check, not by deleting library-managed grant records.
- No new Worker-owned HTTP route outside the existing `/admin*` and `/api/*` dispatch — no `wrangler.jsonc` change.

## Capabilities

### New Capabilities

None. Member identity is the substrate of the existing multi-tenancy capability, not a parallel contract.

### Modified Capabilities

- `multi-tenancy`: adds the members-table requirement (founding-member invariant, minting at every tenant-creation path, idempotent seeding + lazy convergence, handle uniqueness); per-request resolution becomes `(tenantId, memberId)` with the legacy-defaulting rule and member-liveness check; the OAuth approval sentence binds `(tenant, member)` into grant props.
- `member-session-auth`: session records gain `member`; invite-code login binds the session to the resolved `(tenant, member)` pair; the session middleware resolves the same `(tenant, member)` identity as the MCP path, including member liveness and legacy-record defaulting.
- `passkey-auth`: enrollment binds a credential to `(tenant, member)` with the user handle equal to the member id; authentication resolves the credential's pair and mints a member-bound session; the cross-device approval binds the approving member into the grant; the D1 credential table gains the member column and both purge scopes.
- `operator-admin`: onboarding mints the founding member and a member-addressed invite; rotation is member-addressed; revocation splits into member-revoke vs household-purge with the last-member refusal rule.
- `claude-ai-connector`: adds the member-bound grant requirement — authorization records the approving member, MCP requests resolve the pair before tools, pre-split grants resolve to the founding member.

## Impact

### Dependency map

```text
   operator onboard        group-code signup        existing tenants
        |                        |                  (migration seed +
        +------------+-----------+                   lazy convergence)
                     v                                     |
             members(id, tenant, handle, created_at) <-----+
                     |            founding member: id = tenant id
                     v
     one shared (tenantId, memberId) resolver
       tenant allowlist re-check + member liveness
        |                                  |
        v                                  v
  MCP handler (grant props            /api session middleware
  { tenantId, memberId? })            (session record + member)
        |                                  |
        v                                  v
  tools get ctx member  <----- attribution stamp -----> notes author writes
                                           |
                              passkey ceremonies (user handle =
                              member id; member column) and the
                              cross-device approval (member-bound
                              grant props)
                                           |
                              operator lifecycle: member-revoke
                              (one member) vs household-purge
                              (whole tenant, incl. members rows)
```

### Anticipated files (forecast)

Roughly 24-30 changed files, dominated by the auth/identity modules and their tests:

- 1 migration: `packages/worker/migrations/d1/0058_member_identity.sql` (members table + seed from `tenants` + `webauthn_credentials.member` + backfill). The `d1` number space has known duplicates (0018/0045/0047); 0058 is free.
- Worker identity/auth: `src/tenant.ts` (Tenant context + resolver + invite records), `src/index.ts` (MCP handler), `src/session.ts` + `src/api/session.ts` (session record/middleware/login), `src/webauthn.ts` + `src/webauthn-db.ts` + `src/api/passkey.ts` (ceremonies + member column), `src/authorize.ts` + `src/connect-approval.ts` (grant props + approval record), `src/signup.ts`/`src/signup-db.ts` (founding member at signup), a new `src/members-db.ts` (members queries via `db(env)`).
- Operator lifecycle: `src/admin.ts` (onboard/rotate/revoke split, `TENANT_TABLES` gains `members`), `src/admin/api.ts` (member-revoke route).
- Attribution: `src/notes-tools.ts` / `src/tools.ts` wiring (author = ctx member).
- Tests: worker test files covering migration chain, resolver, session, passkey, authorize/approval, signup, admin lifecycle.
- Docs/specs: `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, the five living specs synced at archive.

### Schema and scheduling impact

One migration, no new cron, no `scheduled()` wiring, no new binding, no dependency change, no `wrangler.jsonc` change. KV record shapes evolve additively (session, bootstrap invite, `authz:<ref>`, grant props) under the legacy-defaulting rule — no KV rewrite pass; rolling session refresh re-puts naturally converge live sessions.

### Compatibility

- Every pre-split credential keeps working unmodified: the founding-member invariant makes existing stored values valid member ids, and the legacy-defaulting rule covers records that predate the member field. This is the D10 acceptance bar: zero re-keying of grants, sessions, passkeys, and note-author values.
- The production-fixture spike (existing grants/sessions/credentials rows as the zero-re-keying acceptance fixture) could not be captured during planning: remote D1/KV reads are permission-denied in this session. Shapes were derived from `migrations/d1/*` and the live code paths instead, and D10's grill-verified claims match code exactly. The capture is recorded as a pre-merge verification task gated on operator permission, with the exact read-only queries spelled out in tasks.md.
- Serial-surface collisions: every band-5 sibling (all touch multi-tenancy/operator-admin or member-scoped surfaces), and member-session-auth/passkey-auth are shared with band 7a — implementation stays serial with those; nothing else is in flight.
