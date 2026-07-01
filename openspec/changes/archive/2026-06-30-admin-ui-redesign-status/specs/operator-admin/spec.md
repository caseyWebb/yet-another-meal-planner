## ADDED Requirements

### Requirement: Status area shows corpus stat tiles

The Status area SHALL render a row of page-level **corpus stat tiles** above the service-health detail, each a labelled count read from a small operational corpus-counts reader: **Recipes** (indexed recipe count), **Members** (allowlisted member count), **RSS feeds** (discovery feed count), and **Cached SKUs** (sku-cache row count). The tiles SHALL carry no per-tenant data — only aggregate counts. The **Recipes** and **Members** tiles SHALL link to their respective areas (`/admin/data` and `/admin/members`); the remaining tiles are non-navigating.

#### Scenario: Stat tiles render aggregate counts

- **WHEN** the operator opens the Status area
- **THEN** a row of stat tiles shows the recipe, member, RSS-feed, and cached-SKU counts, with no per-tenant data

#### Scenario: Recipe and member tiles navigate

- **WHEN** the operator activates the Recipes or Members stat tile
- **THEN** the browser navigates to the Data area or the Members area respectively

### Requirement: Status job rows show run-history uptime and current-state-since

Each background-job row in the Status area SHALL render, in addition to the job's state glyph, name, last-run age, status badge, and summary-count chips, a **run-history uptime sparkline** and a **current-state-since** label, derived from the `job_runs` history (see background-job-health). The sparkline SHALL show the job's recent runs oldest→newest as per-run **ok/fail** bars with a **% uptime** label over that window; the since-label SHALL read **"Healthy since"** when the job's current state is ok and **"Unhealthy since"** when it is failing, with the streak-start instant from the reader. A job with no run history yet SHALL render without a sparkline rather than an empty or broken one.

#### Scenario: A job row shows its uptime sparkline and uptime percentage

- **WHEN** the Status area renders a job that has run history
- **THEN** that job's row shows a sparkline of its recent runs as ok/fail bars and a % uptime label over that window

#### Scenario: A job row shows healthy-since or unhealthy-since

- **WHEN** a job's current state is ok (or failing)
- **THEN** its row shows "Healthy since" (or "Unhealthy since") with the start instant of the current streak

#### Scenario: A job with no run history omits the sparkline

- **WHEN** the Status area renders a job that has no `job_runs` records yet
- **THEN** that job's row renders without a sparkline, not an empty or broken one

### Requirement: Status dependencies render as a distinct group

The Status area SHALL present the live dependencies — the **D1 reachability** probe and the **admin gate** posture — as their own item group, visually distinct from the background-jobs group, each showing the dependency name, a state indicator, and its state word (e.g. `reachable`/`unreachable`, the gate's `gated`/`exposed`/`dev bypass`/`disabled`). The exposed-gate prominent warning (per the relocated Status health requirement) is unchanged.

#### Scenario: Dependencies are grouped separately from jobs

- **WHEN** the operator opens the Status area
- **THEN** the D1 probe and admin-gate posture appear in a "Dependencies" group separate from the background-jobs list, each with its state word
