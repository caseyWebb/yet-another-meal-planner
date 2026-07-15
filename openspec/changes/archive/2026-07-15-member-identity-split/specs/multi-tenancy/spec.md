## ADDED Requirements

### Requirement: A members table is the member-identity substrate

The Worker SHALL maintain a D1 `members` table — `id` (TEXT primary key), `tenant` (owning household), `handle` (deployment-unique display key, unique-indexed), `created_at` — accessed only through `src/db.ts`, as the substrate of member identity within the tenant (household) boundary. Every tenant SHALL have a FOUNDING MEMBER whose member id and handle EQUAL the canonical tenant id, so every credential value issued before the split (grant props, session records, WebAuthn user handles, invite mappings, note-author values) is already a valid member id and NOTHING is re-keyed. Founding handles SHALL be the tenant id verbatim, grandfathered even where the tenant id falls outside the product handle grammar; handle minting and rename rules for non-founding members are owned by later changes.

Every tenant-creation path SHALL mint the founding member in the same flow that creates the tenant: operator onboarding, group-invite-code self-service redemption, and — for tenants that predate this table — an idempotent seed from the D1 `tenants` registry plus a lazy convergence guard at identity resolution. The guard SHALL mint a founding member row ONLY when the presented member id equals the tenant id AND the tenant has zero `members` rows; under any other condition a missing member row SHALL resolve to a structured `unauthorized`. The `members` table SHALL be purged with the household (it joins the household-purge table set).

#### Scenario: Existing tenants are seeded with founding members

- **WHEN** the member-identity migration runs over a deployment with existing tenants, including more than once
- **THEN** every tenant in the `tenants` registry has exactly one `members` row with `id = tenant`, `handle = tenant`, and re-running the seed changes nothing

#### Scenario: New tenants are born with a founding member

- **WHEN** the operator onboards `casey`, or a visitor redeems a group invite code choosing the username `bob`
- **THEN** the created tenant has a `members` row whose id and handle equal the canonical tenant id, written in the same flow that creates the tenant

#### Scenario: The lazy guard converges a pre-split tenant but resurrects no one

- **WHEN** a request resolves member id equal to its allowlisted tenant id and that tenant has zero `members` rows
- **THEN** the founding member row is minted and the request proceeds; but when the tenant already has any `members` row and the presented member id has none, the request is rejected `unauthorized` and no row is minted

#### Scenario: Handles are unique across the deployment

- **WHEN** a member row is inserted whose handle collides with any existing member's handle
- **THEN** the insert fails on the unique index and no duplicate handle ever exists

## MODIFIED Requirements

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
