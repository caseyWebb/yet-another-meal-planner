## MODIFIED Requirements

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin panel SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Data** area (the read-only data explorer over D1 and the R2 corpus, narrowed to its **Recipes / Stores / Guidance** sub-nav — see the operator-data-explorer capability), a **Usage** area (the usage-observability dashboards), a **Discovery** area (the autonomous candidate-pipeline view), a **Logs** area (operator-auditable activity logs, organized by a left submenu of log sources), and a **Config** area (the discovery calibration console and the shared-corpus editors, as routed sub-views) — each with its own URL, so a new surface is added as its own routed page rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at `/admin/members`, the data explorer under `/admin/data/*` (its sub-nav destinations being Recipes, Stores, and Guidance), the usage dashboards at `/admin/usage`, the discovery view at `/admin/discovery`, the logs under `/admin/logs` (with the selected source as a sub-route, e.g. `/admin/logs/discovery`), and configuration under `/admin/config` (with the selected sub-view as a sub-route, e.g. `/admin/config/feeds`), not at the panel root.

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

#### Scenario: Data area sub-nav is narrowed to Recipes, Stores, and Guidance

- **WHEN** the operator opens `/admin/data` (or any `/admin/data/*` route)
- **THEN** the Data area's sub-nav offers exactly Recipes, Stores, and Guidance — not the prior generic Members/Corpus/Discovery/System tabs
