## RENAMED Requirements

- FROM: `### Requirement: Panel data flows by SSR for reads and typed RPC for interactions`
- TO: `### Requirement: Panel data flows through typed reads and typed mutations`

- FROM: `### Requirement: Admin visual layer is a Basecoat design system compiled by Tailwind`
- TO: `### Requirement: Admin visual layer is the shared shadcn/ui system built by the admin app`

## MODIFIED Requirements

### Requirement: Admin UI served as same-origin static assets

The admin UI SHALL be served by the Worker from the **same origin** as its `/admin/api/*` operations, so the browser makes no cross-origin request and the deployment needs no CORS configuration. The UI SHALL be a **single-page React application** (`packages/admin-app`, on the member app's stack) whose shell and hashed bundle live under the `assets/admin/` subtree of the Worker's one merged static-assets root, served through the static-assets binding.

Because `/admin*` is routed worker-first, the Worker SHALL serve the SPA itself: a GET for an `/admin/*` path that is neither an `/admin/api/*` route nor a real static asset SHALL be answered with the admin shell (`assets/admin/index.html`, fetched through the assets binding), whose client router renders that route's surface — so a deep link or refresh to any admin route loads that surface directly, without a redirect and without re-entering the worker-first route. A request for a **missing** admin static asset SHALL receive a real `404`, never any SPA shell (the merged root's single-page-application fallback answers asset misses with the member shell's HTML; the admin app guards against passing that through).

The bundle SHALL be built from source by the admin app's build (Vite) into `assets/admin/` — a **build artifact that is NOT committed** (gitignored), built fresh by CI and by the deploy (and for local `wrangler dev`); the generated bundle SHALL NOT be hand-edited. The build SHALL NOT depend on a network package registry being reachable, so any sandbox can rebuild it. The static-assets binding SHALL be carried through the operator config merge so it reaches every operator's deployment.

#### Scenario: UI and API share an origin (no CORS)

- **WHEN** the admin app calls an `/admin/api/*` route
- **THEN** the call is same-origin and succeeds with no CORS preflight or `Access-Control-*` configuration

#### Scenario: Bundle is built from source, not hand-edited

- **WHEN** the admin UI changes
- **THEN** the change is made in the TypeScript UI source and the bundle is rebuilt by the admin app's build, and `assets/admin/` is not edited by hand (it is a gitignored build artifact, rebuilt fresh by CI and the deploy)

#### Scenario: Bundle builds without a package registry

- **WHEN** the admin UI is built in a sandbox with no access to a language package registry
- **THEN** the build still produces the bundle (the toolchain has no network-registry build dependency)

#### Scenario: The assets binding survives the operator config merge

- **WHEN** the deploy merges the code-level config into an operator's config
- **THEN** the static-assets binding is present in the deployed config (it is on the merge allowlist) and the admin UI is served

#### Scenario: A deep link is served the shell and resolves

- **WHEN** a GET arrives for an `/admin/*` path that is not an `/admin/api/*` route and not a built static asset (e.g. `/admin/normalize?tab=audits`)
- **THEN** the Worker serves the admin shell (without redirect-looping) and the client router renders that route's surface directly

#### Scenario: A missing admin asset is a real 404

- **WHEN** a GET arrives for a nonexistent file under the admin bundle's static namespace (e.g. a renamed chunk)
- **THEN** the response is `404`, not the member SPA's shell and not the admin shell

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin panel SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Data** area (the read-only data explorer over D1 and the R2 corpus, narrowed to its **Recipes / Stores / Guidance** sub-nav — see the operator-data-explorer capability), an **Insights** area (the group-popularity dashboard over the recipe corpus — see the group-insights capability), a **Usage** area (the usage-observability dashboards), a **Discovery** area (the autonomous candidate-pipeline view), a **Logs** area (the all-jobs run log), and a **Config** area (the discovery calibration console and the shared-corpus editors, as routed sub-views) — each with its own URL, so a new surface is added as its own routed page rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at `/admin/members`, the data explorer under `/admin/data/*` (its sub-nav destinations being Recipes, Stores, and Guidance), the insights dashboard at `/admin/insights`, the usage dashboards at `/admin/usage`, the discovery view at `/admin/discovery`, the run log at `/admin/logs`, and configuration under `/admin/config` (with the selected sub-view as a sub-route, e.g. `/admin/config/ingest-keys`), not at the panel root.

Each area SHALL render client-side via the panel's router at its own URL; a deep link or refresh to a surface's URL SHALL load that surface directly (the Worker serves the shell; the router resolves the route). Any filter, tab, page, or selection state a deep link should reproduce SHALL be expressed in the URL (path and/or query parameters), so those states are independently navigable and shareable. Within a surface, an interaction (opening a dialog, editing a form, expanding a row) MAY update state client-side without a navigation.

#### Scenario: Each surface has its own URL

- **WHEN** the operator opens a different area (e.g. Status, member management, the logs, or config)
- **THEN** the browser URL is that surface's route and the surface renders for that URL

#### Scenario: Home route shows the Status view

- **WHEN** the operator opens `/admin` (or `/`)
- **THEN** the Status (background-job health) view renders as the home surface, not member management

#### Scenario: Discovery is a top-level area

- **WHEN** the operator opens `/admin/discovery` directly (or refreshes there)
- **THEN** the Discovery area renders as its own top-level surface, reached from the area nav alongside Status, Members, Data, Insights, Usage, Logs, and Config

#### Scenario: Insights is a top-level area

- **WHEN** the operator opens `/admin/insights` directly (or refreshes there)
- **THEN** the Insights area renders as its own top-level surface, reached from the area nav between Data and Usage

#### Scenario: Deep link to a config sub-view

- **WHEN** the operator opens a config editor route such as `/admin/config/ingest-keys` directly (or refreshes there)
- **THEN** the Config area renders with that sub-view selected

#### Scenario: Deep link to a data view

- **WHEN** the operator opens a data-explorer route such as `/admin/data/recipes/<slug>` directly (or refreshes there)
- **THEN** that data view renders directly

#### Scenario: Deep link to a query-param state

- **WHEN** the operator opens a URL carrying a surface's filter/tab/page state (e.g. `/admin/normalize?tab=aliases` or `/admin/discovery?filter=duplicate`)
- **THEN** the surface renders in exactly that state, and changing the state in the UI updates the URL so the new state is shareable

#### Scenario: Data area sub-nav is narrowed to Recipes, Stores, and Guidance

- **WHEN** the operator opens `/admin/data` (or any `/admin/data/*` route)
- **THEN** the Data area's sub-nav offers exactly Recipes, Stores, and Guidance — not the prior generic Members/Corpus/Discovery/System tabs

### Requirement: Status homepage surfaces service health

The admin panel SHALL present the aggregate `/health` state in its **Status** home view (the `/admin` route) by rendering the health payload's detail: one row per registered job showing the job's name, its **healthy / failing / never-run** state, and the relative age of its last run, plus the job's operational `summary` detail; the D1 reachability row; and the **admin gate posture** (the payload's `admin` section). The overall **healthy/degraded rollup** is NOT owned by this view — it is surfaced by the global service-health indicator present on every area (see that requirement). The view SHALL render a **never-run** job (no record yet) as visually distinct from both a healthy and a failing one.

