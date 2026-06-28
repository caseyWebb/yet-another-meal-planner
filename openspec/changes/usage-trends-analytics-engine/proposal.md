## Why

The `usage-observability` Usage page shows **today's account-level snapshot** (KV ops by namespace, neurons by model) — but it can't show **history** ("neurons/day over the last month", "is my KV write load trending up?") and can't **attribute work to a job** (the account API reports neurons *by model* and ops *by namespace*, never *which cron job* spent them). Workers Analytics Engine is Cloudflare's first-class telemetry store for exactly this: cheap per-run data points, queryable as a time-series, at **zero KV/D1 budget** cost. This is the follow-up scoped in the usage-observability design's "Future" section.

## What Changes

- **A Workers Analytics Engine dataset binding** (`USAGE_AE`). Each registered background job emits **one tenant-clean data point per run** — `blobs: [job, ok|fail]`, `doubles: [duration_ms, …summary counts]`, `indexes: [job]` — **additive** to the D1 `job_health` liveness row and **best-effort** (a failed `writeDataPoint` never affects the job, like the ntfy push). AE writes are non-blocking and touch neither the KV nor D1 budget.
- **`scripts/merge-wrangler-config.mjs` gains `analytics_engine_datasets`** in its allowlist. This is a **new binding type**; like `ai`/`assets`/`r2_buckets` it carries no operator-owned id, so it propagates verbatim from code — but **without the explicit merge line it is silently dropped** from every operator's deployed config (the silent-drop trap the allowlist guards).
- **`src/usage.ts` gains an AE SQL-API client** (`POST /accounts/<id>/analytics_engine/sql`, reusing `CF_ACCOUNT_ID` + the analytics token). `GET /admin/api/usage/trends` returns per-job metric series for the last N days.
- **The Usage page gains a "Trends" panel** — per-job duration/throughput over the last N days — that degrades to "not available" when the AE binding/token is absent or the query fails, mirroring the page's existing not-configured handling.

**Out of scope / flagged for a spike:** *per-run neuron attribution.* `env.AI.run` does not reliably return a per-call neuron cost (not in the types, model-dependent), so the MVP records **work metrics** (durations + counts) and leaves neuron totals to the existing account-level view. Whether per-job neurons is obtainable is a verification task, not a commitment here.

## Capabilities

### Added Capabilities
- `usage-trends`: every background job emits a tenant-clean per-run Analytics Engine data point (additive to its `job_health` row, best-effort), and the operator Usage page gains a per-job historical **trends** view sourced from the AE SQL API at zero KV/D1 cost, degrading gracefully when unconfigured.

## Impact

- **Code:** `wrangler.jsonc` (the `analytics_engine_datasets` binding), `scripts/merge-wrangler-config.mjs` (+ its test), `src/env.ts` (the `USAGE_AE` binding), the six job runners (one `writeDataPoint` each, via a shared helper), `src/usage.ts` (the SQL client + trends mapper), `src/admin.ts` (`GET /admin/api/usage/trends`), `admin/src/Usage.elm` (+ `admin/dist/`).
- **Tests:** the merge-allowlist test (the new binding type propagates), a usage-trends emission test (shape + best-effort), the SQL-response → series mapper, and the Elm trends decode.
- **Docs:** `docs/ARCHITECTURE.md` (AE as the history tier alongside `job_health` liveness), `docs/SCHEMAS.md` (the AE dataset's **positional** blob/double slot contract), `docs/SELF_HOSTING.md` (the AE binding is code-level; the token may need an AE-read scope — verify).
- **Spike first:** verify the AE SQL dataset/field shape against a live account, and whether `env.AI.run` exposes per-call neurons — both gate how much the trends panel can show (same "verify against live" caveat as the usage-observability GraphQL field names).
- **No new secret** (reuses `CF_ACCOUNT_ID` + the analytics token). One new binding **type** — handled by the merge allowlist change above. Tenant-clean by construction (job name + outcome + numbers, no per-tenant id).
