## ADDED Requirements

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

## MODIFIED Requirements

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