The admin posture SHALL be rendered as a single derived gate state — **exposed / gated / dev / disabled** — computed from the section's booleans with the same precedence the Worker badge uses (`exposed` over `access_configured` over `dev_bypass_set` over otherwise), with the `email_allowlist` boolean shown as a defense-in-depth sub-detail of the gated state. An **`exposed`** gate (the panel's own Access surface could admit a tokenless request) SHALL be rendered as a prominent warning.

The view's data SHALL arrive via the panel's Access-gated **status read** (`GET /admin/api/status`), which aggregates the same `buildHealthPayload` the public `/health` serves (plus the Status view's existing companion reads) and returns the payload as data regardless of health — a decoded **degraded** payload is a **successful read** (rendering the degraded detail from the payload), NOT a load failure. Load-failure handling SHALL be reserved for a genuine transport error or a body that does not decode. The view's per-job and dependency states SHALL derive from the payload, not from any HTTP status code. The status read SHALL introduce no per-tenant data beyond what the tenant-data-free health payload and the existing Status companion reads already contain, no new health computation, and no secret.

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

- **WHEN** the status read fails at the transport layer or returns a body that does not decode
- **THEN** the Status view shows a load-failure state, distinct from a successfully-read degraded payload

### Requirement: Logs area with a left submenu and a detail dialog

The admin panel SHALL provide a top-level **Logs** area whose sole content is the **all-cron-jobs run log**: a filterable, paginated list of individual `job_runs` records across every registered background job (see "Logs area shows the all-jobs run log" below). The Logs area SHALL render this view directly, with **no left submenu or sidebar** — it is a single-destination area, not a sectioned one. The Logs area SHALL NOT host a candidate-level Discovery destination — the per-candidate discovery pipeline is reached at the top-level **Discovery** area (`/admin/discovery`; see "Discovery area shows the candidate pipeline"), not under Logs. The legacy route `/admin/logs/discovery` SHALL respond with a **302 redirect** (served by the Worker, so bookmarks resolve without the app) to `/admin/discovery` rather than serving its own content.

When an individual run-log entry expands to more than a row's worth of detail, it SHALL render inline (the summary key/value detail), not in a separate dialog.

#### Scenario: Logs area shows the all-jobs run log by default

- **WHEN** the operator opens `/admin/logs`
- **THEN** the area renders the all-jobs run log (entries across every registered background job, newest-first), not the Discovery candidate log

#### Scenario: Logs area renders without a sidebar

- **WHEN** the operator opens `/admin/logs`
- **THEN** the page shows the all-jobs run log as the area's full-width content, with no left submenu or sidebar navigation

#### Scenario: The legacy Discovery log route redirects to the Discovery area

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker responds with a 302 redirect to `/admin/discovery`, which renders the candidate-pipeline view

#### Scenario: Entry detail expands inline for a run

- **WHEN** the operator expands a run-log entry on `/admin/logs`
- **THEN** its `job_health`-shaped summary (and, on failure, its error) renders inline beneath the entry, without a dialog

#### Scenario: A new log source is added as a submenu destination

- **WHEN** a future log source is introduced
- **THEN** it appears as an additional Logs destination without restructuring the all-jobs run-log view or the Discovery area

### Requirement: Panel data flows through typed reads and typed mutations

The admin panel SHALL obtain every surface's data through **typed Hono routes** on the Worker, consumed via Hono's RPC client (`hc`) whose request and response types are **inferred from the route definitions** — no codegen and no separately-maintained decoder. Each screen's data SHALL come from one (or few) Access-gated `/admin/api/*` **read route(s)** whose payload is assembled by calling the Worker's existing `src/` operation functions; a surface's **interactions** — mutations (e.g. onboard / revoke / rotate, corpus add / remove, config save, discovery retry / delete) and **live previews** (e.g. discovery Analyze / Dry-run, feed test) — SHALL call typed routes the same way. A read route and the operation routes it neighbors SHALL call the **same** `src/` functions, so there is one source of truth for each operation regardless of transport.

Reads SHALL flow through the panel's query layer (a per-screen cache): a successful mutation SHALL be reflected by invalidating/refetching the affected screen's query — never by a full page reload. A route SHALL return the operation's structured result or structured error verbatim (a tool/operation structured error is data for the screen to render, not an HTTP 500), preserving the existing structured-error contract.

#### Scenario: A screen reads through its typed route

- **WHEN** the operator opens an admin surface (e.g. the Data recipe list, or the Config calibration console)
- **THEN** the app fetches that surface's typed `/admin/api/*` read, whose payload the Worker assembled from the corresponding `src/` functions, with no hand-written response decoder

#### Scenario: An interaction calls a typed route

- **WHEN** the operator triggers a mutation or live preview (e.g. runs Analyze, or saves the discovery config)
- **THEN** the app calls a typed Hono route via `hc`, the route runs the same `src/` operation, and the screen receives the typed structured result or structured error

#### Scenario: One source of truth across transports

- **WHEN** an operation's data is reachable both through a screen's read route and through an interaction route
- **THEN** both call the same `src/` function (neither is a re-implementation), so their results cannot diverge

#### Scenario: A mutation refreshes its surface without a reload

- **WHEN** a mutation succeeds (e.g. a discovery retry, an alias override, a quarantine toggle)
- **THEN** the affected screen's cached read is invalidated and refetched and the surface reflects the result in place, with no full-page reload or navigation

### Requirement: Panel UI models impossible states impossible in TypeScript

The admin UI SHALL carry forward the panel's data-modeling discipline in TypeScript, expressed through the query layer's own state unions: a surface's loaded remote data SHALL be handled as the query's **discriminated status union** (pending / error-with-error / success-with-data, with not-asked as a disabled query) — never destructured into a `boolean` loading flag beside an optional error and optional value that can recombine contradictorily; a finite set of UI states SHALL be a discriminated union, not a `string` or parallel booleans; an in-flight mutation together with which operation is running and its failure SHALL be handled as a **single** mutation-state value (its status plus its variables identify the operation and target, so "busy", "which operation", and "the error" cannot contradict), with one-at-a-time enforced by gating on that pending state, never a parallel flag; and an error SHALL carry its structured type inside the failing state, not a detached `string`. **Server state SHALL NOT be copied into component state** — the query cache is the single source of truth, and mutations edit it (invalidation or cache update), never a shadow copy. Exhaustiveness over these unions SHALL be enforced (an exhaustiveness check that fails the build when a variant is unhandled), so adding a state flags every site that must handle it. The discipline SHALL be documented in `src/admin/CLAUDE.md` in its query-layer form.

#### Scenario: Remote data is handled as a status union

- **WHEN** a surface loads data from the Worker
- **THEN** the view branches on the query's discriminated status union (pending, error carrying the error, success carrying the value) with the impossible combinations unrepresentable, not on recombined loose flags

#### Scenario: An in-flight mutation and its failure are one value

- **WHEN** a surface performs a mutation that can fail (e.g. a corpus add or a member revoke)
- **THEN** the in-flight operation, which row/operation it targets, and its failure are one mutation-state value, so a second overlapping mutation and a contradictory "busy but errored" state are unrepresentable

#### Scenario: Adding a UI state is caught by exhaustiveness

- **WHEN** a developer adds a new variant to one of the panel's UI-state unions
- **THEN** the build's exhaustiveness check flags every `switch`/match that does not yet handle the new variant

### Requirement: Admin visual layer is the shared shadcn/ui system built by the admin app

The admin panel's visual layer SHALL be the repository's **shared shadcn/ui component system** — the vendored primitives and Tailwind v4 theme tokens in `packages/ui`, the same package the member app consumes — rather than a bespoke hand-authored stylesheet or a second component system. The panel SHALL apply an **admin theme layer** over the shared tokens (e.g. `--primary` set to the operator accent) without forking the shared package, and the member app's appearance SHALL be unaffected by that layer.

The served stylesheet and bundle SHALL be **compiled by the admin app's build** (Vite with the Tailwind v4 plugin) into the gitignored `assets/admin/` artifact — built fresh by CI, the deploy, and local `wrangler dev`; not committed. This build SHALL NOT fetch from a network package registry (it runs from installed dependencies), preserving the panel's "any sandbox can rebuild it" guarantee. Interactive surfaces (dialogs, menus, selects) SHALL use the shared package's accessible primitives, with their behavior held in the panel's own component state.

#### Scenario: Components come from the shared package

- **WHEN** a surface renders a primitive (button, card, input, badge, alert, table, dialog, dropdown)
- **THEN** it composes the `packages/ui` component rather than re-deriving bespoke markup, styled by the shared tokens plus the admin theme layer

#### Scenario: Stylesheet is compiled from source without a registry

- **WHEN** the admin bundle is built (including in a sandbox with no package-registry access)
- **THEN** the build compiles the panel's stylesheet and bundle from source with no network fetch (a gitignored artifact built fresh, not a committed bundle)

#### Scenario: Operator accent is preserved through theme tokens

- **WHEN** the panel is themed
- **THEN** the shared tokens are overridden in the admin theme layer (e.g. `--primary` set to the operator accent), with `packages/ui` itself unforked and the member app's look unchanged

### Requirement: Global service-health indicator present on every area

The admin shell SHALL render a **global service-health indicator** — a fixed corner control present on every admin area, not only the Status home — that surfaces the aggregate health rollup derived from `buildHealthPayload`. The indicator SHALL show the overall **healthy / degraded** state derived from the payload's `ok` and, when degraded, the count of failing jobs. Activating the indicator SHALL reveal a summary (the failing jobs and the live dependency states) and SHALL offer a link to the Status area for the full per-job detail.

The indicator SHALL derive its healthy-vs-degraded distinction from the payload's `ok`, not from any HTTP status. When the admin gate posture is **`exposed`** (the panel's own Access surface could admit a tokenless request), the rollup SHALL render as degraded, consistent with the Status area's prominent posture warning. The indicator SHALL consume the **same status read** (and the same client cache entry) the Status area uses — no indicator-specific route — and SHALL keep itself honest across long client-side sessions by refetching that read periodically and on window focus. It SHALL introduce no per-tenant data beyond the tenant-data-free health payload and no secret.

