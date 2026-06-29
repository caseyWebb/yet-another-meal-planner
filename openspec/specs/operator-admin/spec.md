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

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin SPA SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Dev** area (the tool console and future developer surfaces), a **Logs** area (operator-auditable activity logs, organized by a left submenu of log sources; see "Logs area with a left submenu and a detail dialog"), a **Config** area (operator-editable configuration, organized into routed sub-views — the discovery calibration console and the shared-corpus editors; see "Config area hosts the calibration console and the shared-corpus editors"), and a **Data** area (the read-only data explorer over D1 and the R2 corpus — see the operator-data-explorer capability) — navigable by client-side routing so each surface has its own URL and a new surface is added as its own routed module rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at its own route (`/admin/members`), the tool console under `/admin/dev`, the logs under `/admin/logs` (with the selected log source as a sub-route, e.g. `/admin/logs/discovery`), configuration under `/admin/config` (with the selected config sub-view as a sub-route, e.g. `/admin/config/feeds`), and the data explorer under `/admin/data/*`, not at the panel root. Navigating between surfaces SHALL update the browser URL, and a deep link or refresh to a surface's URL SHALL load that surface directly.

#### Scenario: Navigation updates the URL

- **WHEN** the operator switches from one area to another (e.g. from Status to member management, to the tool console, to the logs, or to config)
- **THEN** the browser URL changes to that surface's route and the surface renders, without a full-page server reload

#### Scenario: Home route shows the Status view

- **WHEN** the operator opens `/admin` (or `/`)
- **THEN** the Status (background-job health) view renders as the home surface, not member management

#### Scenario: Member management has its own route

- **WHEN** the operator opens `/admin/members` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the member-management surface

#### Scenario: Deep link to a tool

- **WHEN** the operator opens `/admin/dev/tools/<tool>` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to that tool's view

#### Scenario: Deep link to a log

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Logs area with the Discovery log selected

#### Scenario: Deep link to config

- **WHEN** the operator opens `/admin/config` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Config area with the calibration console selected

#### Scenario: Deep link to a config sub-view

- **WHEN** the operator opens a config editor route such as `/admin/config/feeds` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Config area with that shared-corpus editor selected

#### Scenario: Deep link to a data view

- **WHEN** the operator opens a data-explorer route such as `/admin/data/recipes/<slug>` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to that data view

### Requirement: Status homepage surfaces service health

The admin panel SHALL present the aggregate `/health` state as its **home** view (the `/admin` route), by fetching the Worker's open `/health` endpoint from the same origin and rendering its payload: an overall healthy/degraded headline derived from the payload's `ok`; one row per registered job showing the job's name, its **healthy / failing / never-run** state, and the relative age of its last run, plus the job's operational `summary` detail; the D1 reachability row; and the **admin gate posture** (the payload's `admin` section). The view SHALL render a **never-run** job (no record yet) as visually distinct from both a healthy and a failing one.

The admin posture SHALL be rendered as a single derived gate state — **exposed / gated / dev / disabled** — computed from the section's booleans with the same precedence the Worker badge uses (`exposed` over `access_configured` over `dev_bypass_set` over otherwise), with the `email_allowlist` boolean shown as a defense-in-depth sub-detail of the gated state. An **`exposed`** gate (the panel's own Access surface could admit a tokenless request) SHALL be rendered as a prominent warning, consistent with the degraded overall headline.

