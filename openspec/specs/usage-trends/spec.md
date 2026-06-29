# usage-trends Specification

## Purpose

The per-run **history** tier for the background jobs, complementing the `job_health` D1 liveness row and the account-level usage snapshot (`usage-observability`). Each registered background job emits one tenant-clean Analytics Engine data point per run (job, outcome, duration, summary counts) at zero KV/D1 cost, and the operator Usage page reads them back as a per-job trends view via the Analytics Engine SQL API — surfacing per-job attribution and history that Cloudflare's account-level analytics (aggregated by namespace/model) cannot show.

## Requirements

### Requirement: Background jobs emit per-run usage data points

Each registered background job (the cron-`scheduled` jobs and the inbound `email` handler) SHALL emit, on every run, **one tenant-clean data point** to a Workers Analytics Engine dataset (binding `USAGE_AE`), carrying the job name, the run outcome, the run duration, and the job's own summary counts. The emission SHALL be **best-effort** — a failed or unconfigured `writeDataPoint` SHALL NOT change the job's outcome (it is swallowed like the optional ntfy push) — and SHALL be **additive** to the job's existing `job_health` row, not a replacement (liveness stays in D1). The data point SHALL be **tenant-data-free** by construction: job name, outcome, durations, and counts only, never a username, tenant id, or other per-tenant identifier. AE `writeDataPoint` SHALL consume neither the KV nor the D1 operation budget. The dataset's blob/double **slot layout is positional and a documented contract** (`docs/SCHEMAS.md`); a later change SHALL NOT reorder existing slots.

#### Scenario: A completed run emits a tenant-clean data point

- **WHEN** a registered background job finishes a run (success or failure)
- **THEN** it writes one AE data point carrying the job name, outcome, duration, and counts — and no per-tenant identifier — in addition to upserting its `job_health` row

#### Scenario: Emission never affects the job

- **WHEN** the AE binding is absent or `writeDataPoint` throws
- **THEN** the job's outcome is unchanged (the emission is a swallowed no-op) and the run completes exactly as it would without AE

#### Scenario: Emission consumes no KV or D1 budget

- **WHEN** a job emits its usage data point
- **THEN** the write goes only to Analytics Engine and performs no KV or D1 operation

### Requirement: The Analytics Engine binding propagates to every operator

The Analytics Engine dataset is a binding **type** the deploy config merge does not handle by default. The merge (`scripts/merge-wrangler-config.mjs`) SHALL include `analytics_engine_datasets` in its allowlist so the binding propagates **verbatim from code** to every operator's deployed config (it carries no operator-owned id, like the `ai`/`assets`/`r2_buckets` bindings). A regression test SHALL assert the binding type survives the merge, guarding the silent-drop trap.

#### Scenario: The AE binding survives the config merge

- **WHEN** the deploy merges the code config with an operator's config
- **THEN** the merged config retains the `analytics_engine_datasets` binding from code

#### Scenario: A missing allowlist entry is caught by a test

- **WHEN** the `analytics_engine_datasets` allowlist entry is absent from the merge
- **THEN** the merge-config test fails (the binding would otherwise be silently dropped from operators' deploys)

### Requirement: Operator usage trends view

The Worker SHALL serve a per-job **usage trends** view on the Usage page (`/admin/usage`), backed by `GET /admin/api/usage/trends`, reporting each background job's run metrics (at minimum run count and duration; throughput counts where available) **over a recent window of days**. The endpoint SHALL source the series from the **Analytics Engine SQL API** (`/accounts/<id>/analytics_engine/sql`, reusing `CF_ACCOUNT_ID` and the analytics token) via an outbound request that performs **no KV or D1 operation**. It SHALL be **aggregate-only and tenant-data-free** (per-job/per-day aggregates, never per-tenant rows) and inherit the `/admin*` Cloudflare Access gate.

#### Scenario: Configured trends view reports per-job series

- **WHEN** the operator opens the Usage page's trends panel with `CF_ACCOUNT_ID` and the analytics token configured
- **THEN** it shows each job's recent-window run metrics (counts/durations) per day, sourced from the AE SQL API, with no per-tenant data

#### Scenario: Serving trends performs no KV or D1 operation

- **WHEN** `GET /admin/api/usage/trends` handles a request
- **THEN** it reaches only the Analytics Engine SQL API and performs no KV or D1 operation

### Requirement: Usage trends degrade gracefully when unconfigured

The trends view SHALL be **opt-in**, reusing the usage-observability config (`CF_ACCOUNT_ID` + the read-only analytics token). When either is unset, `GET /admin/api/usage/trends` SHALL report an explicit not-configured result without making a request, and the panel SHALL render an explicit "trends not available" state rather than an error — mirroring the Usage page's existing not-configured handling. A SQL/transport failure SHALL surface as `upstream_unavailable`.

#### Scenario: Unconfigured analytics renders a not-available state

- **WHEN** the operator opens the trends panel with the analytics token (or account id) unset
- **THEN** `GET /admin/api/usage/trends` reports a not-configured result and the panel renders an explicit "trends not available" state, making no request

#### Scenario: A query failure is a structured upstream error

- **WHEN** the AE SQL request fails or returns an error
- **THEN** `GET /admin/api/usage/trends` responds with an `upstream_unavailable` error rather than throwing

### Requirement: Configured trends requests reach the Analytics Engine without a runtime binding error

The `GET /admin/api/usage/trends` egress SHALL invoke the global `fetch` such that the runtime does not reject it for an incorrect `this` reference. With `CF_ACCOUNT_ID` and the analytics token configured and the Analytics Engine SQL API reachable, the endpoint SHALL return the per-job series rather than failing with an `upstream_unavailable` error caused by an "Illegal invocation". The default `fetch` implementation the endpoint uses SHALL remain callable when detached from any owning object, covered by the same regression guard as the snapshot surface.

#### Scenario: Configured trends succeed rather than failing with a binding error

- **WHEN** `GET /admin/api/usage/trends` runs on a deployment with `CF_ACCOUNT_ID` and the analytics token set and the AE SQL API reachable
- **THEN** the outbound `fetch` is invoked with a correct `this` binding and the endpoint returns the per-job series, not an `upstream_unavailable` error caused by an "Illegal invocation"

### Requirement: The trends panel surfaces upstream failure detail

When `GET /admin/api/usage/trends` returns its `upstream_unavailable` error, the trends panel SHALL render the upstream `message` together with the error code rather than a bare HTTP status. The panel SHALL decode the `{ error, message }` body into a typed error carried in the failed state — not an untyped string or a discarded status. This surface is admin-only behind the `/admin*` Access gate, so it MAY include full upstream error detail.

#### Scenario: An upstream failure shows its detail in the trends panel

- **WHEN** `GET /admin/api/usage/trends` responds non-2xx with a JSON body `{ error, message }`
- **THEN** the trends panel renders the `message` and the `error` code, not a bare "HTTP 500"