#### Scenario: Indicator is present on a non-Status area

- **WHEN** the operator opens any area other than Status (e.g. Members, Data, Usage, Config)
- **THEN** the global health indicator renders in its fixed corner position, showing the overall healthy/degraded rollup

#### Scenario: Degraded rollup shows the failing count and detail

- **WHEN** the health payload reports `ok` false with one or more failing jobs
- **THEN** the indicator renders the degraded state with the failing-job count, and activating it reveals the failing jobs and a link to the Status area

#### Scenario: Healthy rollup is unobtrusive

- **WHEN** the health payload reports `ok` true (every job healthy, D1 reachable, gate not exposed)
- **THEN** the indicator renders the healthy state without a failing-job count

#### Scenario: The indicator and the Status area share one read

- **WHEN** the operator navigates between areas with the panel open
- **THEN** the indicator renders from the same cached status read the Status area consumes (refreshed on focus and on its periodic interval), not from a second health route

### Requirement: Shared component kit provides the redesign primitives

The admin panel SHALL compose its surfaces from shared primitives rather than re-deriving markup per area: the **generic** primitives (button, card, input, badge, alert, table, dialog, dropdown menu, select, slider, switch, progress, pagination) come from `packages/ui` per the visual-layer requirement, and the **panel-specific composites** the areas reuse — a stat-card grid, a pager/list footer, sub-nav pills, a sparkline + hover-tooltip pair, a key/value detail renderer, and the pipeline progression track — SHALL each be a single shared component within the admin app, consumed by every area that renders that pattern. Composites SHALL be presentational, with interactivity held in the consuming surface's component state.

