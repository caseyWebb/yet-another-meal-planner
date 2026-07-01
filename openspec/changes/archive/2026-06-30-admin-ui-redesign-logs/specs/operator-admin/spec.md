## MODIFIED Requirements

### Requirement: Logs area with a left submenu and a detail dialog

The admin panel SHALL provide a top-level **Logs** area, server-rendered, whose default content (the bare `/admin/logs` route) is the **all-cron-jobs run log**: a filterable, paginated list of individual `job_runs` records across every registered background job (see "Logs area shows the all-jobs run log" below). The Logs area SHALL remain extensible by submenu: its second destination is the existing per-candidate **Discovery** log at `/admin/logs/discovery`, showing the background discovery sweep's per-candidate outcome log exactly as before. The two destinations SHALL be reachable from the area without restructuring when a future log source is added (a future source becomes another submenu destination, not a rework of the run-log view).

When an individual run-log entry expands to more than a row's worth of detail, it SHALL render inline (the summary key/value detail), not in a separate dialog; the Discovery log's per-candidate entries SHALL continue to use the existing detail **dialog** for their full detail (attribution, matched recipe, validation failure), unchanged from today.

The Discovery log view SHALL provide, for each retryable parked entry (outcome `error` or `failed`), a per-row **Retry now** action that invokes the single-row retry endpoint (`POST /admin/api/discovery/:id/retry`) and a per-row **Delete** action that invokes the delete endpoint (`DELETE /admin/api/discovery/:id`). On a successful Retry or Delete the view SHALL reload the log so the resolved (or removed) row is reflected immediately. Each action SHALL be one-at-a-time (the affected row's action is disabled while its request is in flight). The view SHALL NOT offer the removed bulk re-probe action.

The Discovery log's loaded entries, its row-action in-flight state, and its open-dialog state SHALL remain modeled per the panel's data-modeling standard (`admin/CLAUDE.md`): the per-row action's in-flight state — which row is acting, which action, and its failure — SHALL be one custom type, distinct from the log's load state.

#### Scenario: Logs area shows the all-jobs run log by default

- **WHEN** the operator opens `/admin/logs`
- **THEN** the area renders the all-jobs run log (entries across every registered background job, newest-first), not the Discovery candidate log

#### Scenario: A log source is reachable by deep link

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker server-renders the Logs area with the Discovery candidate log, unchanged from today's content and actions

#### Scenario: Entry detail expands inline for a run, opens a dialog for a Discovery candidate

- **WHEN** the operator expands a run-log entry on `/admin/logs`
- **THEN** its `job_health`-shaped summary (and, on failure, its error) renders inline beneath the entry, without a dialog

- **WHEN** the operator activates a Discovery log entry that has expandable detail (e.g. an import's attribution, or a parked error's validation failure)
- **THEN** the app opens a dialog showing that entry's full detail and the list stays intact behind it

#### Scenario: A new log source is added as a submenu destination

- **WHEN** a future log source is introduced
- **THEN** it appears as an additional Logs destination without restructuring the all-jobs run-log view or the Discovery log

#### Scenario: Operator retries a parked row from the Discovery log

- **WHEN** the operator activates **Retry now** on a parked `error`/`failed` row
- **THEN** the app POSTs `/admin/api/discovery/:id/retry`, and on success reloads the log so the row's resolved outcome (e.g. `imported`, or a fresh failure with an advanced retry schedule) appears

#### Scenario: Operator deletes a discovery from the log

- **WHEN** the operator activates **Delete** on a discovery row
- **THEN** the app sends `DELETE /admin/api/discovery/:id`, and on success reloads the log with that row gone

#### Scenario: A per-row action is one-at-a-time

- **WHEN** a row's Retry or Delete request is already in flight
- **THEN** that row's actions are disabled so a second overlapping request for the row cannot be started

## ADDED Requirements

### Requirement: Logs area shows the all-jobs run log

The Logs area's default view SHALL render every registered background job's run history (`job_runs`, via the `background-job-health` capability) as one merged, newest-first list, bounded to a fixed page size. The view SHALL provide:

- A **job filter** as a row of pills — "All jobs" plus one pill per registered job name (`HEALTH_JOBS`) — selecting which job's runs are shown; the currently selected pill SHALL be visually distinct.
- A **hint line** reporting the count of runs shown under the current filter, split into ok vs. failed counts.
- One **entry per run**, showing: a status dot (ok/fail), the job's name (with its icon), an ok/failed label, the run's relative age, and its duration.
- **Pagination** over the filtered list, with a fixed page size, when the filtered count exceeds one page.
- Each entry SHALL be **expandable** to show its stored `summary` (the same tenant-clean counts the job upserts to `job_health`) rendered as key/value pairs, and, when the run failed, the run's error.

The view SHALL be server-rendered (no client island): the job filter and the page SHALL be expressed in the route (query parameters and/or a job sub-route), so each filter/page combination is independently navigable and deep-linkable; per-entry expand/collapse SHALL require no server round-trip and no client-side JavaScript bundle (e.g. a native disclosure element).

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
- **THEN** the entry's stored `summary` renders as key/value detail beneath it, without navigating away from the list

#### Scenario: Expanding a failed run shows its error

- **WHEN** the operator expands a run entry whose outcome was a failure
- **THEN** the expanded detail includes the run's error alongside its summary

#### Scenario: Pagination is filter-aware

- **WHEN** the filtered run count exceeds one page
- **THEN** pagination controls let the operator move between pages of the current filter, and changing the filter resets to the first page

#### Scenario: A discovery-sweep run links to the candidate-level Discovery log

- **WHEN** the operator expands a `discovery-sweep` run entry
- **THEN** the expanded detail includes a link to `/admin/logs/discovery` for per-candidate detail, since the run's summary carries only sweep-tick counts, not individual candidates

### Requirement: A Status sparkline tick deep-links to its Logs entry

Each bar in the Status area's per-job uptime sparkline SHALL be a link carrying that run's id to the Logs area (e.g. `/admin/logs?run=<id>`). Opening that link SHALL render the all-jobs run log filtered to the linked run's job, scrolled/paged to the run's entry, with that entry pre-expanded and visually highlighted so the operator can identify it among the list without searching.

When the linked run id no longer exists in `job_runs` (pruned by the retention cap since the link was rendered), the Logs area SHALL fall back to its default unfiltered, first-page view rather than showing an error.

#### Scenario: Clicking a sparkline tick opens its run, highlighted

- **WHEN** the operator clicks a bar in a job's Status uptime sparkline
- **THEN** `/admin/logs` opens filtered to that job, on the page containing the linked run, with that run's entry expanded and highlighted

#### Scenario: A pruned run id degrades to the default view

- **WHEN** the operator opens a Logs deep-link whose run id is no longer present in `job_runs`
- **THEN** the Logs area renders its default unfiltered, first-page view instead of an error
