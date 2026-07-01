# operator-admin Specification

## Purpose

The operator admin surface is a gated, Cloudflare-Access-protected panel serving the group-wide operator for background-job monitoring, member management, data exploration, and discovery/corpus tuning — a single server-rendered Hono app with typed RPC routes and client islands for live interactions.
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

The admin UI SHALL be served by the Worker from the **same origin** as its `/admin/api/*` operations, so the browser makes no cross-origin request and the deployment needs no CORS configuration. The UI SHALL be a **Hono application** that **server-renders** its pages (HTML produced in the Worker via Hono JSX) and **hydrates** its interactive surfaces as **islands** — client bundles that attach to server-rendered markup. Both the server-render and the island bundles SHALL be served same-origin: the HTML from the Worker (worker-first on `/admin*`), the island bundles and other static files from the Worker's static-assets binding.

The island bundles and any static files SHALL be built from source by a build script into the `admin/dist/` output directory — a **build artifact that is NOT committed** (it is gitignored), built fresh by CI and by the deploy (and for local `wrangler dev`) — served via the static-assets binding; the generated bundle SHALL NOT be hand-edited. The build SHALL NOT depend on a network package registry being reachable, so any sandbox can rebuild it. The static-assets binding SHALL be carried through the operator config merge so it reaches every operator's deployment.

Because `/admin*` is routed worker-first, the Worker SHALL produce each in-app route's page server-side (it owns the routes under `/admin/*`), so a deep link or refresh to any admin route loads that surface directly. A GET for an `/admin/*` path that is neither an `/admin/api/*` route nor a real static asset SHALL be handled by the Hono app's page router (rendering that route's page), not by a redirect — so it does not re-enter the worker-first route and loop.

#### Scenario: UI and API share an origin (no CORS)

- **WHEN** an admin island calls an `/admin/api/*` route (or a page is server-rendered)
- **THEN** the call is same-origin and succeeds with no CORS preflight or `Access-Control-*` configuration

#### Scenario: Bundle is built from source, not hand-edited

- **WHEN** the admin UI changes
- **THEN** the change is made in the TypeScript UI source and the island bundle is rebuilt by the build script, and `admin/dist/` is not edited by hand (it is a gitignored build artifact, rebuilt fresh by CI and the deploy)

#### Scenario: Bundle builds without a package registry

- **WHEN** the admin UI is built in a sandbox with no access to a language package registry
- **THEN** the build script still produces the committed bundle (the toolchain has no network-registry build dependency)

#### Scenario: The assets binding survives the operator config merge

- **WHEN** the deploy merges the code-level config into an operator's config
- **THEN** the static-assets binding is present in the deployed config (it is on the merge allowlist) and the admin UI is served

#### Scenario: Routes are served their page server-side

- **WHEN** a GET arrives for an `/admin/*` path that is not an `/admin/api/*` route and not a built static asset (e.g. `/admin/dev/tools/place_order`)
- **THEN** the Hono app renders that route's page (without redirect-looping), and the surface resolves directly

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin panel SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Data** area (the read-only data explorer over D1 and the R2 corpus — see the operator-data-explorer capability), a **Usage** area (the usage-observability dashboards), a **Discovery** area (the autonomous candidate-pipeline view), a **Logs** area (operator-auditable activity logs, organized by a left submenu of log sources), and a **Config** area (the discovery calibration console and the shared-corpus editors, as routed sub-views) — each with its own URL, so a new surface is added as its own routed page rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at `/admin/members`, the data explorer under `/admin/data/*`, the usage dashboards at `/admin/usage`, the discovery view at `/admin/discovery`, the logs under `/admin/logs` (with the selected source as a sub-route, e.g. `/admin/logs/discovery`), and configuration under `/admin/config` (with the selected sub-view as a sub-route, e.g. `/admin/config/feeds`), not at the panel root.

Each area's page SHALL be **server-rendered** for its URL, and its interactive controls SHALL be hydrated as islands. Navigating to a surface SHALL load that surface (server-rendered) at its own URL, and a deep link or refresh to a surface's URL SHALL load that surface directly. Within a hydrated surface, an interaction (e.g. opening a detail dialog, editing a config form) MAY update state client-side without a full navigation.

#### Scenario: Each surface has its own URL

- **WHEN** the operator opens a different area (e.g. Status, member management, the logs, or config)
- **THEN** the browser URL is that surface's route and the surface renders for that URL

#### Scenario: Home route shows the Status view

- **WHEN** the operator opens `/admin` (or `/`)
- **THEN** the Status (background-job health) view renders as the home surface, not member management

#### Scenario: Discovery is a top-level area

- **WHEN** the operator opens `/admin/discovery` directly (or refreshes there)
- **THEN** the Worker server-renders the Discovery area as its own top-level surface, reached from the area nav alongside Status, Members, Data, Usage, Logs, and Config

#### Scenario: Deep link to a log

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker server-renders the Logs area with the Discovery log selected

#### Scenario: Deep link to a config sub-view

- **WHEN** the operator opens a config editor route such as `/admin/config/feeds` directly (or refreshes there)
- **THEN** the Worker server-renders the Config area with that shared-corpus editor selected

#### Scenario: Deep link to a data view

- **WHEN** the operator opens a data-explorer route such as `/admin/data/recipes/<slug>` directly (or refreshes there)
- **THEN** the Worker server-renders that data view

### Requirement: Status homepage surfaces service health

The admin panel SHALL present the aggregate `/health` state in its **Status** home view (the `/admin` route) by rendering the health payload's detail: one row per registered job showing the job's name, its **healthy / failing / never-run** state, and the relative age of its last run, plus the job's operational `summary` detail; the D1 reachability row; and the **admin gate posture** (the payload's `admin` section). The overall **healthy/degraded rollup** is NOT owned by this view — it is surfaced by the global service-health indicator present on every area (see that requirement). The view SHALL render a **never-run** job (no record yet) as visually distinct from both a healthy and a failing one.