#### Scenario: Areas compose from the shared primitives

- **WHEN** an area renders a roster, a stat-tile row, a paginated list, or a sub-nav
- **THEN** it composes the corresponding shared primitive/composite (Item-style rows, stat-card grid, pager, pills) rather than re-deriving the markup

#### Scenario: A panel composite is single-sourced

- **WHEN** two areas render the same panel pattern (e.g. Status and Usage sparklines, or Discovery and Normalize key/value detail)
- **THEN** both compose the same shared component, so the pattern cannot drift between areas

### Requirement: Member detail view with a sectioned sub-nav

The admin surface SHALL provide a member-detail view, reached by activating a roster row, at its own URL (`/admin/members/<id>`, with each section as its own sub-route, e.g. `/admin/members/<id>/pantry`) so a deep link or refresh loads that member's selected section directly. The view SHALL render a header (the member's `@username`, owner/status/Kroger badges, and activity stats) and a pills sub-nav over six sections — Profile, Pantry, Meal plan, Grocery, Cooking log, Notes — each rendered from the panel's one typed member-detail read (which assembles the existing `memberDetail` read; profile as key-value detail, pantry and cooking log as tabular data, meal plan and grocery list as their own row layouts, notes as note cards). A pending (not-yet-connected) member SHALL render an empty state explaining the member has not connected yet, instead of the sectioned sub-nav — and the read SHALL NOT attempt to assemble per-tenant detail that does not exist yet.

