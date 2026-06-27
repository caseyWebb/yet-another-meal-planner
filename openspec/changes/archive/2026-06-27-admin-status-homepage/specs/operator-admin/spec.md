## ADDED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: Admin panel is organized into Admin and Dev areas with client-side routing`
- TO: `### Requirement: Admin panel is organized into top-level areas with client-side routing`

## MODIFIED Requirements

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin SPA SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), and a **Dev** area (the tool console and future developer surfaces) — navigable by client-side routing so each surface has its own URL and a new surface is added as its own routed module rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at its own route (`/admin/members`), not at the panel root. Navigating between surfaces SHALL update the browser URL, and a deep link or refresh to a surface's URL SHALL load that surface directly.

#### Scenario: Navigation updates the URL

- **WHEN** the operator switches from one area to another (e.g. from Status to member management, or to the tool console)
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
