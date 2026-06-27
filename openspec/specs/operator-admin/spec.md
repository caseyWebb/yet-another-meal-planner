# operator-admin Specification

## Purpose
TBD - created by archiving change operator-admin-panel. Update Purpose after archive.
## Requirements
### Requirement: Operator admin surface gated by Cloudflare Access

The Worker SHALL serve an operator admin surface under `/admin` (a static UI) and `/admin/api/*` (its operations), gated by **Cloudflare Access** scoped to that path — not by the Worker's MCP OAuth provider and not by a shared application secret. The Worker SHALL verify the `Cf-Access-Jwt-Assertion` header on every `/admin*` request: the JWT signature against the team's Access JWKS, and its `aud` against the configured application audience. A request lacking a valid, audience-matched assertion SHALL be rejected (`403`) and SHALL reach no admin operation. The admin surface SHALL be **opt-in**: when the Access configuration (`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`) is unset, `/admin*` SHALL respond `404`, exposing nothing. The Access gate SHALL apply to the admin surface **only**; the MCP surface SHALL continue to use the Worker's own OAuth provider, preserving the rule that the MCP-surface identity does not rely on Cloudflare Access.

#### Scenario: Valid Access session reaches the admin surface

- **WHEN** a request to `/admin` or `/admin/api/*` carries a `Cf-Access-Jwt-Assertion` that verifies against the team JWKS with the configured audience
- **THEN** the Worker serves the admin UI or runs the requested admin operation

#### Scenario: Missing or invalid assertion is rejected

- **WHEN** a request to `/admin*` arrives with no `Cf-Access-Jwt-Assertion`, a bad signature, or a non-matching `aud`
- **THEN** the Worker responds `403` and runs no admin operation

#### Scenario: Admin surface disabled when unconfigured

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** `/admin*` responds `404`, exposing no admin UI or operation

#### Scenario: The MCP surface is not gated by Access

- **WHEN** the Access application is configured for `/admin*`
- **THEN** `/mcp`, `/authorize`, and `/oauth/*` remain reachable through the Worker's own OAuth provider, unaffected by the Access gate

### Requirement: Member onboarding mints an invite without a public log

The admin surface SHALL onboard a member entirely within the Worker, writing the allowlist entry (`tenant:<id>`) and an invite mapping (`invite:<code> → <id>`) to `TENANT_KV` through the Worker's own binding, with the username canonicalized to lowercase. When no invite code is supplied, the Worker SHALL generate a random one. The response SHALL surface the invite code and the connector URL **once** to the authenticated operator, and the Worker SHALL NOT write the invite code to any log, run summary, or other externally-readable sink. The connector URL SHALL be derived from the request's own origin (`<origin>/mcp`).

#### Scenario: Onboard creates the allowlist entry and invite

- **WHEN** the operator onboards `Casey` (no code supplied)
- **THEN** the Worker writes `tenant:casey` and `invite:<generated> → casey` to `TENANT_KV`, and returns the generated code plus `<origin>/mcp` to the operator

#### Scenario: Invite code is shown once, never logged

- **WHEN** an onboard response returns an invite code
- **THEN** the code appears only in that authenticated response and in no log line, run summary, or other externally-readable output

#### Scenario: Username is canonicalized

- **WHEN** the operator onboards a mixed-case username such as `Casey`
- **THEN** the allowlist key, the stored record id, and the invite target are all the canonical lowercase form (`casey`)

### Requirement: Member revocation fully purges tenant state

The admin surface SHALL revoke a member within the Worker by removing their allowlist entry (`tenant:<id>`), deleting every invite mapping that resolves to that member (located by scanning `invite:*`, so no code need be supplied), deleting the member's per-tenant Kroger refresh token (`kroger:refresh:<id>`), and purging the member's per-tenant D1 rows — every tenant-scoped table and their attributed `recipe_notes` / `store_notes` — through `src/db.ts`. After revocation the member's previously-issued access token SHALL no longer resolve to a tenant, even though the token may still exist in the OAuth store. The shared recipe corpus SHALL NOT be deleted (recipes are not tenant-owned).

#### Scenario: Revoke removes the allowlist entry and all invites

- **WHEN** the operator revokes `casey`
- **THEN** `tenant:casey` is deleted and every `invite:*` whose value is `casey` is deleted, with no invite code supplied by the operator

#### Scenario: Revoke purges per-tenant D1 and the Kroger token

- **WHEN** the operator revokes `casey`
- **THEN** every per-tenant D1 table is cleared of `casey`'s rows, `casey`'s attributed notes are removed, and `kroger:refresh:casey` is deleted

#### Scenario: A revoked token stops resolving

- **WHEN** a request arrives carrying `casey`'s previously-issued access token after revocation
- **THEN** tenant resolution fails (the allowlist entry is gone) and no tool runs, even though the token still exists in the OAuth store

### Requirement: Invite rotation

The admin surface SHALL rotate a member's invite code: mint a new `invite:<new> → <id>` mapping and delete the member's prior invite mapping(s), without otherwise altering the member's allowlist entry or per-tenant data. The new code SHALL be surfaced once to the operator under the same no-log guarantee as onboarding.

#### Scenario: Rotate replaces the code and invalidates the old one

- **WHEN** the operator rotates `casey`'s invite
- **THEN** a new invite mapping is created, every prior `invite:* → casey` mapping is deleted, and the old code no longer authorizes; `casey`'s allowlist entry and per-tenant data are unchanged

### Requirement: Tenant listing is operational-only

The admin surface SHALL list the current members from the tenant directory (the `tenant:*` allowlist), returning canonical ids and operational status only. The listing SHALL NOT return per-tenant domain data (pantry, preferences, recipes, notes).

#### Scenario: Listing returns ids without domain data

- **WHEN** the operator opens the admin panel
- **THEN** it shows the allowlisted member ids (and at most operational metadata), and no member's pantry/preference/recipe content

### Requirement: Admin UI served as same-origin static assets

The admin UI SHALL be a static single-page application served by the Worker from the **same origin** as `/admin/api/*`, so the browser calls the admin API without any cross-origin request and the deployment needs no CORS configuration. The UI SHALL be built from source by a deterministic build script (supporting a `--check` validate-only mode) into a committed output directory, and served via the Worker's static-assets binding; the generated bundle SHALL NOT be hand-edited. The static-assets binding SHALL be carried through the operator config merge so it reaches every operator's deployment.

#### Scenario: UI and API share an origin (no CORS)

- **WHEN** the admin SPA calls `/admin/api/*`
- **THEN** the call is same-origin and succeeds with no CORS preflight or `Access-Control-*` configuration

#### Scenario: Bundle is built from source, not hand-edited

- **WHEN** the admin UI changes
- **THEN** the change is made in the UI source and the bundle is rebuilt by the build script (verifiable with `--check`), and the committed bundle is not edited by hand

#### Scenario: The assets binding survives the operator config merge

- **WHEN** the deploy merges the code-level config into an operator's config
- **THEN** the static-assets binding is present in the deployed config (it is on the merge allowlist) and the admin UI is served