Because `/health` returns HTTP `503` when a job is failing, the D1 probe fails, or the admin gate is `exposed` — a response that still carries the full JSON payload — the panel SHALL decode the response body on a `503` exactly as on a `200`, and SHALL treat a decoded degraded payload as a **successful read** (rendering the degraded state from the payload's `ok`), NOT as a load failure. Load-failure handling SHALL be reserved for a genuine transport error (network failure, timeout) or a body that does not decode as a health payload (e.g. a `403` from an expired Access session). The view's healthy-vs-degraded distinction SHALL derive from the payload's `ok`, not from the HTTP status code.

The home view SHALL NOT introduce any per-tenant data beyond what the tenant-data-free `/health` payload already contains, and SHALL add no Worker-side route or secret (it consumes the existing open endpoint).

#### Scenario: Healthy payload renders the status home view

- **WHEN** the operator opens `/admin` and `/health` responds `200` with every job `ok`, the D1 probe succeeding, and the admin gate configured
- **THEN** the home view shows a healthy headline, one row per registered job (state and last-run age), the D1 row, and the admin gate posture in its **gated** state

#### Scenario: Degraded 503 payload is rendered, not dropped

- **WHEN** `/health` responds `503` (a job is failing) carrying its JSON payload
- **THEN** the panel decodes that body and renders the degraded headline and the failing job's row, rather than showing a generic load error

#### Scenario: An exposed admin gate is a prominent warning

- **WHEN** `/health` responds `503` with `admin.exposed` true (the panel's own Access gate could admit a tokenless request)
- **THEN** the home view decodes the body, renders the gate posture as a prominent **exposed** warning, and shows the degraded overall headline — not a generic load error

#### Scenario: A never-run job is visually distinct

- **WHEN** a registered job has never run (its `/health` row is reported as not-yet-run)
- **THEN** that job's row renders in a distinct not-yet-run state, neither healthy nor failing

#### Scenario: A transport failure shows a load error, not a degraded payload

- **WHEN** the `/health` fetch fails at the network layer or returns a body that does not decode as a health payload (e.g. a `403` when the Access session has expired)
- **THEN** the home view shows a load-failure state, distinct from a successfully-read degraded payload

### Requirement: The tool console seeds arguments with a schema-derived example and tolerates comments

When a tool is selected, the console SHALL pre-fill its argument input with an editable example **generated structurally from the tool's input JSON Schema** — not from any hand-maintained per-tool text — so that a newly registered tool gets a useful example with no console-specific code. In the example, every **required** field SHALL be present with a type-appropriate placeholder value, and every **optional** field SHALL be present but **commented out**; the example SHALL be pretty-printed (indented, one field per line). An `enum` field SHALL use its first allowed value and list the alternatives in a comment; a field with a schema `default` SHALL use that default; a nullable field SHALL be shown as its underlying type's example; a no-field tool SHALL yield `{}`.

Because the example uses comments, the argument input SHALL accept JSON containing `//` line comments, `/* */` block comments, and trailing commas: the console SHALL strip these before submitting, **preserving** any such sequence that occurs inside a string value. Stripping SHALL be a client-side input convenience only — it SHALL NOT bypass or alter the server-side input validation, which remains the sole validator of the submitted arguments.

The generated example SHALL be valid after stripping: submitting it unmodified SHALL parse to the schema's required-only object (every optional field omitted because commented out).

#### Scenario: Selecting a tool seeds a schema-derived example

- **WHEN** the operator selects a tool whose catalog entry is loaded
- **THEN** the argument input is pre-filled with a pretty-printed JSON example derived from that tool's input schema, with required fields present and optional fields commented out, rather than a bare `{}`

#### Scenario: Enum and optional fields are rendered for discoverability

- **WHEN** the seeded example includes an `enum` field and one or more optional fields
- **THEN** the enum field shows a first allowed value with the alternatives listed in a comment, and each optional field appears commented out so the operator can uncomment the ones to send

#### Scenario: The seeded example submits unmodified

- **WHEN** the operator runs a tool without editing the seeded example
- **THEN** the console strips the comments and submits the underlying JSON, which is the schema's required-only object (optional fields omitted)

#### Scenario: Comments and trailing commas are tolerated on submit

- **WHEN** the operator submits arguments containing `//` or `/* */` comments or trailing commas
- **THEN** the console strips them and submits the underlying JSON, while leaving intact any `//` or `/*` that appears inside a string value

#### Scenario: A tool with no input fields stays empty

- **WHEN** the operator selects a tool whose input schema declares no fields
- **THEN** the seeded example is `{}`

#### Scenario: Editing replaces the seeded example until the tool changes

- **WHEN** the operator edits the argument input and then selects a different tool
- **THEN** their edited text is preserved while that tool stays selected, and selecting another tool reseeds the input from the newly selected tool's schema

### Requirement: Logs area with a left submenu and a detail dialog

The admin SPA SHALL provide a top-level **Logs** area (a fourth area beside Status, Members, and Dev) for operator-auditable activity logs. The Logs area SHALL render a **left submenu** of log sources and, on the right, the entries for the selected source — the master/detail layout of the MCP-inspector tool console. Its first (and initially only) submenu item SHALL be **Discovery**, showing the background discovery sweep's per-candidate outcome log. The area SHALL be **extensible by adding a submenu item**, not by restructuring — a future log source becomes another entry in the left submenu. The Logs area and its submenu selection SHALL be client-routed (`/admin/logs` for the area, `/admin/logs/discovery` for the Discovery log) so a deep link or refresh loads the selected log directly. When an individual entry carries more than a row's worth of detail, the entry SHALL be expandable into a **dialog** showing its full detail (rather than inlining every field into the list).

The Discovery log view SHALL provide, for each retryable parked entry (outcome `error` or `failed`), a per-row **Retry now** action that invokes the single-row retry endpoint (`POST /admin/api/discovery/:id/retry`, see the retry/delete requirement) and a per-row **Delete** action that invokes the delete endpoint (`DELETE /admin/api/discovery/:id`). On a successful Retry or Delete the view SHALL reload the log so the resolved (or removed) row is reflected immediately. Each action SHALL be one-at-a-time (the affected row's action is disabled while its request is in flight). The view SHALL NOT offer the removed bulk re-probe action.

The Logs surfaces SHALL be modeled per the panel's data-modeling standard: the loaded entries SHALL be `RemoteData` (the four-state load), the selected submenu item SHALL be a custom type (not a stringly-typed route), and the open-dialog state SHALL be modeled so "a dialog is open for entry X" cannot contradict the loaded list. The per-row action's in-flight state — which row is acting, which action, and its failure — SHALL be one custom type (never a `Bool` busy flag beside a `Maybe` error), distinct from the log's load state.

#### Scenario: Logs area shows the Discovery submenu and its entries

- **WHEN** the operator opens the Logs area
- **THEN** the left submenu lists **Discovery**, and selecting it shows the discovery sweep's log entries on the right

#### Scenario: A log source is reachable by deep link

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Logs area with the Discovery log selected

#### Scenario: Entry detail opens in a dialog

- **WHEN** the operator activates a discovery log entry that has expandable detail (e.g. an import's attribution, or a parked error's validation failure)
- **THEN** the app opens a dialog showing that entry's full detail and the list stays intact behind it

#### Scenario: A new log source is added as a submenu item

- **WHEN** a future log source is introduced
- **THEN** it appears as an additional left-submenu item under Logs without restructuring the area

#### Scenario: Operator retries a parked row from the Discovery log

- **WHEN** the operator activates **Retry now** on a parked `error`/`failed` row
- **THEN** the app POSTs `/admin/api/discovery/:id/retry`, and on success reloads the log so the row's resolved outcome (e.g. `imported`, or a fresh failure with an advanced retry schedule) appears

#### Scenario: Operator deletes a discovery from the log

- **WHEN** the operator activates **Delete** on a discovery row
- **THEN** the app sends `DELETE /admin/api/discovery/:id`, and on success reloads the log with that row gone

#### Scenario: A per-row action is one-at-a-time

- **WHEN** a row's Retry or Delete request is already in flight
- **THEN** that row's actions are disabled so a second overlapping request for the row cannot be started

### Requirement: Discovery log is served cross-tenant under Access

The admin surface SHALL expose a read endpoint (e.g. `GET /admin/api/logs/discovery`) returning the background discovery sweep's per-candidate outcome log — each entry's timestamp, source URL and title, discovery source, outcome (imported / skipped-duplicate / skipped-no-match / skipped-rejected-source / dietary-gated / parked-error), and outcome-specific detail (import slug + matched-member attribution, the matched corpus recipe for a duplicate, the validation failure for a parked error). The endpoint SHALL read the sweep's log (see the `discovery-sweep` capability) and SHALL present the group-wide log (the operator sees every member's attributions — the same cross-tenant operator reach the rest of `/admin` has). It SHALL be gated by Cloudflare Access exactly like the rest of `/admin*`, including the opt-in rule: when the Access configuration is unset, the endpoint SHALL respond `404`. The endpoint SHALL bound the number of entries returned (most-recent-first) so the response stays manageable.

#### Scenario: Operator reads the discovery log

- **WHEN** an Access-authenticated operator opens the Discovery log
- **THEN** `GET /admin/api/logs/discovery` returns the recent sweep outcomes (imports with attribution, skips with reasons, parked errors), most-recent-first

#### Scenario: Discovery log is disabled when the admin surface is

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** `GET /admin/api/logs/discovery` responds `404`, exposing no log

#### Scenario: Log read is bounded

- **WHEN** the discovery log contains more entries than the response cap
- **THEN** the endpoint returns the most recent entries up to the cap, not the entire history

### Requirement: Config area hosts the calibration console and the shared-corpus editors

The admin SPA SHALL provide a top-level **Config** area (routed at `/admin/config`) organized into routed sub-views reached by a sub-navigation, whose **default** sub-view (the bare `/admin/config`) is the discovery calibration console and whose other sub-views are the shared-corpus editors (see "Operator edits shared-corpus tables under Config"). Each sub-view SHALL have its own sub-route so it deep-links (e.g. `/admin/config`, `/admin/config/feeds`), and selecting a sub-view SHALL update the browser URL without a full-page reload.

The discovery calibration console SHALL host the sweep's tunable knobs (τ, triage threshold, δ, classify cap, rate cap) as a form, an **Analyze** action and a **Dry-run** action, and a results panel — laid out so the projected effect of the current knob values is visible on the **same screen** before the operator saves. Editing a knob and running Analyze/Dry-run SHALL NOT persist anything; only an explicit Save writes the config. The form SHALL show the projected effect (the Analyze/Dry-run results) before Save, and a value past a hard floor SHALL require an explicit confirmation step in the UI (mirroring the server-side guard). The surfaces SHALL be modeled per `admin/CLAUDE.md`: the loaded config and the Analyze/Dry-run results as `RemoteData`, and a dirty-vs-saved form state as a custom type (so "unsaved edits" cannot be confused with "saved").

#### Scenario: Operator previews then saves a knob change

- **WHEN** the operator opens `/admin/config`, changes τ, and runs Analyze
- **THEN** the projected per-member match counts render without persisting anything, and the new τ is stored only when the operator explicitly Saves

#### Scenario: A floor-breaching value requires confirmation in the UI

- **WHEN** the operator drags τ below the hard floor and tries to Save
- **THEN** the console requires an explicit confirmation before sending the write

#### Scenario: Config area deep-links to the calibration console

- **WHEN** the operator opens `/admin/config` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Config area with the calibration console as the default sub-view

#### Scenario: Config sub-views are reachable by sub-navigation

- **WHEN** the operator opens the Config area and selects a shared-corpus editor from the sub-navigation
- **THEN** the browser URL changes to that editor's sub-route and the editor renders, the calibration console being one selectable sub-view among them

### Requirement: Operator edits shared-corpus tables under Config

The Config area SHALL provide an operator editor for each of the five shared-corpus lookup tables — ingredient **aliases** (`variant → canonical`), **flyer terms**, discovery **feeds** (RSS/Atom sources), and the discovery allowlist's newsletter **senders** and member **addresses** — each as its own routed sub-view that **lists** the table's current rows, **adds** a row, and **removes** a row by its primary key. These are group-wide (tenant-free) shared config, and the editor SHALL present and write the group-wide table (the same cross-tenant operator reach the rest of `/admin` has).

Removal SHALL be **operator-only**: it SHALL NOT be exposed as an MCP tool, so the agent can add (via the existing add tools) but only the operator prunes. Adding through the editor SHALL match the existing write semantics — `aliases` is an upsert keyed by `variant` (re-adding a variant overwrites its canonical), and `flyer_terms`, `feeds`, `senders`, and `members` are insert-or-ignore (add-only dedup) — so the operator's add path and the agent's add path converge on the same row. A removal SHALL be idempotent: removing an absent key SHALL succeed (reporting that nothing was removed) rather than erroring.

The editor surfaces SHALL be modeled per `admin/CLAUDE.md`: the loaded rows SHALL be `RemoteData` (the four-state load), and the in-flight add/remove mutation together with its failure SHALL be a single custom type carrying which operation is in flight (so "an add is running", "a remove of row X is running", and "the last mutation failed, with its error" cannot contradict, and one mutation at a time is structural) — never a `Bool` busy flag beside a `Maybe String` error. After a successful add or remove the editor SHALL refetch the list rather than locally patching it, so the displayed rows are always the authoritative server state.

#### Scenario: Operator lists, adds, and removes a feed

- **WHEN** the operator opens `/admin/config/feeds`, adds a feed URL, then removes an existing feed
- **THEN** the editor lists the current feeds, the added feed appears after the write, and the removed feed is gone — each change reflected by refetching the group-wide `feeds` table

#### Scenario: Adding an existing alias overwrites its canonical

- **WHEN** the operator adds an alias whose `variant` already exists with a different `canonical`
- **THEN** the row's canonical is updated to the new value (upsert), not duplicated

#### Scenario: Removing an address is operator-only and normalized

- **WHEN** the operator removes a discovery sender or member address that was stored normalized (trimmed, lowercased)
- **THEN** the matching row is removed regardless of the key's surrounding whitespace or letter case, and no MCP tool exposes this removal to the agent

#### Scenario: Removing an absent row is idempotent

- **WHEN** the operator removes a key that is not present
- **THEN** the operation succeeds and reports that no row was removed, rather than returning an error

### Requirement: Shared-corpus editor endpoints served cross-tenant under Access

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured), a writable corpus namespace `/admin/api/corpus/<table>` where `<table>` is one of a fixed set (`aliases`, `flyer-terms`, `feeds`, `senders`, `members`): `GET /admin/api/corpus/<table>` lists the table's rows, `POST /admin/api/corpus/<table>` adds one validated row, and `DELETE /admin/api/corpus/<table>/<key>` removes the row with that primary key. An unknown `<table>` SHALL be a not-found error and an unsupported method SHALL be rejected (`405`). These are operator/cross-tenant operations writing group-wide config and SHALL NOT be exposed as MCP tools. They SHALL be distinct from the read-only `/admin/api/data/*` explorer namespace, which remains read-only.

The `POST` SHALL validate per table server-side and write nothing on a bad input: a non-empty primary key always; `aliases` a non-empty `canonical`; `feeds` a URL with a numeric `weight` (defaulting when absent) and `tags` as a string array; `senders`/`members` an address that is normalized (trimmed, lowercased) before storage. The `DELETE` SHALL normalize an address key the same way before matching, so a delete always targets the row an add produced. All writes SHALL go through the Worker's structured storage layer (returning structured errors, not throwing).

#### Scenario: Corpus endpoints are reachable only under Access

- **WHEN** Access is configured and an authenticated operator calls `GET /admin/api/corpus/feeds`
- **THEN** the feed rows are returned; and when Access is unconfigured every `/admin/api/corpus/*` route responds `404` like the rest of `/admin*`

#### Scenario: An invalid add is rejected without a write

- **WHEN** `POST /admin/api/corpus/aliases` sends a row missing its `canonical` (or an empty `variant`)
- **THEN** the endpoint returns a structured validation error and writes nothing

#### Scenario: An unknown table or method is rejected

- **WHEN** a request targets `/admin/api/corpus/<unknown>` or uses an unsupported method on a valid table
- **THEN** the endpoint responds with a not-found error for the unknown table and `405` for the unsupported method, writing nothing

#### Scenario: Delete removes by primary key

- **WHEN** `DELETE /admin/api/corpus/flyer-terms/<term>` targets an existing term
- **THEN** that term's row is removed and the response reports the removal; a key that is absent reports no removal rather than erroring

### Requirement: Discovery calibration endpoints served cross-tenant under Access

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured): `GET /admin/api/discovery/config` (the current merged knobs), `PUT /admin/api/discovery/config` (write the operator overrides, with the footgun-floor guard and range validation enforced server-side), `POST /admin/api/discovery/analyze` (the cheap no-AI δ/τ analysis at given knob values), and `POST /admin/api/discovery/dry-run` (the no-write full-pipeline preview). These are operator/cross-tenant operations (they read all members to set a global knob) and SHALL NOT be exposed as MCP tools.