#### Scenario: Detail view deep-links to a section

- **WHEN** the operator opens `/admin/members/<id>/pantry` directly (or refreshes there)
- **THEN** the member's detail view loads with the Pantry section selected

#### Scenario: Header shows identity and activity

- **WHEN** the operator opens a connected member's detail view
- **THEN** the header shows the member's `@username`, applicable owner/status/Kroger badges, and their activity stats (cooked/favorites counts, joined age)

#### Scenario: Pending member shows an empty state

- **WHEN** the operator opens the detail view for a member who has not yet connected
- **THEN** the view shows an empty state explaining the member hasn't connected, and no per-tenant detail read is attempted for data that doesn't exist yet

#### Scenario: Each section renders from the existing member-detail read

- **WHEN** the operator selects a section (Profile, Pantry, Meal plan, Grocery, Cooking log, or Notes)
- **THEN** that section's content renders from the same `memberDetail`-backed read (one read for all six sections — switching sections makes no additional request), with no separate or duplicated read path

### Requirement: Usage area presents headline tiles, per-namespace KV meters, AI neurons, job trends, and tool usage

The Usage area (`/admin/usage`) SHALL present its four observability surfaces composed from the panel's shared primitives, in place of the prior bare status-row lists:

1. A headline **stat-tile row** showing KV operations today (the sum of the day's read/write/delete/list totals), Workers AI neurons used today (against the daily limit), MCP tool calls over the trends window, and the tool error rate over the same window.
2. An **Account resources** card with one KV-operation meter per action (read/write/delete/list), each rendered as a progress bar **stacked by namespace** (a categorical color per labeled namespace, per the usage-observability namespace-label requirement) against that action's daily free-tier limit, recolored (ok/warn/fail) as the total approaches or exceeds the cap; each meter SHALL be paired with a **30-day sparkline** also stacked by namespace, sourced from the per-namespace history (usage-observability). The same card SHALL show a Workers AI neurons meter (used vs. daily limit) and a per-model breakdown row (model name + neurons consumed).
3. A **per-job trends** list: one sparkline row per background job showing its runs/day over the trends window, its total run count, and its average duration, sourced from `fetchUsageTrends`.
4. A **tool usage** table listing each tool's call count, error count and rate, and p50/p95 latency over the trends window, sourced from `fetchToolUsage`, busiest tool first.

Each surface SHALL preserve its existing not-configured and upstream-failure-detail behavior (per the usage-observability/usage-trends/tool-usage-trends capabilities) — an unconfigured or failing surface renders its existing explicit state, not a broken or blank composition; the area's read SHALL carry those states structurally, as data. Per-segment or per-bar hover detail MAY be a client-side tooltip.

#### Scenario: Headline tiles summarize the four top-line numbers

- **WHEN** the operator opens `/admin/usage` with usage analytics configured
- **THEN** the stat-tile row shows today's KV-operation total, today's AI-neuron usage against its limit, the trends-window tool-call count, and the trends-window error rate

#### Scenario: KV meters are stacked per namespace with a matching sparkline

- **WHEN** the operator opens `/admin/usage` with usage analytics configured
- **THEN** each KV-operation meter (read/write/delete/list) renders as a namespace-stacked bar against its daily limit, paired with a namespace-stacked 30-day sparkline, with namespaces shown in their resolved labels and colors where available

#### Scenario: A meter recolors as it approaches its cap

- **WHEN** a KV-operation total reaches or exceeds its warn threshold or its daily limit
- **THEN** that meter renders in its warn or fail state rather than its default ok state

#### Scenario: Per-job and tool-usage surfaces are unchanged in data, redesigned in presentation

- **WHEN** the operator views the per-job trends list or the tool-usage table
- **THEN** the data shown (runs/day, average duration, calls, errors, p50/p95) is the same `fetchUsageTrends`/`fetchToolUsage` data, composed from the shared sparkline/table primitives

#### Scenario: An unconfigured or failing surface keeps its explicit state

- **WHEN** usage analytics is unconfigured, or an upstream request fails
- **THEN** the affected surface (snapshot, trends, or tool usage) renders its existing explicit not-configured or upstream-failure-detail state, and the rest of the page's configured surfaces still render

### Requirement: Logs area shows the all-jobs run log

The Logs area's default view SHALL render every registered background job's run history (`job_runs`, via the `background-job-health` capability) as one merged, newest-first list, bounded to a fixed page size. The view SHALL provide:

- A **job filter** as a row of pills — "All jobs" plus one pill per registered job name (`HEALTH_JOBS`) — selecting which job's runs are shown; the currently selected pill SHALL be visually distinct.
- A **hint line** reporting the count of runs shown under the current filter, split into ok vs. failed counts.
- One **entry per run**, showing: a status dot (ok/fail), the job's name (with its icon), an ok/failed label, the run's relative age, and its duration.
- **Pagination** over the filtered list, with a fixed page size, when the filtered count exceeds one page.
- Each entry SHALL be **expandable** to show its stored `summary` (the same tenant-clean counts the job upserts to `job_health`) rendered as key/value pairs, and, when the run failed, the run's error.

The job filter and the page SHALL be expressed in the route's query parameters, so each filter/page combination is independently navigable and deep-linkable. The run list SHALL be fetched as the area's one bounded read (the same cap as the health capability's retention) and filtered/paginated client-side; per-entry expand/collapse SHALL require no server round-trip.

A job with zero recorded runs SHALL still appear as a filter pill (consistent with the Status area always listing a registered job, even never-run) but SHALL show no entries under that filter.

#### Scenario: All-jobs view lists runs across every job, newest-first

- **WHEN** the operator opens `/admin/logs` with multiple jobs' runs recorded
- **THEN** the entries render newest-first regardless of which job produced each run, and the hint line reports the total run count split ok vs. failed

#### Scenario: Filtering by job pill narrows the list

- **WHEN** the operator selects a specific job's pill
- **THEN** only that job's runs render, the hint line updates to that job's counts, and the page resets to the first page

#### Scenario: A never-run job still shows a pill with no entries

- **WHEN** a registered job has no `job_runs` records yet
- **THEN** its pill is present in the filter row, and selecting it shows zero entries (not an error)

#### Scenario: Expanding a run shows its summary

- **WHEN** the operator expands a run entry
- **THEN** the entry's stored `summary` renders as key/value detail beneath it, without navigating away from the list and without a server round-trip

#### Scenario: Expanding a failed run shows its error

- **WHEN** the operator expands a run entry whose outcome was a failure
- **THEN** the expanded detail includes the run's error alongside its summary

#### Scenario: Pagination is filter-aware

- **WHEN** the filtered run count exceeds one page
- **THEN** pagination controls let the operator move between pages of the current filter, and changing the filter resets to the first page

#### Scenario: A discovery-sweep run links to the Discovery area, not the legacy route

- **WHEN** the operator expands a `discovery-sweep` run entry
- **THEN** the expanded detail includes a link to `/admin/discovery` for per-candidate detail, not `/admin/logs/discovery`, since the run's summary carries only sweep-tick counts, not individual candidates

### Requirement: Discovery area shows the candidate pipeline

The admin panel's **Discovery** area (`/admin/discovery`) SHALL render the autonomous candidate pipeline (`discovery-sweep`): page-level stat tiles, a filter-pill row, and a paginated list of per-candidate cards — the area's sole content (replacing any placeholder body).

**Stat tiles** SHALL show: total **Candidates**, **Imported** count with its import rate (imported ÷ total, as a percentage), **Parked / failed** count (content `error` parks plus infrastructure `failed` rows), and the count **In retry queue** (rows with `next_retry_at` not null).

**Filter pills** SHALL be: All, Imported, Retrying, Parked, Failed, No match, Duplicate, Dietary, Deferred — each labelled with its current count; "Retrying" SHALL match every retryable row (`next_retry_at` not null) regardless of its `error`/`failed` split; the other pills SHALL match their corresponding `outcome` value (`imported`, `error` for Parked, `failed` for Failed, `no_match`, `duplicate`, `dietary_gated`, `deferred`). Selecting a pill SHALL filter the candidate list and reset to the first page. The filter and the page SHALL be expressed as route query parameters so each filter/page combination is independently navigable and deep-linkable.

Each **candidate card** SHALL show: the candidate's title, source (with an icon distinguishing a feed vs. an email source) and its relative discovery age, an outcome badge, a **7-stage progression track** (triage → acquire → classify → describe → dedup → match → import — the `discovery-sweep` pipeline's real stage order) rendered per the "Discovery candidate progression track" requirement, and a one-line plain-language summary of where/why the candidate stands (e.g. an import's member attribution, a duplicate's matched recipe, a park's specific reason, a dietary gate's restriction). A candidate halted at the `match` stage (outcome `no_match` with `detail.stage` of `"match"` or `"confirm"`, or `dietary_gated`) SHALL additionally show the per-member match scores carried in its log entry's `detail` (see the `discovery-sweep` capability's "Sweep outcomes are recorded as an operator-auditable log" requirement), so the operator can see how close each member came to a match rather than only the pass/fail outcome. A retryable candidate (outcome `error` or `failed` with `next_retry_at` not null) SHALL show its attempt count against the retry cap and a relative countdown to its next automatic retry; a terminal parked/failed candidate (attempt cap exhausted) SHALL show that it is terminal rather than a countdown. The list SHALL be paginated with a fixed page size.

