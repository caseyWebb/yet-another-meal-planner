## ADDED Requirements

### Requirement: Operator mints a Kroger consent link from the admin surface

The Access-gated admin surface SHALL mint a Kroger consent link for the operator or for any allowlisted member, covering the bootstrap case where the chosen tenant has no `/mcp` session yet. The endpoint SHALL mint the **same single-use, short-expiry nonce** the `kroger_login_url` MCP tool mints (see the kroger-user-auth capability), bound to the chosen tenant, and SHALL return the `/oauth/init?nonce=<nonce>` URL derived from the request origin. The chosen tenant SHALL be resolved against the allowlist by the same check the rest of `/admin*` uses; an absent or non-allowlisted tenant SHALL be rejected and SHALL mint nothing. The endpoint SHALL be gated by Cloudflare Access exactly like the rest of `/admin*`, including the opt-in rule (404 when the Access configuration is unset), and SHALL NOT be exposed as an MCP tool. The minted nonce SHALL NOT be written to any log or other externally-readable sink, mirroring the invite-code no-log guarantee.

#### Scenario: Operator mints a consent link for a member

- **WHEN** an Access-authenticated operator requests a Kroger consent link for allowlisted member `casey`
- **THEN** the surface mints a single-use nonce bound to `casey` and returns an `/oauth/init?nonce=<nonce>` URL, writing the nonce to no log

#### Scenario: Minting is disabled when the admin surface is

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** the consent-link endpoint responds `404`, minting nothing

#### Scenario: Minting for a non-member is rejected

- **WHEN** the consent-link endpoint names a tenant that is not on the allowlist
- **THEN** the surface returns an `unauthorized`/`not_found`-class error and mints no nonce
