## MODIFIED Requirements

### Requirement: MCP endpoint connectable as a Claude.ai custom connector

The deployed MCP endpoint SHALL be connectable from Claude.ai as a custom connector using only its URL, authorizing through Cloudflare Access Managed OAuth. The Access authorization server MUST accept an external client that performs its own dynamic client registration (DCR) and presents its own redirect URI — distinct from the Claude Code client that has connected previously. The redirect URI presented by the client MUST be permitted by the Access application's allowed-redirect-URI configuration (DCR registration alone is not sufficient; the authorize endpoint validates the redirect URI against the app-level allowlist).

#### Scenario: Claude.ai client completes Access Managed OAuth

- **WHEN** a custom connector pointed at the MCP endpoint is added in Claude.ai and the owner approves the Access authorization prompt
- **THEN** Access accepts Claude.ai's dynamically registered OAuth client and issues a token, the connector reaches a connected state, and the yamp tool list is enumerated in Claude.ai

#### Scenario: Owner can authorize from a fresh phone session

- **WHEN** the connection is authorized from a phone with no pre-existing Access browser session
- **THEN** the Access only-owner identity policy permits the owner to sign in via its configured identity provider and the OAuth flow completes without relying on a cached desktop session

#### Scenario: Redirect URI not on the app allowlist is rejected pre-login

- **WHEN** the client presents a redirect URI that is registered via DCR but absent from the Access application's allowed-redirect-URI list
- **THEN** the authorize request is rejected before any login prompt with `invalid_request` / "Redirect URI not allowed by application configuration", and the connector reports an authorization failure

### Requirement: Authorized read flows from a connected Claude.ai client

A connected Claude.ai client SHALL be able to invoke repo-data read tools and receive correct results, confirming the authorized read path through Access for the Claude.ai OAuth client.

#### Scenario: Pantry and recipe reads return real data

- **WHEN** the owner asks "what's in my pantry?" and "show me chicken recipes" in a yamp conversation
- **THEN** the agent invokes the corresponding read tools through the connector and returns the owner's real pantry contents and matching recipes