Expanding a card SHALL reveal: a per-stage breakdown (each of the 7 stages marked passed / stopped here / not reached, with a short description of what that stage does) and the underlying `discovery_log` row rendered as key/value detail (via the shared key/value composite) — id, url, outcome, slug, attempts, the next-retry countdown, and the outcome's `detail` payload (including the per-member match scores when present).

#### Scenario: Discovery area renders the pipeline view by default

- **WHEN** the operator opens `/admin/discovery`
- **THEN** the area renders the stat tiles, the filter-pill row, and the paginated candidate-card list — not a placeholder

#### Scenario: Stat tiles summarize the candidate pool

- **WHEN** the operator opens `/admin/discovery` with a mix of imported, parked, failed, and retryable candidates recorded
- **THEN** the stat tiles show the total candidate count, the imported count with its import-rate percentage, the combined parked/failed count, and the in-retry-queue count

#### Scenario: A filter pill narrows the candidate list

- **WHEN** the operator selects the "Duplicate" pill
- **THEN** only candidates with outcome `duplicate` render, the page resets to the first page, and the pill's count matches the rendered list's length

#### Scenario: The "Retrying" pill matches both parked and failed retryable rows

- **WHEN** the operator selects the "Retrying" pill with both `error`- and `failed`-outcome rows that have a pending `next_retry_at`
- **THEN** both rows render under that filter, regardless of their outcome split