The admin posture SHALL be rendered as a single derived gate state — **exposed / gated / dev / disabled** — computed from the section's booleans with the same precedence the Worker badge uses (`exposed` over `access_configured` over `dev_bypass_set` over otherwise), with the `email_allowlist` boolean shown as a defense-in-depth sub-detail of the gated state. An **`exposed`** gate (the panel's own Access surface could admit a tokenless request) SHALL be rendered as a prominent warning.

Because `/health` returns HTTP `503` when a job is failing, the D1 probe fails, or the admin gate is `exposed` — a response that still carries the full JSON payload — the panel SHALL treat a decoded degraded payload as a **successful read** (rendering the degraded detail from the payload), NOT as a load failure. Load-failure handling SHALL be reserved for a genuine transport error or a body that does not decode as a health payload. The view's per-job and dependency states SHALL derive from the payload, not from any HTTP status code.

The Status view SHALL NOT introduce any per-tenant data beyond what the tenant-data-free `/health` payload already contains, and SHALL add no Worker-side route or secret (it consumes the existing health payload).

#### Scenario: Healthy payload renders the status detail

- **WHEN** the operator opens `/admin` and the health payload reports every job `ok`, the D1 probe succeeding, and the admin gate configured
- **THEN** the Status view shows one row per registered job (state and last-run age), the D1 row, and the admin gate posture in its **gated** state, while the global indicator carries the healthy rollup

#### Scenario: Degraded payload renders the failing detail, not dropped

- **WHEN** the health payload is degraded (a job is failing) and still carries its full detail
- **THEN** the Status view renders the failing job's row from that payload rather than showing a generic load error

#### Scenario: An exposed admin gate is a prominent warning

