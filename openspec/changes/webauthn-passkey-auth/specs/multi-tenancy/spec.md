## MODIFIED Requirements

### Requirement: Worker is a multi-tenant OAuth 2.1 provider

The Worker SHALL act as an OAuth 2.1 authorization server for the MCP surface so that each member of the friend group connects their own Claude.ai account to the one shared Worker. The Worker SHALL support the dynamic client registration + authorization-code + PKCE flow that the Claude.ai custom-connector requires, and SHALL issue an access token whose presentation on a later MCP request resolves to exactly one tenant. OAuth provider state (registered clients, authorization codes, grants/tokens) SHALL be stored in KV — no SQL database. The access token SHALL be the sole tenant identifier carried on MCP calls; the Worker SHALL NOT rely on Cloudflare Access for MCP-surface identity. Completing the `/authorize` step SHALL establish the member's identity by CROSS-DEVICE APPROVAL rather than by entering a standing secret on the OAuth page: the page mints a single-use approval reference and the member approves from the passkey-authenticated web app, which binds the tenant to the reference and completes the grant (see the `passkey-auth` capability). While the operator grace control (see `operator-admin`) is on, the `/authorize` page MAY additionally accept a legacy invite code as a bootstrap fallback for members who have not yet enrolled a passkey; once grace is off, a standing invite code SHALL NOT complete authorization. A malformed `/authorize` request SHALL render a clean error page with an HTTP 400 status — not a generic 500 — on both the GET and POST paths, consistent with the repo's "structured errors, not throws" convention at user-facing boundaries; `redirect_uri` validation remains unchanged (no open redirect).

#### Scenario: A friend connects their own Claude.ai by approval

- **WHEN** a friend adds the connector in their Claude.ai account and approves the pending connection from their passkey-authenticated web app
- **THEN** the Worker issues an access token bound to that friend's tenant, and subsequent MCP calls carrying it are served in that tenant's context

#### Scenario: Provider state lives in KV

- **WHEN** the OAuth provider persists a registered client, an authorization code, or an issued grant
- **THEN** it is stored in a KV namespace and no relational/SQL store is introduced

#### Scenario: Standing invite code cannot authorize once grace is off

- **WHEN** grace is off and a member presents only a legacy standing invite code at `/authorize`
- **THEN** the Worker does not complete the authorization and issues no token

#### Scenario: Malformed authorization request yields a 400, not a 500

- **WHEN** a malformed or invalid `/authorize` GET request fails to parse
- **THEN** the Worker renders the malformed-request error page with HTTP 400, the same as the POST path, rather than surfacing an uncaught 500
