## ADDED Requirements

### Requirement: MCP endpoint connectable as a Claude.ai custom connector

The deployed MCP endpoint SHALL be connectable from Claude.ai as a custom connector using only its URL, authorizing through Cloudflare Access Managed OAuth. The Access authorization server MUST accept an external client that performs its own dynamic client registration (DCR) and presents its own redirect URI — distinct from the Claude Code client that has connected previously.

#### Scenario: Claude.ai client completes Access Managed OAuth

- **WHEN** a custom connector pointed at `https://groceries-mcp.caseywebb.xyz/mcp` is added in Claude.ai and the owner approves the Access authorization prompt
- **THEN** Access accepts Claude.ai's dynamically registered OAuth client and issues a token, the connector reaches a connected state, and the grocery-mcp tool list is enumerated in Claude.ai

#### Scenario: Owner can authorize from a fresh phone session

- **WHEN** the connection is authorized from a phone with no pre-existing Access browser session
- **THEN** the Access only-owner identity policy permits the owner to sign in via its configured identity provider and the OAuth flow completes without relying on a cached desktop session

### Requirement: Authorized read flows from a connected Claude.ai client

A connected Claude.ai client SHALL be able to invoke repo-data read tools and receive correct results, confirming the authorized read path through Access for the Claude.ai OAuth client.

#### Scenario: Pantry and recipe reads return real data

- **WHEN** the owner asks "what's in my pantry?" and "show me chicken recipes" in a Grocery Agent conversation
- **THEN** the agent invokes the corresponding read tools through the connector and returns the owner's real pantry contents and matching recipes

### Requirement: Authorized write commits end-to-end from a connected Claude.ai client

A connected Claude.ai client SHALL be able to perform an authorized write that lands a real git commit through the Access OAuth path. This closes the deferred verification of authenticated `commit_changes` end-to-end (task 8.2 of the git-write-tools change). A read-only verification MUST NOT be treated as sufficient.

#### Scenario: Pantry update commits through the gate

- **WHEN** the owner says "I ran out of olive oil" and confirms the update
- **THEN** the agent invokes the pantry write and `commit_changes` through the connector, the write succeeds through Cloudflare Access, and a corresponding commit appears in the repo

#### Scenario: Recipe rating commits through the gate

- **WHEN** the owner says "rate the salmon thing 4 stars"
- **THEN** the agent invokes `update_recipe` through the connector and the rating change is committed to the repo

### Requirement: Managed-OAuth fallback to a Worker-served OAuth provider

If Cloudflare Access Managed OAuth (open beta) cannot serve Claude.ai's OAuth client — DCR, redirect URI, or token issuance is rejected such that the connector cannot authorize — the system SHALL fall back to serving OAuth from the Worker itself via `workers-oauth-provider`, with the only-owner authorization preserved.

#### Scenario: Connector cannot authorize via Managed OAuth

- **WHEN** adding the Claude.ai connector fails to reach a connected state because Access Managed OAuth rejects Claude.ai's dynamically registered client
- **THEN** OAuth is served from the Worker via `workers-oauth-provider` instead of Access Managed OAuth, and the Claude.ai connector authorizes against the Worker-served endpoints while still authorizing only the owner