- **WHEN** the health payload reports `admin.exposed` true (the panel's own Access gate could admit a tokenless request)
- **THEN** the Status view renders the gate posture as a prominent **exposed** warning

#### Scenario: A never-run job is visually distinct

- **WHEN** a registered job has never run (its health row is reported as not-yet-run)
- **THEN** that job's row renders in a distinct not-yet-run state, neither healthy nor failing

#### Scenario: A transport failure shows a load error

- **WHEN** the health read fails at the transport layer or returns a body that does not decode as a health payload
- **THEN** the Status view shows a load-failure state, distinct from a successfully-read degraded payload

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

The `POST` SHALL validate per table server-side and write nothing on a bad input: a non-empty primary key always; `aliases` a non-empty `canonical`; `feeds` a **public `http`/`https` URL** (rejecting a non-http scheme, embedded credentials, or a private/loopback/link-local host — the same write-time guard `update_feeds` applies, since both write through one helper) with a numeric `weight` (defaulting when absent) and `tags` as a string array; `senders`/`members` an address that is normalized (trimmed, lowercased) before storage. The `DELETE` SHALL normalize an address key the same way before matching, so a delete always targets the row an add produced. All writes SHALL go through the Worker's structured storage layer (returning structured errors, not throwing).

#### Scenario: Corpus endpoints are reachable only under Access

- **WHEN** Access is configured and an authenticated operator calls `GET /admin/api/corpus/feeds`
- **THEN** the feed rows are returned; and when Access is unconfigured every `/admin/api/corpus/*` route responds `404` like the rest of `/admin*`

#### Scenario: An invalid add is rejected without a write

- **WHEN** `POST /admin/api/corpus/aliases` sends a row missing its `canonical` (or an empty `variant`)
- **THEN** the endpoint returns a structured validation error and writes nothing

#### Scenario: A non-public feed URL is rejected without a write

- **WHEN** `POST /admin/api/corpus/feeds` sends a `url` with a non-http scheme, embedded credentials, or a private/loopback/link-local host
- **THEN** the endpoint returns a structured validation error and writes no feed row

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

### Requirement: Panel data flows by SSR for reads and typed RPC for interactions

The admin panel SHALL obtain a surface's **initial data** by calling the Worker's existing `src/` operation functions **directly** during server-render (in the same Worker isolate), embedding the result into the page and the island's hydration props — with **no client fetch and no hand-written response decoder** for the first paint. After hydration, an island's **interactions** — mutations (e.g. onboard / revoke / rotate, corpus add / remove, config save, tool invoke, discovery retry / delete) and **live previews** (e.g. discovery Analyze / Dry-run, feed test) — SHALL call typed Hono routes through Hono's RPC client (`hc`), whose request and response types are **inferred from the route definitions** with no codegen and no separately-maintained decoder. Both the server-render path and the typed routes SHALL call the **same** `src/` functions, so there is one source of truth for each operation regardless of transport.

The island hydration props SHALL be JSON-serializable, so the client hydrates with state matching the server-render. A route that an island calls SHALL return the operation's structured result or structured error verbatim (a tool/operation structured error is data for the island to render, not an HTTP 500), preserving the existing structured-error contract.

#### Scenario: Initial read is server-rendered without a client fetch

- **WHEN** the operator opens an admin surface (e.g. the Data recipe list, or the Config calibration console)
- **THEN** the Worker calls the corresponding `src/` function during server-render and the page arrives populated, with no client-side fetch or decoder for the initial data

#### Scenario: An island interaction calls a typed route

- **WHEN** the operator triggers a mutation or live preview from a hydrated island (e.g. runs Analyze, or saves the discovery config)
- **THEN** the island calls a typed Hono route via `hc`, the route runs the same `src/` operation the server-render would, and the island receives the typed structured result or structured error

#### Scenario: One source of truth across transports

- **WHEN** an operation is reachable both as initial server-rendered data and as an island-invoked route
- **THEN** both call the same `src/` function (the route is not a re-implementation), so their results cannot diverge

### Requirement: Panel UI models impossible states impossible in TypeScript

The admin UI SHALL carry forward the panel's data-modeling discipline in TypeScript: a surface's loaded remote data SHALL be a **discriminated union** over the load's states (not-asked / loading / failure-with-error / success-with-value), never a `boolean` loading flag beside an optional error and optional value; a finite set of UI states SHALL be a discriminated union, not a `string` or parallel booleans; an in-flight mutation together with which operation is running and its failure SHALL be a **single** union value (so "busy", "which operation", and "the error" cannot contradict, and one-mutation-at-a-time is structural); and an error SHALL carry its type inside the failing state, not a detached `string`. Exhaustiveness over these unions SHALL be enforced (e.g. an exhaustiveness check that fails the build when a variant is unhandled), so adding a state flags every site that must handle it. The discipline SHALL be documented in `admin/CLAUDE.md` in its TypeScript form.

#### Scenario: Remote data is a four-state union

- **WHEN** a surface loads data from the Worker
- **THEN** its state is a discriminated union whose variants are not-asked, loading, failure (carrying the error), and success (carrying the value) — and the impossible combinations are unrepresentable

#### Scenario: An in-flight mutation and its failure are one value

- **WHEN** a surface performs a mutation that can fail (e.g. a corpus add or a member revoke)
- **THEN** the in-flight operation, which row/operation it targets, and its failure are one union value, so a second overlapping mutation and a contradictory "busy but errored" state are unrepresentable

#### Scenario: Adding a UI state is caught by exhaustiveness

- **WHEN** a developer adds a new variant to one of the panel's UI-state unions
- **THEN** the build's exhaustiveness check flags every `switch`/match that does not yet handle the new variant

### Requirement: Admin visual layer is a Basecoat design system compiled by Tailwind

The admin panel's visual layer SHALL be the **Basecoat** component system (a Tailwind CSS component library using shadcn/ui-compatible CSS-variable tokens), applied through Basecoat's documented class API — a root component class plus `data-variant`/`data-size` attributes (e.g. `<button class="btn" data-variant="destructive">`) — rather than a bespoke hand-authored stylesheet. The panel SHALL use a single pinned Basecoat **style pack**, and its theme tokens (e.g. `--primary`) SHALL be overridable in a project theme layer so the operator accent is preserved without forking the pack.

The served stylesheet SHALL be **compiled by the admin build**: the `build-admin` script SHALL run Tailwind over the panel's source to produce `admin/dist/admin/styles.css`, including the Basecoat component layer and only the Tailwind utilities the panel's source uses. Consistent with the admin build model, `admin/dist/` is a **gitignored build artifact** built fresh by CI, the deploy, and local `wrangler dev` — not committed. This build SHALL NOT fetch from a network package registry (it runs from installed dependencies), preserving the panel's "any sandbox can rebuild it" guarantee.

Interactive surfaces SHALL use Basecoat's **CSS-only** components — including the native `<dialog>` element for modals and a native styled select — and SHALL keep their behavior in the panel's own island state; the panel SHALL NOT load Basecoat's component JavaScript, so read-only pages continue to ship no client JavaScript and no second runtime mutates island-owned DOM.

#### Scenario: Components use the Basecoat class API

- **WHEN** the component kit renders a primitive (button, card, input, badge, alert, table, dialog)
- **THEN** it emits Basecoat's documented markup and `data-variant`/`data-size` API, styled by the compiled Basecoat stylesheet, not a bespoke per-component class

#### Scenario: Stylesheet is compiled from source without a registry

- **WHEN** the admin bundle is built (including in a sandbox with no package-registry access)
- **THEN** the build compiles `admin/dist/admin/styles.css` from the panel source via Tailwind with no network fetch (a gitignored artifact built fresh, not a committed bundle)

#### Scenario: Operator accent is preserved through theme tokens

- **WHEN** the panel is themed
- **THEN** the Basecoat style pack's tokens are overridden in a project theme layer (e.g. `--primary` set to the operator accent), with the style pack itself unforked

#### Scenario: Interactive surfaces load no Basecoat JavaScript

- **WHEN** an island provides interactivity (e.g. a detail dialog, a member action, a config form)
- **THEN** it uses Basecoat CSS-only components (native `<dialog>`, native select) with behavior held in island state, and no Basecoat component JavaScript is loaded — so read-only pages ship no client JavaScript

### Requirement: Global service-health indicator present on every area

The admin shell SHALL render a **global service-health indicator** — a fixed corner control present on every admin area, not only the Status home — that surfaces the aggregate health rollup the panel already builds from `buildHealthPayload`. The indicator SHALL show the overall **healthy / degraded** state derived from the payload's `ok` and, when degraded, the count of failing jobs. Activating the indicator SHALL reveal a summary (the failing jobs and the live dependency states) and SHALL offer a link to the Status area for the full per-job detail.

The indicator SHALL derive its healthy-vs-degraded distinction from the payload's `ok`, not from any HTTP status. When the admin gate posture is **`exposed`** (the panel's own Access surface could admit a tokenless request), the rollup SHALL render as degraded, consistent with the Status area's prominent posture warning. The indicator SHALL introduce no per-tenant data beyond the tenant-data-free health payload and SHALL add no Worker-side route or secret.

