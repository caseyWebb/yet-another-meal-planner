## Context

Band 5's third change. The two ratified predecessors are treated as landed contracts:

- `member-identity-split`: a `members` table (founding member id = handle = tenant id); one shared `(tenantId, memberId)` resolver on MCP and `/api`; member-bound grants/sessions/passkeys/invites; operator member-revoke (API only, last-member refusal) vs household-purge; migration `0058`. Its design notes non-founding member ids are expected to be ULIDs and defers handle grammar, the members+nicknames profile export, and the persona edit to THIS change.
- `deployment-profiles-and-visibility-lens`: `loadDeploymentProfile(env)` over `operator_config.deployment_profile`; `recipe_imports` + one lens enforcement point in `src/visibility.ts`; and the named friend-relation seam provider whose contract is pinned in its spec delta — symmetric, accepted-only edges, keyed by tenant, empty until this change — so filling it requires zero consumer edits and no `shared-corpus` delta. Migration `0059`.

Current code reality (verified during planning):

- Self-service signup: `redeemGroupCode` in `src/signup.ts` (username validated by `USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/`, `signup.ts:22`), atomic D1 claim in `signup-db.ts` (`signup_invites`/`signup_redemptions`/`tenants`), founding member inserted before the KV allowlist write, session minted member-bound in `src/api/signup.ts`. Group codes (D1) and operator bootstrap invites (KV `invite:<code>`) are deliberately separate systems.
- Shared limiter: `underRateLimit(kv, key, max, windowS, now)` in `src/rate-limit.ts` — fixed-window, fail-open, caller-owned key prefix; already used per-IP at signup and login.
- Member app: TanStack file routes under `packages/app/src/routes/`; the sidebar `NAV` in `_app.tsx` has NO People entry; `useSidebarCounts()` (`lib/data.ts`) derives plan + grocery counts from the area reads; `member-app-core` holds the reserved people-badge wording ("pending inbound requests … not rendered until it ships"). `/api` sub-apps are one file per area in `src/api/*` composed in `src/api/app.ts`; the SPA fallback absorbs new client routes — `/join/:token` needs NO `run_worker_first` entry.
- Admin: roster endpoints in `src/admin/api.ts` (`listTenants`, `revoke`, `revokeMember`), UI in `packages/admin-app/src/screens/members*.tsx`.
- Migrations: `0058`/`0059` are claimed by the siblings; `0060` is free (0018/0045/0047 are historical duplicate numbers — do not add another).
- Remote production reads are permission-denied in this session; shapes derive from migrations + sibling designs, with an operator-gated pre-merge capture task (the identity-split task-8.1 precedent).

**Design authorization**: no Claude Design export exists for design request #12 (the self-hosted People page variant). The operator has authorized a local design for #12 in this session (the `deployment-profiles-and-visibility-lens` / `offline-stores-and-store-walk` precedent), under the same constraint: stay as close to the current design export as possible, mimic existing styles, use existing shared UI primitives. The `design-requests.md` #12 prompt is the brief; Decision 11 encodes it. The SaaS People page itself is mock-covered (`screens/nav-people.png`, `tall-people.png`) — no new design needed there.

**Ratification order**: DECISIONS.md's ratifications block wins. D23/D24 are decided text; pages/08 q4 is ratified (one household per member); q5 is ratified (avatar colors client-local).

## Goals / Non-Goals

**Goals:**

- Households gain second-and-later members; friendships fill the lens seam with zero consumer edits; the People page manages both, in both deployment profiles.
- D24 in full: enumeration-bounded lookup, invisible declines, silent-swallow blocks — no response, count, or cap that works as a decline/block oracle.
- D23's member-move specced once and reused for leave-household, member-remove (eviction), and household-accept-with-dissolution.
- One handle grammar for every NEW identity mint; everything already issued grandfathered — the recorded arbitration of the identity-split's flagged grammar divergence.
- The deferred identity-split obligations delivered: `read_user_profile` members+nicknames export, TOOLS.md, the Appendix C band-5 persona edit, the member-revoke admin UI, the roster-by-household regrouping.

**Non-Goals:**

