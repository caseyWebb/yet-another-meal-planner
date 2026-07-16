# multi-tenancy Specification

## Purpose
TBD - created by archiving change multi-tenant-friend-group. Update Purpose after archive.
## Requirements
### Requirement: Worker is a multi-tenant OAuth 2.1 provider

The Worker SHALL act as an OAuth 2.1 authorization server for the MCP surface so that each member of the friend group connects their own Claude.ai account to the one shared Worker. The Worker SHALL support the dynamic client registration + authorization-code + PKCE flow that the Claude.ai custom-connector requires, and SHALL issue an access token whose presentation on a later MCP request resolves to exactly one tenant and one member within it. OAuth provider state (registered clients, authorization codes, grants/tokens) SHALL be stored in KV — no SQL database. The access token SHALL be the sole identity carried on MCP calls; the Worker SHALL NOT rely on Cloudflare Access for MCP-surface identity. Completing the `/authorize` step SHALL establish the member's identity by CROSS-DEVICE APPROVAL rather than by entering a standing secret on the OAuth page: the page mints a single-use approval reference and the member approves from the passkey-authenticated web app, which binds the approving member's `(tenant, member)` pair to the reference and completes the grant with BOTH ids in its props (`{ tenantId, memberId }`); the grant's `userId` SHALL remain the tenant id so tenant-keyed grant enumeration (the roster's active/pending derivation) is unchanged (see the `passkey-auth` capability). While the operator grace control (see `operator-admin`) is on, the `/authorize` page MAY additionally accept a legacy invite code as a bootstrap fallback for members who have not yet enrolled a passkey, binding the `(tenant, member)` pair the invite resolves to; once grace is off, a standing invite code SHALL NOT complete authorization. A malformed `/authorize` request SHALL render a clean error page with an HTTP 400 status — not a generic 500 — on both the GET and POST paths, consistent with the repo's "structured errors, not throws" convention at user-facing boundaries; `redirect_uri` validation remains unchanged (no open redirect).

#### Scenario: A friend connects their own Claude.ai by approval

- **WHEN** a friend adds the connector in their Claude.ai account and approves the pending connection from their passkey-authenticated web app
- **THEN** the Worker issues an access token bound to that friend's tenant and member (props `{ tenantId, memberId }`, `userId` = tenant id), and subsequent MCP calls carrying it are served in that tenant's context with that member's attribution

#### Scenario: Provider state lives in KV

- **WHEN** the OAuth provider persists a registered client, an authorization code, or an issued grant
- **THEN** it is stored in a KV namespace and no relational/SQL store is introduced

#### Scenario: Standing invite code cannot authorize once grace is off

- **WHEN** grace is off and a member presents only a legacy standing invite code at `/authorize`
- **THEN** the Worker does not complete the authorization and issues no token

#### Scenario: Malformed authorization request yields a 400, not a 500

- **WHEN** a malformed or invalid `/authorize` GET request fails to parse
- **THEN** the Worker renders the malformed-request error page with HTTP 400, the same as the POST path, rather than surfacing an uncaught 500

### Requirement: Identity is gated by a curated allowlist

Completing the OAuth authorization SHALL require the authenticating identity to be on an operator-curated allowlist; this is self-hosting for a known group, not open public registration. An identity not on the allowlist SHALL be denied authorization and SHALL NOT be issued a tenant token. The allowlist SHALL be operator-maintained: an identity joins it either by operator onboarding or by redeeming an operator-issued GROUP INVITE CODE (see `self-service-signup`) — a bounded, operator-authorized form of self-service that is capped, expiring, and revocable, NOT open registration. However an identity is admitted, every tenant SHALL be subject to the same per-request allowlist re-check and the same revocation. A group invite code authorizes the creation of a new allowlisted identity from an available username; it is not itself a standing credential and SHALL NOT grant access to any existing tenant.

#### Scenario: Allowlisted identity is admitted

- **WHEN** an identity on the allowlist completes the authorization flow
- **THEN** it is granted a tenant token mapped to that identity

#### Scenario: Unknown identity is denied

- **WHEN** an identity not on the allowlist attempts to authorize
- **THEN** the Worker denies the authorization and issues no token

#### Scenario: A group invite code admits a new bounded identity

- **WHEN** a visitor redeems a valid, non-exhausted, unexpired, unrevoked group invite code and chooses an available username
- **THEN** a new allowlisted tenant is created for that username and is thereafter resolved and re-checked exactly like any operator-onboarded tenant; a code that is exhausted, expired, or revoked adds no identity

### Requirement: Per-request tenant resolution