#### Scenario: Indicator is present on a non-Status area

- **WHEN** the operator opens any area other than Status (e.g. Members, Data, Usage, Config)
- **THEN** the global health indicator renders in its fixed corner position, showing the overall healthy/degraded rollup

#### Scenario: Degraded rollup shows the failing count and detail

- **WHEN** the health payload reports `ok` false with one or more failing jobs
- **THEN** the indicator renders the degraded state with the failing-job count, and activating it reveals the failing jobs and a link to the Status area

#### Scenario: Healthy rollup is unobtrusive

- **WHEN** the health payload reports `ok` true (every job healthy, D1 reachable, gate not exposed)
- **THEN** the indicator renders the healthy state without a failing-job count

### Requirement: Shared component kit provides the redesign primitives

The admin component kit (`src/admin/ui/kit.tsx`) SHALL provide the presentational primitives the redesigned areas compose from, each emitted in Basecoat's class API plus Tailwind utilities per the Basecoat visual-layer requirement: a list **Item**/**ItemGroup**, an **Avatar**, a **DropdownMenu**, a **Slider**, a **Switch**, a **Progress** bar, a tabular **Table**, and the **Dialog**/**Field** form primitives — plus the panel-specific layout primitives the mock reuses across areas: a **stat-card grid**, a **pager**, **sub-nav pills**, and a **sparkline + hover-tooltip** pair. These primitives SHALL be presentational only; any interactivity (a dropdown's open state, a slider/switch's change, a sparkline's hover tooltip) SHALL be driven by the panel's own island state, and the kit SHALL load no Basecoat component JavaScript — so read-only pages continue to ship no client JavaScript.