#### Scenario: Analyze and dry-run are reachable only under Access

- **WHEN** Access is configured and an authenticated operator calls `POST /admin/api/discovery/analyze`
- **THEN** the analysis is returned; and when Access is unconfigured the endpoint responds `404` like the rest of `/admin*`

#### Scenario: A config write past a floor is rejected without confirm

- **WHEN** `PUT /admin/api/discovery/config` sends a below-floor τ without the explicit-confirm flag
- **THEN** the endpoint returns a structured error and writes nothing

### Requirement: Operator probes a discovery feed from the edge

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured), an operator-only edge feed-probe `POST /admin/api/discovery/test-feed { url }` that runs **from the Worker's egress** and reports whether a feed URL is a viable discovery source. The probe SHALL fetch the feed URL with the same browser-headered fetch the sweep uses, report the fetch status and whether the body parses as RSS/Atom and how many items it yields, and then run the sweep's recipe-acquisition path against a bounded sample of the feed's entry pages — reporting **each sampled page's specific outcome** from the same taxonomy the sweep parks with (`ok` / `unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete`). The probe SHALL reuse the exact acquisition logic the sweep uses (a shared helper, not a re-implementation) so its verdict matches what the sweep would actually do. The probe SHALL write nothing — it neither imports a recipe nor mutates the feed set. It is an operator/cross-tenant operation and SHALL NOT be exposed as an MCP tool; an unsupported method SHALL be rejected (`405`).

