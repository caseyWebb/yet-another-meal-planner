## ADDED Requirements

### Requirement: Logs area with a left submenu and a detail dialog

The admin SPA SHALL provide a top-level **Logs** area (a fourth area beside Status, Members, and Dev) for operator-auditable activity logs. The Logs area SHALL render a **left submenu** of log sources and, on the right, the entries for the selected source — the master/detail layout of the MCP-inspector tool console. Its first (and initially only) submenu item SHALL be **Discovery**, showing the background discovery sweep's per-candidate outcome log. The area SHALL be **extensible by adding a submenu item**, not by restructuring — a future log source becomes another entry in the left submenu. The Logs area and its submenu selection SHALL be client-routed (`/admin/logs` for the area, `/admin/logs/discovery` for the Discovery log) so a deep link or refresh loads the selected log directly. When an individual entry carries more than a row's worth of detail, the entry SHALL be expandable into a **dialog** showing its full detail (rather than inlining every field into the list).

The Logs surfaces SHALL be modeled per the panel's data-modeling standard: the loaded entries SHALL be `RemoteData` (the four-state load), the selected submenu item SHALL be a custom type (not a stringly-typed route), and the open-dialog state SHALL be modeled so "a dialog is open for entry X" cannot contradict the loaded list.

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

## MODIFIED Requirements

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin SPA SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Dev** area (the tool console and future developer surfaces), and a **Logs** area (operator-auditable activity logs, organized by a left submenu of log sources; see "Logs area with a left submenu and a detail dialog") — navigable by client-side routing so each surface has its own URL and a new surface is added as its own routed module rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at its own route (`/admin/members`), the tool console under `/admin/dev`, and the logs under `/admin/logs` (with the selected log source as a sub-route, e.g. `/admin/logs/discovery`), not at the panel root. Navigating between surfaces SHALL update the browser URL, and a deep link or refresh to a surface's URL SHALL load that surface directly.

#### Scenario: Navigation updates the URL

- **WHEN** the operator switches from one area to another (e.g. from Status to member management, to the tool console, or to the logs)
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
