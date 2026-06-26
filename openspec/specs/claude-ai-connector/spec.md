# claude-ai-connector

## Purpose

Define the contract that the deployed grocery-mcp MCP endpoint is connectable from Claude.ai as a custom connector, authorizing through Cloudflare Access Managed OAuth, and that a real external client can complete authorized reads and an authorized write end-to-end. This is the leg distinct from the Worker→GitHub and Worker→Kroger auth; it covers the Claude.ai→Worker path and the connection's externally-observable behavior.

## Requirements

### Requirement: MCP endpoint connectable as a Claude.ai custom connector

The deployed MCP endpoint SHALL be connectable from Claude.ai as a custom connector using only its URL, authorizing through Cloudflare Access Managed OAuth. The Access authorization server MUST accept an external client that performs its own dynamic client registration (DCR) and presents its own redirect URI — distinct from the Claude Code client that has connected previously. The redirect URI presented by the client MUST be permitted by the Access application's allowed-redirect-URI configuration (DCR registration alone is not sufficient; the authorize endpoint validates the redirect URI against the app-level allowlist).

#### Scenario: Claude.ai client completes Access Managed OAuth

- **WHEN** a custom connector pointed at the MCP endpoint is added in Claude.ai and the owner approves the Access authorization prompt
- **THEN** Access accepts Claude.ai's dynamically registered OAuth client and issues a token, the connector reaches a connected state, and the grocery-mcp tool list is enumerated in Claude.ai

#### Scenario: Owner can authorize from a fresh phone session

- **WHEN** the connection is authorized from a phone with no pre-existing Access browser session
- **THEN** the Access only-owner identity policy permits the owner to sign in via its configured identity provider and the OAuth flow completes without relying on a cached desktop session

#### Scenario: Redirect URI not on the app allowlist is rejected pre-login

- **WHEN** the client presents a redirect URI that is registered via DCR but absent from the Access application's allowed-redirect-URI list
- **THEN** the authorize request is rejected before any login prompt with `invalid_request` / "Redirect URI not allowed by application configuration", and the connector reports an authorization failure

### Requirement: Authorized read flows from a connected Claude.ai client

A connected Claude.ai client SHALL be able to invoke repo-data read tools and receive correct results, confirming the authorized read path through Access for the Claude.ai OAuth client.

#### Scenario: Pantry and recipe reads return real data

- **WHEN** the owner asks "what's in my pantry?" and "show me chicken recipes" in a Grocery Agent conversation
- **THEN** the agent invokes the corresponding read tools through the connector and returns the owner's real pantry contents and matching recipes

### Requirement: Authorized write commits end-to-end from a connected Claude.ai client

A connected Claude.ai client SHALL be able to perform an authorized write that lands a real git commit through the Access OAuth path. A read-only verification MUST NOT be treated as sufficient.

#### Scenario: Pantry update commits through the gate

- **WHEN** the owner says "I ran out of olive oil" and confirms the update
- **THEN** the agent invokes `update_pantry` through the connector, the write succeeds through Cloudflare Access, and the pantry row is updated in D1

#### Scenario: Recipe update commits through the gate

- **WHEN** the owner says "mark the salmon thing as a favorite"
- **THEN** the agent invokes `toggle_favorite` through the connector and the change is persisted in D1

### Requirement: Managed-OAuth fallback to a Worker-served OAuth provider

If Cloudflare Access Managed OAuth (open beta) cannot serve Claude.ai's OAuth client — DCR, redirect URI, or token issuance is rejected such that the connector cannot authorize — the system SHALL fall back to serving OAuth from the Worker itself via `workers-oauth-provider`, with the only-owner authorization preserved.

#### Scenario: Connector cannot authorize via Managed OAuth

- **WHEN** adding the Claude.ai connector fails to reach a connected state because Access Managed OAuth rejects Claude.ai's dynamically registered client
- **THEN** OAuth is served from the Worker via `workers-oauth-provider` instead of Access Managed OAuth, and the Claude.ai connector authorizes against the Worker-served endpoints while still authorizing only the owner
