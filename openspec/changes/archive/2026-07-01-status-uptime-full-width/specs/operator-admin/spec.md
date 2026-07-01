## MODIFIED Requirements

### Requirement: Status job rows show run-history uptime and current-state-since

Each background-job row in the Status area SHALL render, in addition to the job's state glyph, name, last-run age, status badge, and summary-count chips, a **run-history uptime sparkline** and a **current-state-since** label, derived from the `job_runs` history (see background-job-health). The sparkline SHALL show the job's recent runs oldest→newest as per-run **ok/fail** bars with a **% uptime** label over that window; the since-label SHALL read **"Healthy since"** when the job's current state is ok and **"Unhealthy since"** when it is failing, with the streak-start instant from the reader.

The sparkline SHALL **span the full width of the job row's body** (its "Run history … % uptime" head and its "OLDER"/"NOW" axis aligning with the track's edges), not a fixed-width band pinned to one side. The track SHALL render a **fixed number of slots** equal to the run-history window; when the job has **fewer** real runs than the window, the missing older slots SHALL be padded with non-interactive **placeholder (ghost) bars** on the older (left) side so the track fills the width at any population and the newest real run stays anchored at the right (NOW) edge. Placeholder bars SHALL be visually distinct from ok/fail bars, SHALL carry no run and no hover tooltip, and SHALL NOT be counted in the **% uptime** or run-count labels (both reflect real runs only).

A job with no run history yet SHALL render without a sparkline rather than an empty or broken one (a zero-run job is not rendered as an all-ghost track).

#### Scenario: A job row shows its uptime sparkline and uptime percentage

- **WHEN** the Status area renders a job that has run history
- **THEN** that job's row shows a sparkline of its recent runs as ok/fail bars and a % uptime label over that window

#### Scenario: The sparkline fills the row width

- **WHEN** the Status area renders a job whose run history fills the window
- **THEN** the sparkline track spans the full width of the job row's body, with its "Run history"/"% uptime" head and its OLDER/NOW axis aligned to the track's edges rather than a narrow band offset to one side

#### Scenario: An under-populated history is padded with ghost slots, newest-anchored

- **WHEN** the Status area renders a job that has some run history but fewer runs than the window
- **THEN** the track still fills the row width, showing the real runs as ok/fail bars anchored at the right (NOW) edge and the missing older slots as non-interactive placeholder bars, and the % uptime and run-count labels count only the real runs

#### Scenario: A job row shows healthy-since or unhealthy-since

- **WHEN** a job's current state is ok (or failing)
- **THEN** its row shows "Healthy since" (or "Unhealthy since") with the start instant of the current streak

#### Scenario: A job with no run history omits the sparkline

- **WHEN** the Status area renders a job that has no `job_runs` records yet
- **THEN** that job's row renders without a sparkline, not an empty or broken one

### Requirement: A Status sparkline tick deep-links to its Logs entry

Each bar representing a **real run** in the Status area's per-job uptime sparkline SHALL be a link carrying that run's id to the Logs area (e.g. `/admin/logs?run=<id>`). Placeholder (ghost) slots represent no run and SHALL NOT be links. Opening a real-run link SHALL render the all-jobs run log filtered to the linked run's job, scrolled/paged to the run's entry, with that entry pre-expanded and visually highlighted so the operator can identify it among the list without searching.

When the linked run id no longer exists in `job_runs` (pruned by the retention cap since the link was rendered), the Logs area SHALL fall back to its default unfiltered, first-page view rather than showing an error.

#### Scenario: Clicking a sparkline tick opens its run, highlighted

- **WHEN** the operator clicks a bar in a job's Status uptime sparkline
- **THEN** `/admin/logs` opens filtered to that job, on the page containing the linked run, with that run's entry expanded and highlighted

#### Scenario: A ghost slot is not a link

- **WHEN** the operator's pointer is over a placeholder (ghost) slot in a job's Status uptime sparkline
- **THEN** it carries no run link and no tooltip, and activating it does not navigate to the Logs area

#### Scenario: A pruned run id degrades to the default view

- **WHEN** the operator opens a Logs deep-link whose run id is no longer present in `job_runs`
- **THEN** the Logs area renders its default unfiltered, first-page view instead of an error