- Member-keying of `overlay`, `taste`, `diet_principles`, or `cooking_log` (see Decision 8 — a deliberate v1 reduction of D23's enumeration, flagged to the orchestrator), and no D29 union/blend engine work.
- Note visibility tiers (`note-visibility-tiers`), feed follows (band 6), handle rename + old-handle reservation (band 7b), session/grant metadata (band 7a).
- No new MCP tools; requests/accepts/blocks are web-only surfaces. The agent's window is the profile export.
- No email or push notification path — requests are on-page only this band (no outbound sender exists until 7c; resolved for pages/08 q2's open half).
- No cross-deployment federation; no operator bulk-friendship tooling (the lens change's flip-guard copy mentions it as a possibility — not built here).
- No new HTTP route outside `/api/*` + SPA fallback, no `wrangler.jsonc` change, no new binding, cron, or dependency.

## Decisions

### 1. Migration `0060_households_social.sql` — five new tables, no ALTERs

```sql
CREATE TABLE IF NOT EXISTS friendships (
  tenant_a   TEXT NOT NULL,      -- lexicographically LOWER tenant id
  tenant_b   TEXT NOT NULL,      -- lexicographically HIGHER tenant id
  requested_by TEXT NOT NULL,    -- member id that sent the originating request
  created_at INTEGER NOT NULL,   -- epoch ms
  PRIMARY KEY (tenant_a, tenant_b),
  CHECK (tenant_a < tenant_b)
);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(tenant_b);

CREATE TABLE IF NOT EXISTS social_requests (
  id          TEXT PRIMARY KEY,  -- ULID
  tier        TEXT NOT NULL,     -- 'household' | 'friend'
  from_tenant TEXT NOT NULL,
  from_member TEXT NOT NULL,
  to_tenant   TEXT NOT NULL,     -- friend tier: the target household
  to_member   TEXT NOT NULL,     -- the looked-up member; household tier: the invitee
  note        TEXT,              -- inert plain text, <= 200 chars
  display_name TEXT,             -- sender-supplied self-introduction (nickname seed)
  state       TEXT NOT NULL,     -- 'pending' | 'accepted' | 'declined' | 'cancelled' | 'swallowed'
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_social_requests_to ON social_requests(to_tenant, state);
CREATE INDEX IF NOT EXISTS idx_social_requests_from ON social_requests(from_tenant, state);

CREATE TABLE IF NOT EXISTS member_invites (
  token          TEXT PRIMARY KEY,  -- >= 128-bit random, URL-safe
  tenant         TEXT NOT NULL,     -- inviter household
  inviter_member TEXT NOT NULL,
  tier           TEXT NOT NULL,     -- 'household' | 'friend'
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,  -- default mint: created_at + 14 days
  revoked_at     INTEGER,
  redeemed_at    INTEGER,
  redeemed_by    TEXT               -- resulting member id (household) or tenant id (friend)
);
CREATE INDEX IF NOT EXISTS idx_member_invites_tenant ON member_invites(tenant);

CREATE TABLE IF NOT EXISTS nicknames (
  tenant        TEXT NOT NULL,      -- viewer's household (isolation/purge column)
  viewer_member TEXT NOT NULL,
  target_member TEXT NOT NULL,
  nickname      TEXT NOT NULL,      -- <= 40 chars plain text
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (viewer_member, target_member)
);
CREATE INDEX IF NOT EXISTS idx_nicknames_tenant ON nicknames(tenant);

CREATE TABLE IF NOT EXISTS blocks (
  tenant          TEXT NOT NULL,    -- blocking household
  blocking_member TEXT NOT NULL,
  tier            TEXT NOT NULL,    -- the tier this record suppresses
  blocked_tenant  TEXT NOT NULL,    -- counterparty household at mint time
  blocked_member  TEXT,             -- set for household-tier blocks (follows the person)
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (tenant, tier, blocked_tenant)
);
```

- `friendships` stores the symmetric edge once as a canonically ordered pair (the `CHECK` makes duplicates and self-edges unrepresentable). Accepted-only by construction: pending state lives in `social_requests`; a row here IS an accepted friendship — exactly the seam provider's contract.
- `social_requests` rows are append-then-resolve; the requester's view derives from state (`pending`, `declined`, and `swallowed` all render "Request sent" — D24's invisible decline). `swallowed` rows exist so the outgoing cap counts them and the requester's view stays plausible; they are never materialized in any inbox and their `note`/`display_name` are never delivered.
- No existing table is altered; `members` (0058) already carries everything a member row needs. Purge/revoke semantics for the new tables are Decision 12.

### 2. Handle grammar: one rule for every new mint; everything existing grandfathered

The recorded arbitration of the flagged divergence (product grammar `[a-z0-9_]{3,20}` vs shipped `USERNAME_RE` `/^[a-z0-9][a-z0-9_-]{1,30}$/`): **every NEW identity mint validates `^[a-z0-9_]{3,20}$`** — new member handles (join links, household-invitation accepts), self-service usernames (which become tenant ids and founding handles), and operator-onboarded usernames. Existing tenant ids, founding handles, and allowlist entries are grandfathered verbatim (the unique index never cared). Tightening signup and onboarding is what stops the grandfather class regrowing; the alternative (tighten member handles only) would mint grammar-violating founding handles forever. One shared `HANDLE_RE` constant replaces `USERNAME_RE` at both signup validation sites; the admin onboard path gains the same validation with a structured error. Hyphens are deliberately excluded from the grammar and deliberately used by the spawn-suffix rule (Decision 7), so machine-suffixed tenant ids can never collide with a future handle.

Non-founding member ids are ULIDs (the identity-split design note), minted server-side at member creation; the WebAuthn 64-byte user-handle cap accommodates them; handles remain the only member-facing key (`@handle` ALWAYS on request rows, pages/08).

### 3. Household governance: any-member authority, single-member floor (resolves story 01 §5 q3 / pages/08 q1)

**Any member holds full household authority**: remove any other member, accept/decline household and friend requests, cancel outgoing requests and invite links, sever friendships, and block — each destructive action behind an explicit confirm dialog (the mock's instant remove is corrected; its unused "Household owner" label stays unused and is recorded as such). Rationale: a household is a high-trust unit already sharing a pantry, plan, and Kroger account; an owner role demands a role column, transfer ceremonies, and an orphaned-owner story — machinery misfit to v1 and reversible later by addition, whereas revoking authority later is a breaking subtraction. Consequences bound to this call, as D24/D10 require:

- **One member's block binds the household** (Decision 5) — congruent with every member wielding full membership authority.
- **Last-member rules**: the last member can neither leave nor be removed (a zero-member allowlisted household is forbidden by the identity split). The structured refusal names the alternatives: household-accept into another household (dissolution) or operator household-purge. The operator-surface last-member-revoke refusal stands unrelaxed.
- **Max household size: 8 members** (placeholder, tunable at implementation like the D24 budgets), enforced at household-accept and join-link redemption. Rationale: the household is a kitchen, not a group-share channel — an unbounded roster would make "join my household" a lens bypass (one giant pseudo-household sharing everything with no friend edges); 8 clears any realistic family-plus-grandparents case.

### 4. Requests: one shape, two tiers; household tier is an INVITATION into the sender's household

One request record serves both tiers. **Friend tier**: a member looks up an exact @handle and sends; the edge-to-be is `from_tenant ↔ to_tenant`; every member of the target household sees the inbox row and any of them may accept (household authority), which mints the `friendships` row and resolves the request. **Household tier**: the request is an invitation FROM a member of a household TO a prospective member — "join my household". This direction is forced by the page itself: the "Find household members" adder and the household invite link both recruit INTO the inviter's household, and D23's not-carried-over confirmation must be shown to the party whose old household state is purged — the MOVER — which only works if the mover is the one accepting. The mock inbox string "wants to join your household" is recorded as a mock-copy artifact of the reverse direction (D5 painted door); the shipped inbox copy for household-tier rows is "invites you to join their household". pages/08's accept-flow mechanics all hold with the roles fixed: the accept flow shows the not-carried-over enumeration to the mover, and nickname seeding follows Decision 6.

Lifecycle and D24 mechanics:

- **Lookup** is exact-handle only (`idx_members_handle`), no browse/search. Existence disclosure is accepted (the signup "username taken" precedent); enumeration is bounded: lookup rides `underRateLimit` with keys `people:lookup:m:<member>` AND `people:lookup:ip:<ip>` (30/hour each); request-send with `people:send:m:<member>` AND `people:send:ip:<ip>` (10/day each). Budgets are placeholders, tuned at implementation. Fail-open on KV errors, per the limiter's contract.
- **Standing outgoing cap**: at most 25 requester-visible outgoing rows per member (pending + declined + swallowed all count — the cap can never become a decline oracle). Cancel frees a slot, unnotified.
- **Decline is invisible**: the row flips to `declined`, the requester's view stays "Request sent" forever. The declined pair — keyed `(tier, from_tenant, to_tenant)` for friend, `(tier, from_tenant, to_member)` for household — enters a 30-day cooldown from `resolved_at`; a re-send inside the window writes a `swallowed` row that appears to succeed and delivers nothing.
- **Swallow conditions** (identical surface behavior): active cooldown, or a block matching the request's tier and parties. Swallowed rows never reach an inbox; their notes are never delivered.
- **Notes** are optional inert plain text, server-capped at 200 chars, rendered as quoted text only (no links/markdown). **Duplicate pending** requests to the same party are answered idempotently ("already sent" — the requester's own state, no oracle). Requests to your own household, to an existing friend household, or to a full household fail with honest structured errors (all facts the requester can already see or will see on accept).
- Under **self-hosted**, friend-tier lookup/send/accept endpoints refuse with a structured `profile_disabled` error; household-tier flows are unaffected (pages/08 profile gating).

### 5. Blocks: directional, tier-scoped, minted by a member, evaluated household-wide (D24 + the governance call)

A block is minted from an inbox row, an awaiting-response row, or a friend row, and suppresses the tier it was minted against. Storage is per-minting-member (auditability) but evaluation is household-wide — one member's block binds the household, congruent with Decision 3 (a per-member-only block on a tenant-level edge would be bypassable by re-addressing another member). Semantics:

- A blocked party's future requests of that tier silently swallow (their view: still "Request sent"); their existing pending inbox rows are swallowed at block time (removed from the inbox, requester view unchanged).
- Blocking from a friend row severs the friendship in the same operation, without notification — the live lens hides their recipes immediately (D30's principle, already enforced by the seam read).
- Block on an awaiting-response row also cancels the household's own outgoing request (silently, like any cancel).
- Household-tier blocks record `blocked_member` and match by member id (the protection follows the person across member-moves); friend-tier blocks match by tenant. Block records stay with the household that minted them when the minter later moves (they protect the household edge, not the person who clicked); a mover starts clean in their new household.
- Silent-swallow block subsumes mute: no separate mute exists. Unblocking is a plain delete from the same rows' management affordance; nothing is retroactively delivered.

### 6. Nicknames: per-viewer aliases; seeded from a self-supplied display name; agent-facing via the profile export

`nicknames` rows are (viewer member → target member) with the viewer's tenant for isolation. Others-only (a viewer cannot nickname themselves — refused), never shown to the named person, inline-edited on the People page, empty-save clears (row delete). Seeding: a request or an accept MAY carry a self-supplied `display_name` (the sender introducing themselves; the mover introducing themselves in the household-accept flow); when a relationship forms, each counterparty viewer without an existing nickname for the newcomer gets one seeded from it — shown in the flow as `will be saved as "{name}" (@handle) — edit` per pages/08. Seeds are ordinary rows (editable, clearable). Under self-hosted, nickname targets may be any member of the deployment (D9: "nicknames still apply to everyone in the deployment") — the write path validates only that the target member exists and is not the viewer; the v1 page surfaces household members (plus friends under SaaS) as targets.

**Agent surface**: `read_user_profile` (assembled in `src/tools.ts` `assembleUserProfile`, also serving `GET /api/profile`) gains a `household` block: `{ members: [{ handle, nickname, you, joined_at }] }` where `nickname` is the CALLING member's alias for that member (null when unset, never someone else's alias, never a self-nickname) — the export the identity split explicitly deferred here. TOOLS.md documents the shape and the guarantee (nicknames are private to the viewer who set them; the tool never returns nicknames set by others or for the caller) in the same pass. AGENT_INSTRUCTIONS.md gains the Appendix C band-5 line: the session-start profile read carries household members + nicknames, so chat can resolve "Mom and Grandma are coming to town"; `aubr build:plugin --check` rides the change.

### 7. Member-move: one atomic primitive; leave-household and eviction spawn a fresh household

`src/member-move.ts` owns `moveMember(env, member, fromTenant, toTenant)` — a single D1-batched relocation plus KV fixups, with an explicit **move manifest** enumerating what relocates:

- `members` row (`tenant` column update; id and handle NEVER change — WebAuthn user handles are burned in),
- `webauthn_credentials` rows (`tenant` update),
- authored `recipe_notes` / `store_notes` rows stay keyed by `author` (member id — nothing to re-key),
- `nicknames` rows they set (`tenant` update; rows targeting them are stable member-id references and survive untouched),
- live web sessions: a `session:*` KV scan re-writes records whose member matches to the new tenant (the `deleteSessionsFor` scan idiom) — sessions survive a move per D23,
- outstanding KV bootstrap invites resolving to the member are deleted (they encode the old tenant; rotation re-mints if needed).

MCP grants do NOT survive: grant props are immutable and library-managed, so a moved member's old grants fail the resolver's `(tenant, member)` liveness pairing and the member re-connects Claude.ai — stated in the flow's copy. The primitive refuses to move a tenant's last member (Decision 3's floor) and refuses when the destination is at the size bound.

**Leave-household and member-remove are the same primitive targeting a freshly spawned household**: a new tenant is minted (registry row, allowlist entry, blank state) and the member moves into it — the leaver/evictee keeps their account, credentials, handle, and authored notes; the old household keeps everything household-scoped, including its whole cookbook (`recipe_imports` rows are household provenance — a leaver takes NO recipe grants; their new household starts at the D3 cold start). Spawned tenant id: the member's handle when free (no allowlist entry, no registry row), else `<handle>-2`, `-3`, … (the hyphen suffix is outside the new-handle grammar, so suffixed ids are unclaimable by future mints). The spawned household's founder keeps their existing member id — so the founding invariant (id = tenant id) is scoped to onboarding/signup-created tenants in the multi-tenancy delta; the identity-split's lazy convergence guard is unaffected (it only fires when `memberId === tenantId` AND the tenant has zero member rows, which never holds for a spawned tenant).

**Alternative rejected**: remove-as-revoke (deleting the member outright). Another member's click must never destroy a person's account and credentials; eviction-preserving-the-account is the only defensible any-member-authority semantics.

### 8. v1 move manifest deliberately excludes not-yet-member-keyed state (flagged)

D23's enumeration includes favorites/rejects overlay, taste + dietary, and authored cook-log rows — but those tables are tenant-keyed today, and the identity split explicitly deferred their member-keying to feature changes. This change does NOT member-key them (Non-Goals): in v1 they remain household state — a leaver does not take favorites, taste, or cooking history, and on household-accept-with-dissolution they are purged with the old household. This is stated honestly in the D23 confirmation enumeration (Decision 9) and recorded as a deliberate v1 reduction, **flagged to the orchestrator**: a follow-on change (e.g. `member-scoped-profiles`, pre-requisite to D29's real attendance blend) member-keys `overlay`/`taste`/`diet_principles`/`cooking_log` and extends the move manifest — the primitive is specced with an explicit manifest precisely so extension is additive.

### 9. Household-accept for an existing account = member-move + tenant dissolution (D23)

When the accepting mover is the SOLE member of their existing household, accept runs: (1) the explicit in-flow confirmation enumerating what does NOT carry over — pantry, meal plan, grocery list, staples, stockup, ready-to-eat, stores + store notes, the Kroger link, and (v1, per Decision 8) favorites/rejects, taste & dietary text, and cooking history — plus "your Claude connection must be re-connected"; (2) `moveMember` into the absorbing household; (3) grant re-key: the old tenant's `recipe_imports` rows re-key to the absorbing tenant (`INSERT OR IGNORE` under the `(recipe, tenant)` PK, then delete the old rows — first-provenance-wins where the absorber already holds a grant); (4) the old tenant's household state is purged via the revoke-shaped path MINUS member-scoped rows (the household-purge table set less `members`/credentials/sessions — the mover's rows already relocated); (5) the old tenant retires: allowlist entry deleted, registry row deleted, its outgoing requests cancelled, its invite links revoked, its friendships severed. A member of a multi-member household must leave-household first (v1; the accept flow says so with a structured error and pointer). The deployment's first real household formation is the acceptance fixture (D23).

### 10. Invite links: a third invite kind; `/join/:token`; signup forks on token kind

`member_invites` is deliberately a THIRD kind beside the two shipped ones, reconciled by effect and authority — KV bootstrap invites (operator-minted; RESOLVE an existing member for login), D1 group codes (operator-minted; CREATE a standalone tenant, capped), member invite links (member-minted; CREATE a relationship, and an account when needed). No shared namespace, no shared redemption path (extending the existing two-kinds requirement to the trio). Mechanics:

- **Mint** from the People page adders: `{ tier }` → token (>= 128 bits, URL-safe), single-use, 14-day expiry (both fixed in v1 — no member knobs; per-invite rows carry `inviter_member` and `tier`, pages/08's per-invite requirement). The link is `<origin>/join/<token>`. Copy-link UX with "Copied!" feedback.
- **`/join/:token`** is an SPA route (absorbed by the asset fallback — NO `run_worker_first` entry); it reads `GET /api/join/:token` (public, rate-limited per IP) returning `{ inviter_handle, tier, deployment }` for a valid token, and a UNIFORM `invalid_or_expired` for unknown, expired, revoked, and already-redeemed tokens — cancel/revocation is oracle-free (resolves pages/08 q3: cancel REVOKES the token; the awaiting row disappears for the inviter; the visitor sees the same terminal state as any dead link).
- **Redemption without an account** (`POST /api/join/:token`): household tier → mints a MEMBER (ULID id, chosen grammar-valid handle, display name optional) in the inviter's tenant, size-bound enforced, then the standard member-bound session + passkey-enroll prompt (the signup idiom). Friend tier → mints a new TENANT (chosen username = founding handle, the signup path) plus the friendship edge to the inviter's household in the same flow. Both consume the token atomically with the mint (claimed-then-created, the group-code refund idiom on collision).
- **Redemption signed-in**: a household-tier link converts to the household-accept flow (Decision 9's confirmation and rules — the link is a bearer invitation); a friend-tier link creates the edge after a confirm (idempotent if already friends). Blocks apply: a link redeemed by a blocked party silently consumes with no edge and no notification (the swallow posture).
- Friend-tier mints are refused under self-hosted (profile gating); group codes keep creating standalone tenants with NO edge — story 01 §4's "or group code creates a new tenant plus the edge" is resolved as the edge belonging to the friend-invite path only (a group code has no inviter household to befriend).

### 11. People page and `/api/people`

**Endpoints** (one new Hono sub-app `src/api/people.ts` + `people` area route; session-gated except where noted; all under the existing `/api/*` dispatch): `GET /api/people` (aggregate: household members with the viewer's nicknames, friends with "N shared", inbox, awaiting — outgoing requests + unredeemed invite links), `POST /api/people/lookup`, `POST /api/people/requests`, `POST /api/people/requests/:id/accept|decline|cancel`, `POST /api/people/blocks` (+ `DELETE`), `DELETE /api/people/friends/:tenant` (unfriend, silent), `PUT /api/people/nicknames/:member` (upsert; empty body clears), `POST /api/people/invites` + `DELETE /api/people/invites/:token`, `POST /api/people/leave`, `POST /api/people/members/:member/remove`, plus the public `GET/POST /api/join/:token`. "N shared" = `COUNT(recipe_imports WHERE tenant = <friend>)` (D27: the friend household's cookbook size; curated rows belong to the reserved tenant and never inflate it).

**Page** (`/people`, new `_app.people.tsx` route + NAV entry): the SaaS full variant per pages/08 §2 — requests inbox (only when non-empty; avatar initial, **@handle ALWAYS** with any display name beside it never instead of it, HOUSEHOLD/FRIEND badge, inert quoted note, relative time, Accept/Decline, block affordance), nickname hint always visible with the live example composed from the viewer's actual nicknames, HOUSEHOLD section (member rows: You / nickname + @handle / @handle + "Add a nickname"; local avatar color popover — client-only, localStorage, never backend, per the q5 ratification; remove with confirm), Find-members split button (find-by-handle popover | invite-link popover), Awaiting response with cancel, FRIENDS section ("N friends sharing M recipes", "N shared" chips, same nickname/remove mechanics, friend-tier adders, the empty state). Accept flows carry the Decision 6 nickname seed moment and the Decision 9 confirmation when the mover has an existing account.

**Self-hosted variant** (design request #12, local design under the recorded authorization): FRIENDS section, friend-tier request rows, and all friend copy gone; the tier badge column disappears (one tier); the header rewritten ("Everyone you cook alongside. Your household shares your pantry and meal plan." — friends clause dropped); layout rebalanced so HOUSEHOLD carries the page, with the nickname hint promoted to a side-by-side arrangement on wide viewports; an alternate state of the same page component, gated on whoami's `profile`, never a second page. Playwright coverage through the real seeded API for both variants (`aubr test:app`).

**Sidebar badge** activates: people = the count of actionable pending inbound requests (the shell subscribes to the same people aggregate query the page uses — the shared-derivation rule; zero renders no badge; the mock's friend-count badge stays a recorded defect). The people read is NOT added to the offline persist allowlist (Decision 13), so the badge is simply absent after an offline relaunch.

### 12. Operator admin: roster by household, member-revoke UI, purge extensions

- The roster regroups by household: household rows (id, member count, status/Kroger badges, activity) expanding to member rows (@handle, joined age); the summary tiles gain a Households count. Row actions split cleanly: household-level (household-purge, Kroger link) vs member-level (rotate invite, member-revoke — the API the identity split shipped, now surfaced, refusing the last member with the structured pointer to household-purge). `admin/visual/` Playwright coverage extends the members page objects.
- **Household-purge** additionally clears the social tables in BOTH directions: `friendships` and `social_requests` where the tenant is either party, its `member_invites`, `nicknames` rows it holds AND rows targeting its members, and `blocks` it minted as well as blocks others minted against it (purge frees the username, so a suppression record against the dead id is unreachable weight). No dangling member/tenant reference survives a purge.
- **Member-revoke** additionally clears: nicknames they set and nicknames targeting them, their outgoing `social_requests` (cancelled), invite links they minted (revoked), and household-tier block records naming them as `blocked_member` (a revoked member id can never send again, so the record is dead weight). One shared cleanup helper serves both scopes.

### 13. Write classifications (D15) and offline posture

- **Online-only-with-hint** (already enumerated by D15 for social requests/accepts/invite mints, extended here): lookup, request send/accept/decline/cancel, block/unblock, unfriend, invite mint/revoke, join redemption, leave/remove, household-accept. None are ever entered into the mutation cache; the dehydration predicate already refuses unregistered keys.
- **Class (b), registered**: nickname upsert/clear — the deliberate classification: it is exactly the class's definition (idempotent, canonical-key `(viewer, target)` upsert/delete, no external effect), and the in-memory cache keeps the People page interactive across a mid-session connectivity drop, where a queued nickname edit replays safely.
- **Client-local view state**: avatar colors (localStorage, per q5).
- The people aggregate read is NOT persisted to IndexedDB (social data stays out of the offline store; the sidebar people badge is absent after an offline relaunch — a stated consequence, consistent with "badges render offline from persisted reads" reading only allowlisted queries).

### 14. Persona and docs lockstep

TOOLS.md: the `read_user_profile` section gains the `household` block and its guarantees. SCHEMAS.md: `friendships`, `social_requests`, `member_invites`, `nicknames`, `blocks` sections, the handle-grammar note on the members section (added by the sibling's archive; extended here with the new-mint grammar + ULID note), and the invite-kind trio table. ARCHITECTURE.md: the multi-tenant identity section gains the household-membership + friendship paragraphs (the lens change owns the wholesale rewrite; this is an incremental extension). AGENT_INSTRUCTIONS.md: the session-start profile read line (Appendix C band 5) + `aubr build:plugin --check`. Living docs stay current-state (no "used to"/"now").

## Risks / Trade-offs

- **[Household-tier direction vs mock copy]** The invitation model contradicts the mock's "wants to join your household" inbox string. → Forced by the adder + invite-link direction and D23's consent locus (the mover must see the enumeration); recorded as a mock-copy artifact (D5) and flagged in the report for the orchestrator to arbitrate if the reverse direction (join-requests) is ever wanted as a second entry point.
- **[v1 move-manifest reduction]** A leaver loses favorites/taste/cook history contrary to D23's full enumeration. → Stated in the confirmation copy (honest consent); the manifest is extension-shaped; flagged to the orchestrator with a named follow-on. Rejected alternative: member-keying four domain tables here — it would double the change and drag in D29 engine work the band plan never assigned to it.
- **[Grammar tightening breaks operator habits]** Operators who onboard hyphenated usernames get a structured refusal. → Deliberate (stops the grandfather class regrowing); the error names the grammar; existing tenants unaffected; trivially relaxable if the operator objects at review.
- **[Session re-key KV scan]** Member-move scans `session:*` like the revoke paths. → Same cost class as shipped revoke scans; moves are rare, deliberate flows.
- **[Seam query cost]** The friend subquery (`UNION` over two indexed lookups) runs inside every lens evaluation. → Both arms are covered by the PK and `idx_friendships_b`; friend-group scale (tens of households) makes this negligible; the lens change already accepted a set-membership join per read.
- **[Swallow-row accumulation]** Swallowed/declined rows persist to keep the requester view and cap honest. → Bounded by the standing cap (25/member) and the send budget; cancel prunes; purge clears.
- **[Blocked-party inference residual]** A blocked requester could infer state from eternal silence. → Accepted by D24's design (silence is indistinguishable from an unanswered request — the strongest posture short of lying more actively); budgets bound the probe rate.
- **[Spawn-tenant namespace growth]** Leave/eviction mints tenants outside operator onboarding. → Registry rows carry provenance (via member-move); the roster shows them like any household; the size of the deployment's member set is unchanged by construction.

## Migration Plan

1. Land `0060_households_social.sql` with the Worker code in one deploy (additive tables only; old code never reads them — a rollback to the previous Worker runs unchanged against the migrated schema).
2. The seam provider body swap activates friend visibility the moment the first friendship row exists; until then the relation is empty — byte-identical lens behavior to the sibling change (no convergence window).
3. The People page, nav entry, and badge ship in the same deploy; self-hosted deployments see the household-only variant with zero data change.
4. Pre-merge (operator-gated, read-only) production capture: tenant/member counts and grammar-violating username inventory (the grandfather set), `SELECT COUNT(*) FROM members WHERE id != tenant` (expect 0 pre-deploy), post-0059 `recipe_imports` per-tenant counts (sanity for "N shared"), and a sample of `session:*` shapes (re-key predicate fixtures). Observed rows become test fixtures where they diverge from derived shapes.
5. Rollback: revert the Worker deploy; tables 0060 are inert to prior code. Social rows created in the interim survive a re-deploy (append-only lifecycle states; the reconcile-free design has no convergence job to re-run).

## Open Questions

None left open for the implementer. Resolved here: governance + its D24/D10 bindings (Decision 3), household-tier request direction (Decision 4), invite-link cancel semantics (Decision 10), notification path = on-page only (Non-Goals), max household size (Decision 3), nickname write class (Decision 13), the group-code edge interpretation (Decision 10), and the grammar arbitration (Decision 2). Two items are flagged OUTSIDE this change for the orchestrator: the v1 move-manifest reduction follow-on (Decision 8) and the mock inbox-copy correction (Risks).
