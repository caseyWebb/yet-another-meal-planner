## Why

Band 5's first two changes shipped the substrate — member identity on every credential path (`member-identity-split`) and the visibility lens with a deliberately empty friend seam (`deployment-profiles-and-visibility-lens`) — but every household still has exactly one member and the friend relation is the empty set. This change delivers the social layer those changes exist for: multi-member households, tenant↔tenant friendships that fill the lens seam, and the People page that manages both (stories/01 §2–3, pages/08, D1, D23, D24).

## What Changes

- **Multi-member households**: second-and-later members are minted with ULID member ids and product-grammar handles (`^[a-z0-9_]{3,20}$`; founding handles and existing usernames grandfathered — the recorded arbitration of the identity-split's flagged `USERNAME_RE` divergence). A household holds at most 8 members (placeholder bound, tunable at implementation).
- **Friendships**: symmetric, accepted-only tenant↔tenant edges in a new `friendships` table. The lens seam provider in `src/visibility.ts` gets its real body — the contract stated by the lens change (symmetric, accepted-only, keyed by tenant) is honored so **zero lens consumers change and no `shared-corpus` delta is needed**. "N shared" = the friend household's cookbook size (D27).
- **Requests** (household | friend tier) with D24 in full: exact-handle lookup only, enumeration bounded by the shared fixed-window limiter (per-member AND per-IP; placeholder budgets 30 lookups/hr, 10 sends/day), invisible declines with a ~30-day cooldown during which re-sends appear to succeed but deliver nothing, an outgoing cap counting every requester-visible row, and directional tier-scoped **blocks** that silently swallow (subsuming mute). Request notes are inert length-capped plain text, never delivered on swallowed requests.
- **Household governance resolved** (story 01 §5 q3, pages/08 q1): any member holds full household authority (remove members, accept/decline/cancel/block for the household, sever friendships) behind explicit confirm dialogs; the mock's unused "Household owner" label stays unused. One member's block binds the household. Leave-household and member-remove are the same D23 member-move primitive targeting a freshly spawned single-member household; the last member can neither leave nor be removed (single-member floor — the alternatives are household-accept-with-dissolution or operator household-purge; the operator last-member-revoke refusal stands unrelaxed).
- **Member-move (D23)**: one atomic primitive relocating member-scoped state between tenants — also implementing leave-household, eviction, and household-accept. Household-accept by a sole-member mover = member-move + tenant dissolution after an explicit in-flow confirmation enumerating what does NOT carry over; visibility grants re-key to the absorbing household; the old tenant id retires. Members of multi-member tenants must leave-household first (v1). MCP grants do not survive a move (immutable props); the member re-connects Claude.ai.
- **Nicknames**: per-viewer, others-only aliases, seeded from a newcomer's self-supplied display name, exported agent-facing through `read_user_profile` (the household members + nicknames export the identity split explicitly deferred here), never shown to the named person. Nickname upsert/clear is a registered class (b) offline write (D15, deliberate classification); avatar colors stay client-local.
- **Per-invite minted links**: member-minted `{inviter_member, tier, single-use, expiry}` tokens in D1 — a third invite kind, reconciled with (not merged into) KV bootstrap invites and D1 group signup codes. `/join/:token` is an SPA route with its POST under `/api/*` — **no `run_worker_first` entry, no `wrangler.jsonc` change**. Cancel = token revocation, oracle-free (pages/08 q3 resolved).
- **Self-service-signup fork**: redemption of a household-tier link joins the inviter's existing tenant (minting a member, not a tenant); a friend-tier link creates a new tenant plus the friendship edge; group codes keep creating standalone tenants with no edge (resolved interpretation of story 01 §4).
- **People page**: the SaaS full variant per pages/08 §2 (requests inbox with @handle ALWAYS, nickname hint with live example, HOUSEHOLD, FRIENDS with "N shared", find-by-handle, invite links, awaiting-response with cancel and block) and the self-hosted household-only variant (design request #12 — locally designed under recorded operator authorization). The sidebar People badge activates: pending inbound requests (deferred here by `sidebar-live-counts`).
- **Operator admin**: roster regroups members by household; the member-revoke UI ships (API landed with the identity split); household-purge and member-revoke extend to the new social tables.
- **Docs/persona lockstep**: `read_user_profile` + TOOLS.md (members + nicknames export); SCHEMAS.md (members/friendships/requests/invites/nicknames/blocks/handles); ARCHITECTURE.md identity notes; AGENT_INSTRUCTIONS.md session-start persona edit (Appendix C band 5) + `aubr build:plugin --check`.
- Requests are on-page only this band (no email sender exists until 7c); no new MCP tools — the agent surface is the profile export.

## Capabilities

### New Capabilities

- `social-graph`: the backend contract for household/friend requests (lifecycle, invisible declines, cooldown, caps, rate bounds), friendship edges (the lens seam's data source), blocks, nicknames, and member-minted invite links.

### Modified Capabilities

- `multi-tenancy`: the members-table requirement generalizes past founding members (ULID ids, handle grammar for new mints, household size bound, member-move-spawned tenants whose founder keeps their id); ADDS the member-move primitive and household-membership governance requirements.
- `member-session-auth`: member-move re-keys live session records atomically (a session whose stored tenant disagrees with the member's current household never resolves); join-link redemption mints the standard member-bound session.
- `self-service-signup`: the fork — redemption dispatches on token kind (group code | household link | friend link); new-mint username grammar tightens to the product handle grammar; the no-shared-namespace rule extends to the invite-kind trio.
- `operator-admin`: roster-by-household regrouping + member-revoke UI; both revoke scopes purge the social tables; onboarding usernames tighten to the product grammar (existing tenants grandfathered).
- `member-app-core`: the People page contract (both profile variants), the `/join/:token` route, and sidebar People badge activation.
- `member-app-offline`: registers the nickname upsert/clear as class (b); the social request/accept/invite/block/move surfaces are recorded online-only-with-hint.

## Impact

- **D1**: one migration `0060_households_social.sql` (0058/0059 are taken by the sibling changes): `friendships`, `social_requests`, `member_invites`, `nicknames`, `blocks`. No ALTER of existing tables.
- **Worker**: `src/visibility.ts` (seam body only), new `src/social-db.ts` + `src/social.ts` (or equivalent split), `src/member-move.ts`, `src/signup.ts`/`signup-db.ts` (fork + grammar), `src/api/` people + join routes, `src/tenant.ts`/`src/members-db.ts` (member mint, size bound), `src/admin.ts`/`src/admin/api.ts` + admin app (roster regroup, member-revoke UI, purge extensions), profile read + TOOLS.md, persona.
- **Member app**: People page (both variants), `/join/:token` route, sidebar badge wiring, nickname editing; Playwright coverage via `aubr test:app`; admin Playwright via `aubr test:admin`.
- **No** new HTTP route outside `/api/*` + SPA, no `wrangler.jsonc` change, no new binding/cron/dependency, no lens-consumer edits, no new MCP tools.
- **Serial-surface collisions**: after `member-identity-split` and `deployment-profiles-and-visibility-lens` (multi-tenancy/operator-admin shared with both); `note-visibility-tiers` is a planning-parallel sibling with no shared spec files (recipe-notes untouched here).
- Production reads are permission-denied in planning; shapes derive from migrations + the sibling designs, with an operator-gated pre-merge capture task (the identity-split task-8.1 precedent).
