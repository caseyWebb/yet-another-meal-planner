# operator-admin Specification

## Purpose
TBD - created by archiving change operator-admin-panel. Update Purpose after archive.
## Requirements
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

The SPA SHALL be **client-routed** (a `Browser.application`): it owns multiple in-app routes under `/admin/*`. Because `/admin*` is routed worker-first, the Worker SHALL serve the SPA shell (the app's `index.html`) for any `/admin/*` GET that is neither an `/admin/api/*` route nor a real static asset, so in-app routes deep-link and survive a refresh. The Worker SHALL serve that shell by fetching it from the assets binding (not by redirecting to `/admin/index.html`), so it does not re-enter the worker-first route and loop.

#### Scenario: UI and API share an origin (no CORS)

- **WHEN** the admin SPA calls `/admin/api/*`
- **THEN** the call is same-origin and succeeds with no CORS preflight or `Access-Control-*` configuration

#### Scenario: Bundle is built from source, not hand-edited

- **WHEN** the admin UI changes
- **THEN** the change is made in the UI source and the bundle is rebuilt by the build script (verifiable with `--check`), and the committed bundle is not edited by hand

#### Scenario: The assets binding survives the operator config merge

- **WHEN** the deploy merges the code-level config into an operator's config
- **THEN** the static-assets binding is present in the deployed config (it is on the merge allowlist) and the admin UI is served

#### Scenario: Client routes are served the SPA shell

- **WHEN** a GET arrives for an `/admin/*` path that is not an `/admin/api/*` route and not a built static asset (e.g. `/admin/dev/tools/place_order`)
- **THEN** the Worker serves the SPA shell from the assets binding (without redirect-looping), and the app resolves the route client-side

### Requirement: Operator tool console lists the live MCP tool surface

The admin surface SHALL expose `GET /admin/api/tools` returning the live MCP tool catalog — each tool's name, description, and input JSON Schema — derived from the **same** `tools/list` a real MCP client receives, by building the per-tenant tool server and enumerating it (not from a hand-maintained list). The catalog SHALL therefore reflect any tool the MCP surface registers, with no console-specific per-tool code. The endpoint SHALL require an `acting-as` tenant (query parameter), resolved against the allowlist by the same check tool invocation uses; the catalog *content* is tenant-independent, but resolving the tenant keeps listing and invoking uniformly gated.

#### Scenario: Catalog mirrors the MCP tool surface

- **WHEN** the operator opens the tool console acting as an allowlisted member
- **THEN** `GET /admin/api/tools` returns every tool the MCP server registers for that tenant, each with its description and input schema, matching what `/mcp`'s `tools/list` would return

#### Scenario: A newly registered tool appears without console changes

- **WHEN** a new tool is added to `buildServer` and the Worker is redeployed
- **THEN** the tool appears in the console catalog with no change to the admin API or the SPA

#### Scenario: Listing requires a resolvable tenant

- **WHEN** `GET /admin/api/tools` is called with a missing or non-allowlisted `acting-as` tenant
- **THEN** the surface returns a structured error and no catalog, the same resolution outcome as tool invocation

### Requirement: Operator tool console invokes a tool as a chosen tenant

The admin surface SHALL expose `POST /admin/api/tools/<name>` accepting `{ tenant, arguments }`, which invokes the named tool **as that tenant** by building `buildServer(env, tenant)` and driving it over an in-memory MCP transport, and SHALL return the tool's structured result or structured error **verbatim** — the same value a real MCP client would receive for the same tenant and arguments. A tool that returns a structured error (e.g. `not_found`, `validation_failed`, `unavailable`) SHALL be surfaced as that structured result, NOT as an HTTP 500. The console SHALL NOT bypass the tool's input validation, expose any tool the MCP surface does not, or alter the tool's behavior.

#### Scenario: Successful invocation returns the tool's structured result

- **WHEN** the operator runs a tool with valid arguments as a chosen tenant
- **THEN** the surface builds the tenant's MCP server, invokes the tool over the in-memory transport, and returns the tool's structured result unchanged

#### Scenario: A tool's structured error is returned as data, not a crash

- **WHEN** an invoked tool returns a structured error (e.g. the tenant has no preferred store, or a slug is unknown)
- **THEN** the surface returns that structured error to the console for display, not an unhandled 500

#### Scenario: Invalid arguments are rejected by the tool's own schema

- **WHEN** the operator runs a tool with arguments that violate its input schema
- **THEN** invocation is rejected by the same validation the MCP surface applies, and the validation error is returned to the console — the console does not pre-filter or bypass it

#### Scenario: Unknown tool name

- **WHEN** the operator POSTs to `/admin/api/tools/<name>` for a name the server does not register
- **THEN** the surface returns a structured `not_found`-class error and invokes nothing

### Requirement: Tool invocation identity is operator-driven under Access

The tool console SHALL determine the acting tenant from the operator's request (the chosen id), resolved against the allowlist by the same `resolveTenant` check the MCP surface uses — NOT from an MCP OAuth token. The operator MAY act as any allowlisted member. These endpoints SHALL remain gated by Cloudflare Access exactly like the rest of `/admin*`, including the opt-in rule: when the Access configuration is unset the tool-console endpoints SHALL respond `404` along with the rest of the admin surface. A request whose `acting-as` tenant is absent from the allowlist SHALL be rejected and SHALL invoke no tool.

#### Scenario: Operator acts as a chosen member

- **WHEN** an Access-authenticated operator selects member `casey` and runs a tool
- **THEN** the tool runs with `casey`'s tenant context (the same `Tenant` `/mcp` would build for `casey`), without any MCP OAuth token

#### Scenario: Tool console is disabled when the admin surface is

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** `GET /admin/api/tools` and `POST /admin/api/tools/<name>` respond `404`, exposing no catalog and running no tool

#### Scenario: Acting as a non-member is rejected

- **WHEN** a tool invocation names an `acting-as` tenant that is not on the allowlist
- **THEN** the surface returns an `unauthorized`/`not_found`-class error and invokes no tool

### Requirement: The dev workbench shows and guards the acting persona

The tool console SHALL make the acting persona visible whenever a tool can be invoked (a persistent "acting as `<member>`" indicator), and SHALL NOT allow a tool to be invoked while no persona is selected. Before invoking a tool as a **real member**, the console SHALL require an explicit confirmation; a persona designated for testing (by the `test-`/`sandbox-` naming convention) MAY bypass that confirmation. The selected persona is workbench-wide context that persists across dev surfaces, not a per-invocation field.

#### Scenario: No persona means no invocation

- **WHEN** the operator is on the tool console with no persona selected
- **THEN** tool invocation is unavailable until a persona is chosen

#### Scenario: The acting persona is always visible

- **WHEN** a persona is selected and a tool is runnable
- **THEN** the console continuously displays which member it is acting as

#### Scenario: Confirm before acting as a real member

- **WHEN** the operator runs a tool while acting as a real member (not a `test-`/`sandbox-` persona)
- **THEN** the console requires an explicit confirmation before the invocation is sent

### Requirement: Admin panel is organized into Admin and Dev areas with client-side routing

The admin SPA SHALL organize its surfaces into a top-level **Admin** area (member management) and a top-level **Dev** area (the tool console and future developer surfaces), navigable by client-side routing so each surface has its own URL and a new surface is added as its own routed module rather than another card on a single page. Navigating between surfaces SHALL update the browser URL, and a deep link or refresh to a surface's URL SHALL load that surface directly.

#### Scenario: Navigation updates the URL

- **WHEN** the operator switches from member management to the tool console
- **THEN** the browser URL changes to the console's route and the console renders, without a full-page server reload

#### Scenario: Deep link to a tool

- **WHEN** the operator opens `/admin/dev/tools/<tool>` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to that tool's view

