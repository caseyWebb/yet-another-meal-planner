## MODIFIED Requirements

### Requirement: Operator admin surface gated by Cloudflare Access

The Worker SHALL serve an operator admin surface under `/admin` (a static UI) and `/admin/api/*` (its operations), gated by **Cloudflare Access** scoped to that path — not by the Worker's MCP OAuth provider and not by a shared application secret. The Worker SHALL verify the `Cf-Access-Jwt-Assertion` header on every `/admin*` request: the JWT signature against the team's Access JWKS, and its `aud` against the configured application audience. A request lacking a valid, audience-matched assertion SHALL be rejected (`403`) and SHALL reach no admin operation.

When `ACCESS_ALLOWED_EMAILS` (a comma-separated allowlist of operator addresses) is configured, the Worker SHALL additionally require the verified `email` claim to match one of the listed addresses, compared case-insensitively and trimmed; a verified assertion whose `email` claim is absent or not on the list SHALL be rejected (`403`). When `ACCESS_ALLOWED_EMAILS` is unset, any assertion that passes signature/`aud`/issuer verification SHALL be admitted (the prior behavior, unchanged). `ACCESS_ALLOWED_EMAILS` is an optional, non-secret var; the allowlisted addresses SHALL NOT be exposed by any open surface.

The admin surface SHALL be **opt-in**: when the Access configuration (`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`) is unset, `/admin*` SHALL respond `404`, exposing nothing. Any local-development bypass of the gate SHALL be confined to **loopback** request hosts (`localhost` / `127.0.0.1` / `::1`): in a deployed (non-loopback) context the admin surface SHALL NOT be served without a verified assertion even if a bypass flag is set, so an unconfigured deployment can never expose the surface. When a loopback bypass engages, the Worker SHALL emit a warning log.

The Access gate SHALL apply to the admin surface **only**; the MCP surface SHALL continue to use the Worker's own OAuth provider, preserving the rule that the MCP-surface identity does not rely on Cloudflare Access.

#### Scenario: Valid Access session reaches the admin surface

- **WHEN** a request to `/admin` or `/admin/api/*` carries a `Cf-Access-Jwt-Assertion` that verifies against the team JWKS with the configured audience, and `ACCESS_ALLOWED_EMAILS` is unset
- **THEN** the Worker serves the admin UI or runs the requested admin operation

#### Scenario: Missing or invalid assertion is rejected

- **WHEN** a request to `/admin*` arrives with no `Cf-Access-Jwt-Assertion`, a bad signature, or a non-matching `aud`
- **THEN** the Worker responds `403` and runs no admin operation

#### Scenario: Email on the allowlist is admitted

- **WHEN** `ACCESS_ALLOWED_EMAILS` is configured and a request carries a valid, audience-matched assertion whose `email` claim matches a listed address (case-insensitively)
- **THEN** the Worker serves the admin UI or runs the requested admin operation

#### Scenario: Verified assertion off the allowlist is rejected

- **WHEN** `ACCESS_ALLOWED_EMAILS` is configured and a request carries a valid, audience-matched assertion whose `email` claim is absent or not on the list
- **THEN** the Worker responds `403` and runs no admin operation

#### Scenario: Admin surface disabled when unconfigured

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** `/admin*` responds `404`, exposing no admin UI or operation

#### Scenario: Dev bypass serves the panel only on loopback

- **WHEN** the Access vars are unset, the dev bypass flag is set, and the request host is loopback (`localhost` / `127.0.0.1` / `::1`)
- **THEN** the Worker serves the admin surface and emits a warning log

#### Scenario: Dev bypass cannot open a deployed surface

- **WHEN** the Access vars are unset and the dev bypass flag is set, but the request host is not loopback (a deployed context)
- **THEN** `/admin*` responds `404` and the admin surface is not served

#### Scenario: The MCP surface is not gated by Access

- **WHEN** the Access application is configured for `/admin*`
- **THEN** `/mcp`, `/authorize`, and `/oauth/*` remain reachable through the Worker's own OAuth provider, unaffected by the Access gate