#### Scenario: Areas compose from the shared primitives

- **WHEN** a redesigned area renders a roster, a stat-tile row, a paginated list, or a sub-nav
- **THEN** it composes the corresponding kit primitive (Item/ItemGroup, stat-card grid, pager, pills) rather than re-deriving the markup, and the primitive emits Basecoat-class + Tailwind output

#### Scenario: Interactive primitives keep behavior in islands

- **WHEN** an interactive primitive is used (DropdownMenu, Slider, Switch, or a sparkline hover tooltip)
- **THEN** its behavior is held in the panel's island state with no Basecoat component JavaScript loaded

### Requirement: Status area shows corpus stat tiles

The Status area SHALL render a row of page-level **corpus stat tiles** above the service-health detail, each a labelled count read from a small operational corpus-counts reader: **Recipes** (indexed recipe count), **Members** (allowlisted member count), **RSS feeds** (discovery feed count), and **Cached SKUs** (sku-cache row count). The tiles SHALL carry no per-tenant data — only aggregate counts. The **Recipes** and **Members** tiles SHALL link to their respective areas (`/admin/data` and `/admin/members`); the remaining tiles are non-navigating.

#### Scenario: Stat tiles render aggregate counts

- **WHEN** the operator opens the Status area
- **THEN** a row of stat tiles shows the recipe, member, RSS-feed, and cached-SKU counts, with no per-tenant data

#### Scenario: Recipe and member tiles navigate

- **WHEN** the operator activates the Recipes or Members stat tile
- **THEN** the browser navigates to the Data area or the Members area respectively

### Requirement: Status job rows show run-history uptime and current-state-since

Each background-job row in the Status area SHALL render, in addition to the job's state glyph, name, last-run age, status badge, and summary-count chips, a **run-history uptime sparkline** and a **current-state-since** label, derived from the `job_runs` history (see background-job-health). The sparkline SHALL show the job's recent runs oldest→newest as per-run **ok/fail** bars with a **% uptime** label over that window; the since-label SHALL read **"Healthy since"** when the job's current state is ok and **"Unhealthy since"** when it is failing, with the streak-start instant from the reader. A job with no run history yet SHALL render without a sparkline rather than an empty or broken one.

#### Scenario: A job row shows its uptime sparkline and uptime percentage

- **WHEN** the Status area renders a job that has run history
- **THEN** that job's row shows a sparkline of its recent runs as ok/fail bars and a % uptime label over that window

#### Scenario: A job row shows healthy-since or unhealthy-since

- **WHEN** a job's current state is ok (or failing)
- **THEN** its row shows "Healthy since" (or "Unhealthy since") with the start instant of the current streak

#### Scenario: A job with no run history omits the sparkline

- **WHEN** the Status area renders a job that has no `job_runs` records yet
- **THEN** that job's row renders without a sparkline, not an empty or broken one

### Requirement: Status dependencies render as a distinct group

The Status area SHALL present the live dependencies — the **D1 reachability** probe and the **admin gate** posture — as their own item group, visually distinct from the background-jobs group, each showing the dependency name, a state indicator, and its state word (e.g. `reachable`/`unreachable`, the gate's `gated`/`exposed`/`dev bypass`/`disabled`). The exposed-gate prominent warning (per the relocated Status health requirement) is unchanged.

#### Scenario: Dependencies are grouped separately from jobs

- **WHEN** the operator opens the Status area
- **THEN** the D1 probe and admin-gate posture appear in a "Dependencies" group separate from the background-jobs list, each with its state word