Every MCP request SHALL be resolved to a `(tenantId, memberId)` pair from its bearer access token before any tool runs, through one shared identity resolver also used by the member `/api` session path: the tenant id is canonicalized and re-checked against the allowlist exactly as before, and the member id is checked for liveness against the `members` table (subject to the lazy founding-member convergence guard). Grant props carry `{ tenantId, memberId }`; a grant minted before the member-identity split carries `{ tenantId }` only and SHALL resolve to the founding member (`memberId = tenantId`) — the uniform legacy-defaulting rule. A request with a missing, invalid, or unresolvable token, an unallowlisted tenant, or a member id with no live `members` row SHALL be rejected with a structured `unauthorized` response and SHALL NOT reach any tool. The MCP server instance handling a request SHALL be constructed for the resolved tenant-and-member context so that no tool can read or write another tenant's data; the tenant remains the isolation boundary and the member is attribution within it.

#### Scenario: Token resolves to a tenant and member

- **WHEN** an MCP request arrives with a valid issued access token whose grant props carry `{ tenantId, memberId }`
- **THEN** the Worker resolves the pair, re-checks the tenant against the allowlist and the member against the `members` table, and serves the request in that tenant's context with that member's attribution

#### Scenario: A pre-split grant resolves to the founding member

- **WHEN** an MCP request arrives with a token whose grant props carry only `{ tenantId }`
- **THEN** the Worker resolves `memberId = tenantId` (the founding member) and the request is served exactly as it was before the split

#### Scenario: Unresolvable token is rejected

- **WHEN** an MCP request arrives with no token or a token that does not resolve to an allowlisted tenant
- **THEN** the Worker returns a structured `unauthorized` response and runs no tool

#### Scenario: A revoked member's token stops resolving

- **WHEN** an MCP request arrives with a token whose grant names a member that has been removed from the `members` table while the tenant remains allowlisted and holds other member rows
- **THEN** the member-liveness check fails, the Worker returns a structured `unauthorized` response, and no tool runs — even though the grant record still exists in the OAuth store

### Requirement: Per-tenant Kroger refresh-token storage

The Worker SHALL store each tenant's Kroger refresh token under a per-tenant KV key (e.g. `kroger:refresh:<tenant>`), and SHALL resolve the Kroger user context for a cart write from the requesting tenant's key. One tenant's Kroger authorization SHALL be independent of every other tenant's. The Kroger read-side (`client_credentials`) credentials remain a single app-level secret shared by all tenants.

#### Scenario: Cart write uses the requesting tenant's Kroger token

- **WHEN** tenant B places an order
- **THEN** the Worker uses tenant B's Kroger refresh token to obtain user context, never another tenant's

#### Scenario: Read credentials are shared

- **WHEN** any tenant performs a product search, price, or flyer lookup
- **THEN** the Worker uses the single app-level `client_credentials` app, with no per-tenant read credentials

### Requirement: Tenant directory (username allowlist)

The Worker SHALL maintain a tenant directory: the operator-curated **allowlist of usernames** permitted to resolve to a tenant. The data-repository coordinates and the GitHub App installation are global/derived, so the directory record need carry no per-tenant repo coordinates. The directory SHALL be the operational source of truth for tenant resolution and SHALL live in KV alongside the OAuth provider and Kroger state — domain data (recipes, pantry, etc.) is NOT stored here; it remains in the data repo.

#### Scenario: Directory admits an allowlisted username

- **WHEN** a tenant is resolved from its token
- **THEN** the Worker confirms the username is in the directory allowlist and resolves it to its canonical tenant id; a username absent from the allowlist resolves to `unauthorized`

#### Scenario: Directory holds no domain data

- **WHEN** the tenant directory is inspected
- **THEN** it contains only operational mapping (the username allowlist), not pantry/recipe/preference content

### Requirement: Tenant usernames are case-insensitive (canonical lowercase)

Tenant usernames SHALL be case-insensitive: a member is one identity regardless of the casing presented. The Worker SHALL define a single canonical form — **lowercase** — and SHALL apply it at every boundary that derives a key from the username, so the directory key, the invite target, the grant prop, the D1 tenant id, and the Kroger token key all agree. Specifically:

- The Worker SHALL normalize the grant's `tenantId` to its canonical lowercase form **before** the allowlist (tenant directory) lookup and before constructing any `tenant:<id>` directory key, D1 tenant id, or `kroger:refresh:<id>` token key. Normalization before the lookup is the single defensive point: a mixed-case grant SHALL resolve to the same tenant — and the same D1 rows — as the lowercase form, never to a distinct or empty identity.
- Member provisioning SHALL mint the `tenant:<id>` allowlist entry, the stored record `id`, and the `invite:<code>` target in canonical lowercase form, so the directory key and the D1 tenant id agree at the source.
- The invite-code identity step SHALL return the canonical lowercase username, so the grant prop derived from it is already normalized.
- Tenant **directory enumeration** (`TenantStore.list()`) SHALL return canonical lowercase ids, matching `get()`, so cross-tenant group-aggregation consumers that derive `users/<id>/...` GitHub paths or `profile:<id>` KV keys from the enumerated ids never inherit stored casing.
- Shared-root data (recipes, reference data, discovery sources) does NOT use the username and SHALL be unaffected by this normalization.

A consequence is that a username that differs only by case is NOT a distinct tenant; the directory SHALL NOT hold two entries that collide under canonicalization.

#### Scenario: Mixed-case grant resolves to the lowercase tenant id and allowlist entry

- **WHEN** an MCP request arrives whose grant `tenantId` is `Casey` (or `CASEY`) and the allowlist holds the canonical entry `casey`
- **THEN** the Worker normalizes the id to `casey`, confirms it against the allowlist, and resolves the tenant to the canonical id `casey` — the same result as a grant of `casey`

#### Scenario: Directory enumeration returns canonical ids

- **WHEN** `TenantStore.list()` enumerates a directory key stored with non-canonical casing (e.g. `tenant:Casey`)
- **THEN** it returns the canonical id `casey`, so group-aggregation paths and keys derived from it match the member's own normalized writes

### Requirement: Tenant ids are unique under concurrent self-service creation

The Worker SHALL guarantee tenant-id uniqueness even when identities are created concurrently through self-service signup. Tenant ids SHALL have a strongly-consistent registry in D1 (a `tenants` table keyed by the canonical lowercase id) that is the uniqueness authority: a self-service claim SHALL insert into this registry and SHALL fail if the id already exists, so two simultaneous claims of the same new username resolve to exactly one winner and the other is rejected. A self-service claim SHALL additionally reject an id already present in the KV `tenant:<id>` allowlist, so a chosen username can never collide with an already-onboarded member even before the registry is fully populated. The KV `tenant:<id>` allowlist directory SHALL remain the hot-path resolution authority and SHALL be written only after the registry claim wins. Existing tenants SHALL be backfilled into the registry so it is the complete record going forward; the backfill SHALL be idempotent and SHALL converge existing members with no operator action and no manual data surgery.

#### Scenario: Concurrent same-username claims yield exactly one tenant

- **WHEN** two visitors simultaneously redeem group codes and both choose the previously-unused username `bob`
- **THEN** the D1 registry admits exactly one of them, the other is rejected as taken, and only one `tenant:bob` allowlist entry is ever written

#### Scenario: A chosen username cannot collide with an existing member

- **WHEN** a self-service redemption chooses a username equal to an already-onboarded tenant id
- **THEN** the claim is rejected before any allowlist or registry write, and no slot is spent

#### Scenario: The registry backfill is idempotent

- **WHEN** the tenant-registry backfill runs over the existing KV allowlist, including more than once
- **THEN** every existing tenant appears exactly once in the registry and re-running the backfill changes nothing

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

### Requirement: Tenant (household) data isolation

Per-tenant data isolation SHALL be enforced in D1 with the tenant as the **household** boundary: every per-tenant table carries a `tenant` column, the MCP server instance and the `/api` session context are constructed for the resolved `(tenantId, memberId)` pair, and each query is scoped to that tenant — a tool or route resolved for one household cannot read or write another household's rows. The member is attribution within the household, never an isolation boundary of its own. Shared corpus content (R2 recipe/guidance markdown and the D1 projections derived from it) is deployment-shared by construction and crosses household boundaries ONLY through the defined visibility lens and aggregate reads (the `shared-corpus` capability); data derived from household behavior (cook activity, favorites, prices paid, follows) is memoized within its owning household and crosses households exclusively through those same lenses/aggregates. The Worker SHALL hold no GitHub credentials and make no GitHub API call on any data path: the authored corpus lives in R2 and operational state in D1/KV.

#### Scenario: Household writes are isolated in D1

- **WHEN** a tool for household A persists a change to A's state
- **THEN** the write is scoped to tenant A's rows and can never touch another household's rows

#### Scenario: Cross-household reads go through the lens

- **WHEN** a read surface exposes another household's recipe or cook activity to a member of household A
- **THEN** it does so only through the visibility lens or a defined counts-only aggregate — never by raw cross-tenant query reuse

#### Scenario: No GitHub credential exists

- **WHEN** the Worker's configuration, secrets, and data paths are inspected
- **THEN** there is no GitHub App, installation token, or PAT, and no data path performs a GitHub API call

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

