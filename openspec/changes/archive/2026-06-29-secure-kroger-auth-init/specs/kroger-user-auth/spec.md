## MODIFIED Requirements

### Requirement: One-time authorization_code OAuth with PKCE

The Worker SHALL obtain a Kroger **user-context** access token via the `authorization_code` grant with PKCE, through an `/oauth/*` route group: an init step that redirects to Kroger's authorize endpoint with a PKCE `code_challenge` and a `state` value, and a callback step that exchanges the returned `code` + verifier for an access token and a refresh token. The **initiating tenant SHALL be established from an authenticated context** — a single-use nonce minted by an authenticated caller (the MCP-grant-minted nonce of the "Authenticated minting of the Kroger consent link" requirement, or the Access-gated admin surface) — and SHALL NOT be taken from unauthenticated request input such as a `?tenant` query param. The init step SHALL redeem the nonce to its bound tenant and consume it (single-use) before redirecting to Kroger; an absent, unknown, or expired nonce SHALL be rejected and SHALL start no flow. The `state` SHALL be bound to the redeemed initiating tenant so the callback stores the resulting refresh token under that tenant. The callback SHALL verify `state` to reject forged or replayed redirects. Each member of the group SHALL authorize their own Kroger shopping account against the operator's single shared Kroger app; members SHALL NOT register their own Kroger Developer app.

#### Scenario: One-time authorization completes for a tenant

- **WHEN** a tenant opens its authenticated consent link and approves access at Kroger
- **THEN** the init step redeems the link's nonce to that tenant, the callback exchanges the code (with the PKCE verifier) for an access + refresh token, and stores the refresh token under that tenant's key

#### Scenario: Forged callback rejected

- **WHEN** a callback arrives whose `state` does not match an initiated flow
- **THEN** the Worker rejects it and performs no token exchange

#### Scenario: One shared Kroger app serves many users

- **WHEN** two different tenants each complete the Kroger authorization
- **THEN** both authorize against the same operator-owned Kroger app and each gets their own stored refresh token, with no per-user Kroger Developer registration

#### Scenario: Init without a valid nonce starts no flow

- **WHEN** an `/oauth/init` request arrives with no nonce, or a nonce that is unknown, already-consumed, or expired
- **THEN** the Worker rejects the request, redirects to no authorize endpoint, and binds no tenant

#### Scenario: An unauthenticated tenant claim cannot bind a token

- **WHEN** a caller attempts to initiate a Kroger flow for a tenant it has not authenticated as (e.g. by asserting a tenant in request input rather than presenting a nonce minted for that tenant)
- **THEN** no flow starts and no refresh token is ever stored under that tenant's key from this request

## ADDED Requirements

### Requirement: Authenticated minting of the Kroger consent link

The Worker SHALL provide an authenticated way to obtain a Kroger consent link such that the initiating tenant is **proven, not asserted**. An MCP tool (`kroger_login_url`) callable only on the authenticated `/mcp` surface SHALL take **no tenant input** and SHALL derive the tenant from the request's resolved grant (`tenantId`); it SHALL mint a **single-use** nonce bound to that tenant, persist it with a **short expiry**, and return the `/oauth/init?nonce=<nonce>` URL derived from the request origin. The nonce SHALL be redeemable exactly once and SHALL expire on its own; the Worker SHALL NOT write the nonce to any log, run summary, or other externally-readable sink. The same single-use nonce SHALL also be mintable from the Access-gated admin surface (see the operator-admin capability) for the bootstrap case where the operator — or a member the operator is helping — has no `/mcp` session yet.

#### Scenario: Agent mints a consent link for its own tenant

- **WHEN** the agent calls `kroger_login_url` on an authenticated `/mcp` session for tenant `casey`
- **THEN** the tool mints a single-use nonce bound to `casey` and returns an `/oauth/init?nonce=<nonce>` URL, taking no tenant from any argument

#### Scenario: A minted nonce is single-use and expires

- **WHEN** a nonce is redeemed once at `/oauth/init`, or its expiry elapses
- **THEN** a second redemption of the same nonce starts no flow

#### Scenario: The tool cannot mint for another tenant

- **WHEN** the `kroger_login_url` tool is invoked
- **THEN** the minted nonce is bound only to the caller's own resolved grant tenant, with no tenant accepted from tool input
