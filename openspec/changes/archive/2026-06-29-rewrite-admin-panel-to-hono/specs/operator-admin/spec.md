## MODIFIED Requirements

### Requirement: Admin UI served as same-origin static assets

The admin UI SHALL be served by the Worker from the **same origin** as its `/admin/api/*` operations, so the browser makes no cross-origin request and the deployment needs no CORS configuration. The UI SHALL be a **Hono application** that **server-renders** its pages (HTML produced in the Worker via Hono JSX) and **hydrates** its interactive surfaces as **islands** — client bundles that attach to server-rendered markup. Both the server-render and the island bundles SHALL be served same-origin: the HTML from the Worker (worker-first on `/admin*`), the island bundles and other static files from the Worker's static-assets binding.

The island bundles and any static files SHALL be built from source by a **deterministic build script** (supporting a `--check` validate-only mode) into a **committed** output directory (`admin/dist/`), served via the static-assets binding; the generated bundle SHALL NOT be hand-edited. The build SHALL NOT depend on a network package registry being reachable, so any sandbox can rebuild it. The static-assets binding SHALL be carried through the operator config merge so it reaches every operator's deployment.

Because `/admin*` is routed worker-first, the Worker SHALL produce each in-app route's page server-side (it owns the routes under `/admin/*`), so a deep link or refresh to any admin route loads that surface directly. A GET for an `/admin/*` path that is neither an `/admin/api/*` route nor a real static asset SHALL be handled by the Hono app's page router (rendering that route's page), not by a redirect — so it does not re-enter the worker-first route and loop.

#### Scenario: UI and API share an origin (no CORS)

- **WHEN** an admin island calls an `/admin/api/*` route (or a page is server-rendered)
- **THEN** the call is same-origin and succeeds with no CORS preflight or `Access-Control-*` configuration

#### Scenario: Bundle is built from source, not hand-edited

- **WHEN** the admin UI changes
- **THEN** the change is made in the TypeScript UI source and the island bundle is rebuilt by the build script (verifiable with `--check`), and the committed bundle is not edited by hand

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

The admin panel SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Logs** area (operator-auditable activity logs, organized by a left submenu of log sources), a **Config** area (the discovery calibration console and the shared-corpus editors, as routed sub-views), and a **Data** area (the read-only data explorer over D1 and the R2 corpus — see the operator-data-explorer capability) — each with its own URL, so a new surface is added as its own routed page rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at `/admin/members`, the logs under `/admin/logs` (with the selected source as a sub-route, e.g. `/admin/logs/discovery`), configuration under `/admin/config` (with the selected sub-view as a sub-route, e.g. `/admin/config/feeds`), and the data explorer under `/admin/data/*`, not at the panel root.

Each area's page SHALL be **server-rendered** for its URL, and its interactive controls SHALL be hydrated as islands. Navigating to a surface SHALL load that surface (server-rendered) at its own URL, and a deep link or refresh to a surface's URL SHALL load that surface directly. Within a hydrated surface, an interaction (e.g. opening a detail dialog, editing a config form) MAY update state client-side without a full navigation.

#### Scenario: Each surface has its own URL

- **WHEN** the operator opens a different area (e.g. Status, member management, the logs, or config)
- **THEN** the browser URL is that surface's route and the surface renders for that URL

#### Scenario: Home route shows the Status view

- **WHEN** the operator opens `/admin` (or `/`)
- **THEN** the Status (background-job health) view renders as the home surface, not member management

#### Scenario: Deep link to a log

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker server-renders the Logs area with the Discovery log selected

#### Scenario: Deep link to a config sub-view

- **WHEN** the operator opens a config editor route such as `/admin/config/feeds` directly (or refreshes there)
- **THEN** the Worker server-renders the Config area with that shared-corpus editor selected

#### Scenario: Deep link to a data view

- **WHEN** the operator opens a data-explorer route such as `/admin/data/recipes/<slug>` directly (or refreshes there)
- **THEN** the Worker server-renders that data view

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Operator tool console lists the live MCP tool surface

**Reason**: The Dev → Tool Console (MCP inspector) is dropped in the Hono rewrite — dedicated external MCP-inspector tooling covers this need better, and the in-panel console did not earn its keep. The `/admin/dev/*` area is not ported; the `GET /admin/api/tools` route is removed at cutover.

### Requirement: Operator tool console invokes a tool as a chosen tenant

**Reason**: Part of the dropped Dev → Tool Console area. The `POST /admin/api/tools/<name>` invoke route is removed at cutover.

### Requirement: Tool invocation identity is operator-driven under Access

**Reason**: Part of the dropped Dev → Tool Console area (governed tool invocation as a chosen tenant); no longer applicable with the console removed.

### Requirement: The dev workbench shows and guards the acting persona

**Reason**: The acting-persona workbench was a Tool Console concern; dropped with the area.

### Requirement: The tool console seeds arguments with a schema-derived example and tolerates comments

**Reason**: The schema-derived example generator + JSONC argument tolerance were Tool Console UI; dropped with the area.