#### Scenario: A candidate card shows its furthest stage and halt point

- **WHEN** a candidate's outcome is `no_match` with `detail.stage` of `"triage"`
- **THEN** its progression track shows no stage as passed and `triage` as the halt point, colored as a rejection

#### Scenario: An imported candidate shows all 7 stages passed

- **WHEN** a candidate's outcome is `imported`
- **THEN** its progression track shows all 7 stages as passed, with no halt-colored stop

#### Scenario: A match-halted candidate shows its per-member scores

- **WHEN** a candidate's outcome is `no_match` with `detail.stage` of `"match"`, or `dietary_gated`
- **THEN** the card shows the per-member match scores from the log entry's `detail`, alongside the existing plain-language summary

#### Scenario: A retryable candidate shows its attempt count and retry countdown

- **WHEN** a candidate's outcome is `error` with `attempts` of 2 and a future `next_retry_at`
- **THEN** the card shows "attempt 2/5" (the configured retry cap) and a relative countdown to the next automatic retry

#### Scenario: A terminal parked candidate shows terminal, not a countdown

- **WHEN** a candidate's outcome is `error` with `attempts` at the retry cap and `next_retry_at` null
- **THEN** the card shows it is terminal (no further automatic retry), not a countdown

#### Scenario: Expanding a card shows the per-stage breakdown and the raw log row

- **WHEN** the operator expands a candidate card
- **THEN** the expanded detail shows each of the 7 stages marked passed / stopped here / not reached, and the underlying `discovery_log` row rendered as key/value detail

### Requirement: Discovery area has a Satellites liveness sub-tab