The Config › Feeds editor SHALL offer a **test action** — on each listed feed row and on the add form's drafted URL — that calls the probe endpoint and renders its verdict (feed reachable and item count; how many sampled entry pages parsed versus were walled or were not recipes). The test action's in-flight state and its result/failure SHALL be modeled per `admin/CLAUDE.md` (a single state type carrying which row is being tested and its outcome — never a `Bool` busy flag beside a `Maybe String`), and a test SHALL be read-only: it SHALL NOT add, remove, or refetch the feed rows.

#### Scenario: Probe reports the feed and a sample of its entry pages

- **WHEN** the operator triggers a test on a feed whose XML fetches and parses but whose entry pages are all bot-walled
- **THEN** the probe reports the feed as reachable with its item count, and the sampled entry pages as `unreachable`, so the operator sees the feed is not actually a viable source

#### Scenario: Probe distinguishes a non-recipe feed from a walled one

- **WHEN** the operator tests a feed whose entries are roundup/article pages (fetch 200, no schema.org `Recipe`)
- **THEN** the sampled pages report `not_a_recipe` (not `unreachable`), distinguishing an off-base source from a walled one

#### Scenario: Probe is Access-gated and writes nothing

- **WHEN** Access is configured and the operator calls `POST /admin/api/discovery/test-feed`
- **THEN** the verdict is returned and no feed row or recipe is written; and when Access is unconfigured the route responds `404` like the rest of `/admin*`

