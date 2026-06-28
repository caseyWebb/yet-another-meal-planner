## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Operator re-probes mislabeled parked discovery rows

**Reason:** Superseded by real per-row retry. The `reprobe-parked` backfill re-fetched a parked row but imported nothing — on a now-acquirable page it rewrote `detail.reason` to `"ok"` while leaving `outcome = "error"`, producing the confusing "recovered but stuck parked" state. The new retry path re-fetches **and** re-runs the import pipeline, so a recovered candidate actually imports and that state no longer exists. The endpoint, its bounded legacy-`unreachable` scan, and its in-place `detail` rewrite are removed.

**Migration:** Operators drain legacy parked rows with the per-row **Retry now** action (or remove them with **Delete**) instead of the bulk re-probe button.

## ADDED Requirements

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