The admin **Discovery** area SHALL present **Candidates | Satellites** sub-tabs. The **Satellites** sub-tab SHALL be a read-only view showing: a **liveness** section with one card per active satellite (machine) carrying its overall health badge in the `/health` posture language (`fresh`/`stale`/`never`), its last-push relative time, its reported satellite + contract version with a **skew** chip when the machine's contract is behind the Worker's, and a per-source breakdown (each source's own health dot, last push, and 24h count); a **throughput funnel** (Received → Accepted → Deduped on arrival → handed to sweep, then the downstream pipeline outcomes Imported / No-match / Duplicate / Parked, reusing the Discovery outcome vocabulary); and a **recent-pushes** log (when · satellite · source · batch count · result, where result is `accepted` / `partially-deduped` / `rejected-bad-payload` / `rejected-bad-key`). The **Candidates** sub-tab SHALL additionally show a compact **ingest strip** ("N satellites · X fresh · Y pushed today →") that turns to a warning tone on any stale satellite or version skew and links to the Satellites sub-tab.

#### Scenario: A machine's liveness and skew are visible

- **WHEN** the operator opens Discovery › Satellites
- **THEN** each active satellite shows its health, last-push time, per-source breakdown, and a skew chip when its contract version is behind the Worker's

#### Scenario: The candidates ingest strip warns on staleness

- **WHEN** any satellite is stale or on a behind contract version
- **THEN** the Candidates sub-tab's ingest strip renders in a warning tone and links to the Satellites sub-tab

### Requirement: Normalize area has an Audits tab showing audit convergence

The Normalize area SHALL have an **Audits** sub-nav tab (deep-linkable by query param) presenting the self-healing audit pipeline as a convergence surface. It SHALL show: (1) a **backlog-burndown hero** with the live count of unaudited alias rows and unaudited edge rows (`source='auto' AND audited_at IS NULL`), each with a short recent burndown series derived from the audit jobs' run history; (2) **pass cards** — alias audit, edge audit, sku-cache re-key, and a compact disjunction-sweep card — each with its latest-run summary counts from the job's `job_runs` summary, a per-tick worked-rows sparkline (audit passes), and **its own burndown status**: the pass's remaining-backlog count, a compact burndown-trend sparkline, and a converging/converged state chip driven by that backlog (converged = the green positive terminal state); (3) a **restorations log** of `edge_restore` decisions, each linking the origin decision it revisits (via the structured `replay_of` detail); and (4) a **merge-rejection table** over `ingredient_coresolution_rejection` (pair, rejected-at, backoff expiry). A fully drained backlog (both counts zero) SHALL render as a **positive terminal state** (green, "holds at zero" language) — never as a dead zero or a failure.

Per-pass burndown semantics: the **alias** and **edge** cards SHALL reuse the hero's live unaudited counts and back-summed series (no re-query). The **edge** card SHALL additionally surface the one-shot replay's state from the un-replayed `edge_drop` backlog (a SQL-bounded probe re-validated by the replay's own selection predicate, display-capped): a pending count while drops await replay, and an explicit done-state at zero. The **sku-cache re-key** card (stampless) SHALL gauge its backlog as the live plan size — pending re-key groups plus eligible alias retargets from the pass's own pure planners over current resolver state — rendered with a capped overflow display (e.g. "200+") and never an unbounded number. The **disjunction-sweep** card SHALL show the live count of concrete disjunctive ids the sweep will actually flip/fold — the sweep's quiesce predicate mirrored at family level (human rows and human-pinned families excluded, bases merged elsewhere not counted), so the count reaches zero exactly when the sweep quiesces — burning to zero, with a trend back-summed from the normalize job's persisted `disjunction*` run counters and the latest run's counters as summary chips; it SHALL NOT alter the hero's or the Status row's converged semantics (those remain alias+edge only).

#### Scenario: Draining backlog renders as converging

- **WHEN** unaudited alias or edge rows remain
- **THEN** the Audits tab shows the live per-table counts with a falling burndown series and "draining" language, and each affected pass card shows its latest-run summary counts, its own remaining-backlog count and trend, and a converging-state chip

#### Scenario: Cleared backlog renders green, not dead

- **WHEN** both unaudited counts are zero
- **THEN** the hero renders the converged (green/positive) state with "holds at zero" language, and the pass cards whose backlog is zero render the converged (green positive) chip and zero-floor treatment

#### Scenario: A pass card carries its own burndown status

- **WHEN** a pass has remaining backlog (an unaudited alias/edge row backlog, or a non-empty sku live plan)
- **THEN** that pass's card shows the remaining count, a compact burndown sparkline of its recent trend, and the converging chip — while a sibling pass with zero backlog simultaneously shows the converged chip

#### Scenario: Edge card surfaces the replay state

- **WHEN** un-replayed pre-calibration `edge_drop` rows remain
- **THEN** the edge audit card shows the pending replay count (capped display); **WHEN** none remain **THEN** it shows the replay done-state

#### Scenario: Disjunction sweep card burns to zero

- **WHEN** live concrete disjunctive ids remain
- **THEN** the disjunction-sweep card shows the live count with converging language; **WHEN** the count is zero **THEN** the card renders the converged state with the normalize job's latest disjunction counters as chips

#### Scenario: A restoration links back to its origin decision

- **WHEN** an `edge_restore` log row carries a `replay_of` reference to the original `edge_drop` decision
- **THEN** the restorations log renders the restored edge with its verdict and a pointer to the origin decision id

### Requirement: Config area hosts an Ingest Keys editor

The admin **Config** area SHALL host an **Ingest Keys** editor (mutating via the existing typed `/admin/api/*` routes) for managing the home-network satellite ingest keys (`recipe-ingestion`). It SHALL list keys in a table — satellite label + key prefix, the key's **tenant binding** (a muted "operator-global" when unbound, else the bound member id), configured/observed sources, created, last-used (a muted "never" when unused), and status (`active`/`revoked`) — and provide a **Mint key** action that takes a label and an **optional tenant binding** and reveals the new secret **once** in a callout with a copy control and a "shown once — you won't see it again" warning, mirroring the invite-code flow (the row persists showing only the prefix; the secret is not stored). The Mint action's tenant-binding control SHALL default to **operator-global** (no binding) and SHALL offer the allowlisted members as bind targets; a binding SHALL be validated against the allowlist server-side (a non-allowlisted target mints nothing). Each active key SHALL have a **Revoke** action behind a destructive confirm. An empty roster SHALL render an explanatory empty state.

#### Scenario: Minting reveals the secret once

- **WHEN** the operator mints an ingest key with a label
- **THEN** the editor shows the full secret once in a copyable callout with a shown-once warning, and thereafter the row shows only the prefix

#### Scenario: Minting an operator-global key by default

- **WHEN** the operator mints an ingest key without choosing a tenant binding
- **THEN** the key is minted operator-global and the row shows a muted "operator-global" binding

#### Scenario: Minting a tenant-bound key

- **WHEN** the operator mints an ingest key and selects an allowlisted member as the binding
- **THEN** the key is minted bound to that member and the row shows that member as its tenant binding

#### Scenario: Revoke is confirmed and immediate

- **WHEN** the operator revokes a key and confirms the destructive dialog
- **THEN** the key's status becomes `revoked` and it can no longer authenticate a push or a pull-channel request

#### Scenario: Empty roster shows guidance

- **WHEN** no ingest keys exist
- **THEN** the editor shows an empty state explaining what a satellite is and how to mint the first key