#### Scenario: The test action does not mutate the feed list

- **WHEN** the operator tests a drafted or existing feed URL in the Feeds editor
- **THEN** the verdict renders without adding, removing, or refetching the feed rows

### Requirement: Operator retries or deletes a parked discovery row

The admin surface SHALL expose two operator-only, single-row discovery-log mutations, each gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured) and neither exposed as an MCP tool. An unsupported method on either route SHALL be rejected (`405`).

**Retry** — `POST /admin/api/discovery/:id/retry` SHALL re-run the discovery pipeline for a single parked row immediately, bypassing the backoff schedule and the attempt cap (an operator override), and SHALL resolve that row in place to its real outcome (importing on a match, exactly as the sweep would). It SHALL be permitted only for a retryable outcome (`error` or `failed`); on any other outcome it SHALL return a structured error and change nothing. It SHALL reuse the sweep's acquisition/classification/match path (shared logic, not a re-implementation) so its result matches what the autonomous sweep would do.

**Delete** — `DELETE /admin/api/discovery/:id` SHALL permanently suppress a discovery: it SHALL add the row's canonical URL to the group-wide `discovery_rejections` set (the same per-URL suppression the sweep's intake dedup already honors) and SHALL remove the log row. A deleted discovery SHALL therefore never be reconsidered — not by fresh intake nor by the retry stream. The operation SHALL be idempotent (a missing id is a success no-op).

#### Scenario: Manual retry imports a recovered park

- **WHEN** the operator activates Retry on a parked `unreachable` row whose page now parses and matches a member
- **THEN** the endpoint runs the pipeline once, imports the recipe, and resolves the row to `imported` — without waiting for the backoff schedule

#### Scenario: Manual retry overrides an exhausted attempt cap

- **WHEN** the operator activates Retry on a row that has already exhausted its automatic retry attempts
- **THEN** the endpoint still runs the pipeline once (the operator override) and resolves the row by its outcome

#### Scenario: Retry is rejected for a non-retryable outcome

- **WHEN** the operator attempts Retry on a row whose outcome is not `error`/`failed` (e.g. `imported` or `no_match`)
- **THEN** the endpoint returns a structured error and changes nothing

#### Scenario: Delete rejects the URL and removes the row

- **WHEN** the operator activates Delete on a discovery row
- **THEN** the row's canonical URL is added to `discovery_rejections`, the log row is removed, and the sweep never re-admits that URL via fresh intake or the retry stream

#### Scenario: Both routes are Access-gated

- **WHEN** Access is unconfigured
- **THEN** `POST /admin/api/discovery/:id/retry` and `DELETE /admin/api/discovery/:id` each respond `404`, exposing and mutating nothing

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

