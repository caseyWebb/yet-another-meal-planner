## MODIFIED Requirements

### Requirement: Logs area with a left submenu and a detail dialog

The admin SPA SHALL provide a top-level **Logs** area (a fourth area beside Status, Members, and Dev) for operator-auditable activity logs. The Logs area SHALL render a **left submenu** of log sources and, on the right, the entries for the selected source — the master/detail layout of the MCP-inspector tool console. Its first (and initially only) submenu item SHALL be **Discovery**, showing the background discovery sweep's per-candidate outcome log. The area SHALL be **extensible by adding a submenu item**, not by restructuring — a future log source becomes another entry in the left submenu. The Logs area and its submenu selection SHALL be client-routed (`/admin/logs` for the area, `/admin/logs/discovery` for the Discovery log) so a deep link or refresh loads the selected log directly. When an individual entry carries more than a row's worth of detail, the entry SHALL be expandable into a **dialog** showing its full detail (rather than inlining every field into the list).

The Discovery log view SHALL provide an operator **re-probe** action that invokes the `reprobe-parked` backfill (`POST /admin/api/discovery/reprobe-parked`, see the re-probe requirement) and renders the returned summary (rows scanned, reclassified, still-unreachable, now-acquirable). On success the view SHALL reload the log so the re-classified `detail.reason`s are reflected immediately. The action SHALL be one-at-a-time (disabled while a re-probe is in flight).

The Logs surfaces SHALL be modeled per the panel's data-modeling standard: the loaded entries SHALL be `RemoteData` (the four-state load), the selected submenu item SHALL be a custom type (not a stringly-typed route), and the open-dialog state SHALL be modeled so "a dialog is open for entry X" cannot contradict the loaded list. The re-probe action's in-flight state, its result summary, and its failure SHALL likewise be one custom type (never a `Bool` busy flag beside a `Maybe` error), distinct from the log's load state.

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

#### Scenario: Operator re-probes parked rows from the Discovery log

- **WHEN** the operator activates the re-probe action in the Discovery log view
- **THEN** the app POSTs `reprobe-parked`, shows the returned summary (scanned / reclassified / still-unreachable / now-acquirable), and reloads the log so the re-classified reasons appear

#### Scenario: The re-probe action is one-at-a-time

- **WHEN** a re-probe is already in flight
- **THEN** the action is disabled so a second overlapping re-probe cannot be started
