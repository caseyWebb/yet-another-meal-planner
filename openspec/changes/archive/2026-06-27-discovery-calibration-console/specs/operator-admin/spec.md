## ADDED Requirements

### Requirement: Config area hosts the discovery calibration console

The admin SPA SHALL provide a top-level **Config** area (routed at `/admin/config`) hosting the discovery calibration console: the sweep's tunable knobs (τ, triage threshold, δ, classify cap, rate cap) as a form, an **Analyze** action and a **Dry-run** action, and a results panel — laid out so the projected effect of the current knob values is visible on the **same screen** before the operator saves. Editing a knob and running Analyze/Dry-run SHALL NOT persist anything; only an explicit Save writes the config. The form SHALL show the projected effect (the Analyze/Dry-run results) before Save, and a value past a hard floor SHALL require an explicit confirmation step in the UI (mirroring the server-side guard). The surfaces SHALL be modeled per `admin/CLAUDE.md`: the loaded config and the Analyze/Dry-run results as `RemoteData`, and a dirty-vs-saved form state as a custom type (so "unsaved edits" cannot be confused with "saved").

#### Scenario: Operator previews then saves a knob change

- **WHEN** the operator opens `/admin/config`, changes τ, and runs Analyze
- **THEN** the projected per-member match counts render without persisting anything, and the new τ is stored only when the operator explicitly Saves

#### Scenario: A floor-breaching value requires confirmation in the UI

- **WHEN** the operator drags τ below the hard floor and tries to Save
- **THEN** the console requires an explicit confirmation before sending the write

#### Scenario: Config area deep-links

- **WHEN** the operator opens `/admin/config` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Config area

### Requirement: Discovery calibration endpoints served cross-tenant under Access

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured): `GET /admin/api/discovery/config` (the current merged knobs), `PUT /admin/api/discovery/config` (write the operator overrides, with the footgun-floor guard and range validation enforced server-side), `POST /admin/api/discovery/analyze` (the cheap no-AI δ/τ analysis at given knob values), and `POST /admin/api/discovery/dry-run` (the no-write full-pipeline preview). These are operator/cross-tenant operations (they read all members to set a global knob) and SHALL NOT be exposed as MCP tools.

#### Scenario: Analyze and dry-run are reachable only under Access

- **WHEN** Access is configured and an authenticated operator calls `POST /admin/api/discovery/analyze`
- **THEN** the analysis is returned; and when Access is unconfigured the endpoint responds `404` like the rest of `/admin*`

#### Scenario: A config write past a floor is rejected without confirm

- **WHEN** `PUT /admin/api/discovery/config` sends a below-floor τ without the explicit-confirm flag
- **THEN** the endpoint returns a structured error and writes nothing

## MODIFIED Requirements

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin SPA SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Dev** area (the tool console and future developer surfaces), a **Logs** area (operator-auditable activity logs, organized by a left submenu of log sources; see "Logs area with a left submenu and a detail dialog"), and a **Config** area (operator-editable configuration; its first occupant is the discovery calibration console — see "Config area hosts the discovery calibration console") — navigable by client-side routing so each surface has its own URL and a new surface is added as its own routed module rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at its own route (`/admin/members`), the tool console under `/admin/dev`, the logs under `/admin/logs` (with the selected log source as a sub-route, e.g. `/admin/logs/discovery`), and configuration under `/admin/config`, not at the panel root. Navigating between surfaces SHALL update the browser URL, and a deep link or refresh to a surface's URL SHALL load that surface directly.

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
- **THEN** the Worker serves the SPA shell and the app routes to the Config area
