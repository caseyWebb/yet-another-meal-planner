## MODIFIED Requirements

### Requirement: A members table is the member-identity substrate

The Worker SHALL maintain a D1 `members` table — `id` (TEXT primary key), `tenant` (owning household), `handle` (deployment-unique display key, unique-indexed), `created_at` — accessed only through `src/db.ts`, as the substrate of member identity within the tenant (household) boundary. Every tenant created by operator onboarding or by a tenant-creating signup path SHALL have a FOUNDING MEMBER whose member id and handle EQUAL the canonical tenant id, so every credential value issued before the split (grant props, session records, WebAuthn user handles, invite mappings, note-author values) is already a valid member id and NOTHING is re-keyed; a tenant spawned by the member-move primitive is instead founded by the moving member, who KEEPS their existing member id and handle (member ids never change — WebAuthn user handles are burned into authenticators). NON-FOUNDING members SHALL be minted with server-generated ULID member ids and a member-chosen handle. Every NEW handle or username mint — join-link and invitation handles, self-service usernames, operator-onboarded usernames — SHALL validate against ONE handle grammar, `^[a-z0-9_]{3,20}$`; every handle and tenant id already issued is grandfathered verbatim (including values outside the grammar), and machine-suffixed spawned-tenant ids use a hyphen deliberately outside the grammar so they can never collide with a future mint. Handle RENAME rules remain owned by a later change.

Every tenant-creation path SHALL mint the founding member in the same flow that creates the tenant: operator onboarding, group-invite-code self-service redemption, friend-tier invite-link redemption, the member-move spawn, and — for tenants that predate this table — an idempotent seed from the D1 `tenants` registry plus a lazy convergence guard at identity resolution. The guard SHALL mint a founding member row ONLY when the presented member id equals the tenant id AND the tenant has zero `members` rows; under any other condition a missing member row SHALL resolve to a structured `unauthorized`. The `members` table SHALL be purged with the household (it joins the household-purge table set).

#### Scenario: Existing tenants are seeded with founding members

- **WHEN** the member-identity migration runs over a deployment with existing tenants, including more than once
- **THEN** every tenant in the `tenants` registry has exactly one `members` row with `id = tenant`, `handle = tenant`, and re-running the seed changes nothing

#### Scenario: New tenants are born with a founding member

- **WHEN** the operator onboards `casey`, or a visitor redeems a group invite code or a friend-tier invite link choosing the username `bob`
- **THEN** the created tenant has a `members` row whose id and handle equal the canonical tenant id, written in the same flow that creates the tenant

#### Scenario: A second member is minted with a ULID and a grammar-valid handle

- **WHEN** a household-tier invitation or invite link is accepted with the chosen handle `grandma_j`
- **THEN** a `members` row is created under the inviter's tenant with a server-minted ULID id and handle `grandma_j`, and a chosen handle failing `^[a-z0-9_]{3,20}$` or colliding with any existing handle is refused with a structured error

#### Scenario: Grandfathered identities keep working; new mints are gated

- **WHEN** a pre-existing tenant id such as `caseys-kitchen` (hyphenated) resolves identity, and separately a new signup chooses `caseys-kitchen2`
- **THEN** the existing tenant and its founding handle work unmodified, while the new mint is refused for failing the handle grammar

#### Scenario: The lazy guard converges a pre-split tenant but resurrects no one

- **WHEN** a request resolves member id equal to its allowlisted tenant id and that tenant has zero `members` rows
- **THEN** the founding member row is minted and the request proceeds; but when the tenant already has any `members` row and the presented member id has none, the request is rejected `unauthorized` and no row is minted

#### Scenario: Handles are unique across the deployment

- **WHEN** a member row is inserted whose handle collides with any existing member's handle
- **THEN** the insert fails on the unique index and no duplicate handle ever exists

## ADDED Requirements

### Requirement: A member-move primitive relocates member-scoped state atomically

The Worker SHALL provide ONE member-move primitive that relocates a member between tenants with an explicit move manifest, used by leave-household, member-remove (eviction), and household-accept: the `members` row's tenant, the member's `webauthn_credentials` rows, the nicknames they set, and their live web sessions (re-written to the new tenant by the session-scan idiom) move together; authored `recipe_notes`/`store_notes` rows are already keyed by the stable member id and need no re-key; outstanding KV bootstrap invites resolving to the member are deleted. The member's id and handle SHALL NOT change. Pre-move MCP grants SHALL NOT survive (grant props are immutable): the shared resolver's `(tenant, member)` pairing check stops resolving them and the member re-connects Claude.ai — the flows state this. In v1 the manifest deliberately EXCLUDES state that is not yet member-keyed (favorites/rejects overlay, taste and dietary text, cooking history — they remain household state), and every flow whose confirmation enumerates what does not carry over SHALL include them. The primitive SHALL refuse to move a tenant's last member other than as part of household-accept dissolution, and SHALL refuse a destination at the household size bound.

