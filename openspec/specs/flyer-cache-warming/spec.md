# flyer-cache-warming Specification

## Purpose
TBD - created by archiving change warm-flyer-cache. Update Purpose after archive.
## Requirements
### Requirement: Scheduled per-location flyer warm

The system SHALL warm a per-location synthesized-flyer cache via a **single** Cloudflare Cron Trigger. On each tick the warm SHALL process the next bounded batch of **scan units** (a `locationId` × broad-term pair, paginated), where the batch size is chosen so a single invocation stays within the free-tier per-invocation limits — at most 50 external subrequests and the free-tier CPU budget. The warm SHALL persist progress in a KV cursor and advance it by the batch each tick, so the **total** number of scan units is not bounded by any single invocation's limit. Each batch's results SHALL be written into the materialized per-location rollup. Because batches run on separate ticks minutes apart, the warm SHALL be inherently gentle on the upstream Kroger API.

#### Scenario: A tick processes a bounded batch under the cap

- **WHEN** a warm tick runs with scan units remaining
- **THEN** it processes at most the configured batch size of Kroger scans, staying under the free-tier 50-external-subrequest and CPU caps, writes the resulting rollup data, and advances the cursor

#### Scenario: Large term sets span multiple ticks

- **WHEN** the unit list exceeds one batch (many locations and/or many broad terms)
- **THEN** successive ticks each process the next batch until the sweep is complete, with no single invocation exceeding the per-invocation caps

### Requirement: Idle no-op and refresh re-arm

When a sweep has processed all units, subsequent ticks SHALL no-op — a cheap cursor read with no external subrequests and no KV writes — until the refresh window is due. When the refresh window has elapsed since the last completed sweep, the warm SHALL reset the cursor, rebuild the plan, and begin a new sweep. The refresh cadence SHALL default to daily (tunable), aligned to Kroger's weekly promotion cycle.

#### Scenario: Completed sweep idles cheaply

- **WHEN** a tick runs after the sweep is complete and the refresh window is not yet due
- **THEN** it reads the cursor, observes completion, and returns without issuing external subrequests or KV writes

#### Scenario: Refresh window re-arms the sweep

- **WHEN** a tick runs after the refresh window has elapsed since the last completed sweep
- **THEN** it resets the cursor, rebuilds the plan from the live tenant directory and the D1 `flyer_terms` table, and begins a fresh sweep

### Requirement: Sweep plan built once per sweep and persisted

At the start of each sweep the warm SHALL build the unit list — the distinct set of `locationId`s resolved from the union of all tenants' `preferred_location`s, crossed with the broad terms from the D1 `flyer_terms` table — performing the tenant-directory, D1, and config reads **once**, and SHALL persist that plan in KV. Subsequent ticks within the sweep SHALL read the plan from KV (a Cloudflare-services read, not an external subrequest), so per-tick external budget is spent only on Kroger scans rather than on re-enumerating the plan.

#### Scenario: Tenant directory read once per sweep

- **WHEN** a sweep begins
- **THEN** the tenant directory, D1 `stores` table, and D1 `flyer_terms` table are read once to build the plan, which is persisted in KV, and later ticks in the same sweep read the plan from KV without re-reading those sources

### Requirement: Per-location rollup shared across same-store tenants

The warm SHALL key each rollup by `locationId` (`flyer:{locationId}`), so tenants at the same store share one rollup and tenants at different stores each get an independent rollup. The cache SHALL contain only public-derived store-wide sale data, never tenant-private state. Each rollup SHALL store the products passing the noise floor with raw `regular`/`promo` preserved and the `matched_terms` that surfaced each, and SHALL record the sweep's completion timestamp exposed to readers as `as_of`.

#### Scenario: Same store, multiple tenants share a rollup

- **WHEN** two tenants resolve to the same `locationId`
- **THEN** both `kroger_flyer` reads are served by the single `flyer:{locationId}` rollup

#### Scenario: Different stores get independent rollups

- **WHEN** two tenants resolve to different `locationId`s (e.g. different Kroger stores)
- **THEN** each store is swept independently into its own `flyer:{locationId}` rollup with its own `as_of`

### Requirement: Sweep observability and resumable failure

Each completed sweep SHALL emit a single structured log line (matching the inbound-email handler precedent) recording at least the locations swept, the number of units processed, and any errors. A tick that fails partway through its batch SHALL NOT advance the cursor past unwritten work, so the next tick resumes from the last durably-recorded position; rollup writes SHALL be idempotent so re-processing a unit is safe.

#### Scenario: One structured log line per sweep

- **WHEN** a sweep completes
- **THEN** the warm emits a single structured log line summarizing the sweep (locations, units processed, errors)

#### Scenario: Failed tick resumes without loss or duplication

- **WHEN** a tick fails partway through its batch
- **THEN** the cursor is not advanced past unwritten units, and the next tick resumes from the last recorded position, with idempotent rollup writes making any re-processing safe