Leave-household and member-remove SHALL target a FRESHLY SPAWNED household: a new tenant (registry row, allowlist entry, blank household state) whose id is the mover's handle when free, else the handle with the smallest free hyphen-numeric suffix; the mover founds it keeping their id and handle. The old household keeps ALL household-scoped state including its entire cookbook — a leaver takes no `recipe_imports` rows and starts at the cold-start floor.

Household-accept for a mover who is the SOLE member of an existing household SHALL run member-move PLUS tenant dissolution, only after an explicit in-flow confirmation enumerating what does NOT carry over: the old tenant's `recipe_imports` rows re-key to the absorbing household (insert-or-ignore under the `(recipe, tenant)` key, old rows deleted), the old household state is purged via the household-purge path minus member-scoped rows, and the old tenant retires — allowlist entry and registry row removed, outgoing requests cancelled, invite links revoked, friendships severed. A member of a multi-member household SHALL be refused with a structured error directing them to leave-household first (v1: multi-member households never merge wholesale).

#### Scenario: Leaving spawns a household and takes only member-scoped state

- **WHEN** member `@sam` (ULID id, one of three members of household `casey`) leaves the household
- **THEN** a new tenant exists (id `sam`, or `sam-2` if `sam` is taken) founded by the same member id and handle, `@sam`'s passkeys, sessions (re-keyed), and set nicknames follow, household `casey` keeps its pantry/plan/list/cookbook untouched, and `@sam`'s new household has zero `recipe_imports` rows

#### Scenario: Sessions survive a move; grants do not

- **WHEN** a member with a live web session and a connected Claude.ai grant moves households
- **THEN** their next `/api` request resolves in the new tenant (the session record was re-written), while their next MCP request fails the resolver's pairing check with a structured `unauthorized` until they re-connect

#### Scenario: Sole-member household-accept dissolves the old tenant

- **WHEN** `@bob`, sole member of household `bob`, accepts a household invitation from `casey` after the confirmation that enumerates the non-carried-over state (pantry, plan, list, staples, stockup, ready-to-eat, stores and store notes, Kroger link, and — v1 — favorites, taste and dietary text, cooking history)
- **THEN** `@bob` is a member of `casey`, `bob`'s recipe grants now belong to `casey` (duplicates collapsed by the primary key), `bob`'s household rows are purged, and `tenant:bob` no longer exists on the allowlist or in the registry

#### Scenario: A multi-member requester must leave first

- **WHEN** a member of a multi-member household accepts a household invitation without having left
- **THEN** the accept is refused with a structured error naming leave-household as the prerequisite, and nothing moves

### Requirement: Household membership is governed by any-member authority with hard floors

Any member of a household SHALL hold full membership authority for that household: removing any other member, accepting or declining inbound requests, cancelling outgoing requests and invite links, severing friendships, and blocking — every destructive action behind an explicit member-app confirmation (nothing removes instantly). No owner or role distinction SHALL exist (the mock's "Household owner" label stays unused). One member's block SHALL bind the household (see `social-graph`). Hard floors: a household SHALL always retain at least one member — the last member can neither leave nor be removed, and the refusal names household-accept (dissolution) and operator household-purge as the alternatives; the operator-surface last-member member-revoke refusal is unchanged. A household SHALL hold at most 8 members (placeholder bound, tunable at implementation), enforced at household-accept and at invite-link redemption with a structured error.

#### Scenario: Any member can remove another, with a confirm

- **WHEN** a non-founding member confirms removal of another member (founding or not) of their household
- **THEN** the removed member is moved to a freshly spawned household per the member-move primitive — their account, credentials, handle, and authored notes survive — and the household continues without them

#### Scenario: The last member hits the floor

- **WHEN** the sole remaining member of a household attempts to leave or a flow attempts to remove them
- **THEN** the operation is refused with a structured error naming household-accept-with-dissolution and operator household-purge as the ways out, and nothing changes

#### Scenario: The size bound refuses a ninth member

- **WHEN** a household holds 8 members and a household-tier accept or invite-link redemption would add a ninth
- **THEN** the operation fails with a structured error naming the bound, no member is minted, and (for a link) the single-use token is not consumed
