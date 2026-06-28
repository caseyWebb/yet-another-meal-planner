# Design — usage-trends-analytics-engine

## Context

`usage-observability` shipped a Usage page that reads **today's account-level** KV-operation and Workers-AI-neuron usage from the Cloudflare GraphQL Analytics API. It cannot show **trends over time** or **per-job attribution** (the account API aggregates by model / by namespace, not by the cron job that did the work). This change adds Workers Analytics Engine (AE) as the **history tier**, complementing — not replacing — the `job_health` D1 **liveness tier**.

```
LIVENESS (current state)            HISTORY (trends)
  job_health  (D1)                    Analytics Engine
  synchronous, authoritative          sampled, lagged, aggregation
  read by /health, point-per-job      read by the Usage "Trends" panel
  ← shipped                           ← this change
```

## Decision 1 — Emission: one best-effort data point per job run

Each background job, at the end of its run, calls a shared helper:

```
recordUsagePoint(env, job, { ok, durationMs, counts })
  → env.USAGE_AE?.writeDataPoint({
      indexes: [job],                       // the sampling key (one per job)
      blobs:   [job, ok ? "ok" : "fail"],   // dimensions
      doubles: [durationMs, ...counts],     // metrics
    })
```

- **Best-effort**, exactly like the ntfy push and the `job_health` write's `.catch(() => {})`: a failed/absent `writeDataPoint` must never change the job's outcome. `env.USAGE_AE?.` so an un-bound deployment is a silent no-op.
- **Additive** to the existing `job_health` upsert — the jobs already compute `ok` + a counts summary; this emits the same numbers to AE. No change to the liveness contract.
- **Tenant-clean** by construction: job name, outcome, durations, counts — never a per-tenant id (same invariant the `job_health` summary already holds).
- **Cost:** AE `writeDataPoint` is non-blocking and draws on neither the KV nor D1 budget. `5 jobs × 288 ticks/day = 1,440 points/day`, trivially within AE's free allocation (~100k/day); far below the sampling threshold, so the series are exact.

## Decision 2 — The AE **slot contract** is positional and must be documented

AE has no named columns: a data point is `blob1..blob20`, `double1..double20`, `index1`, `timestamp`. Queries reference **positions**, so the slot assignment is a **contract** — reordering `doubles` in a later change silently corrupts historical queries. `docs/SCHEMAS.md` documents the dataset like a table:

```
grocery_usage (Analytics Engine dataset)
  index1   = job name              (sampling key)
  blob1    = job name
  blob2    = outcome ("ok"|"fail")
  double1  = duration_ms
  double2..= job-specific counts, per a fixed per-job order (documented)
  timestamp= write time (AE-supplied)
```

The per-job `double` layout differs by job (the warm's freshness vs the sweep's outcome counts), so the doc enumerates each job's `double` order. A spike confirms the final layout before it becomes load-bearing.

## Decision 3 — Query surface is the AE **SQL API**, not GraphQL

A correction to the usage-observability design's aside: built-in datasets (KV ops, AI neurons) use the **GraphQL** Analytics API; **custom AE datasets use the AE SQL API** — `POST https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql` with a SQL string body and a Bearer token. So `src/usage.ts` grows a **second** client (SQL, not GraphQL) reusing `CF_ACCOUNT_ID` + the analytics token. The token may need an **Account Analytics: Read** scope that also covers AE SQL — **verify against a live account** (same caveat shape as the GraphQL field names in the prior change). Query shape:

```sql
SELECT blob1 AS job, toStartOfDay(timestamp) AS day,
       count() AS runs, avg(double1) AS avg_ms, sum(double1) AS total_ms
FROM grocery_usage
WHERE timestamp > now() - INTERVAL '30' DAY
GROUP BY job, day ORDER BY day
```

`GET /admin/api/usage/trends` maps the SQL rows to a per-job series payload; the Elm Trends panel renders it (a small table / sparkline), reusing the Usage page's `WebData` + not-configured discipline. A SQL/transport failure is `upstream_unavailable`, like the existing `/admin/api/usage`.

## Decision 4 — The binding is a new **type** → merge allowlist (the easy-to-miss part)

`scripts/merge-wrangler-config.mjs` is an explicit per-type allowlist (`kv_namespaces`, `d1_databases`, `ai`, `assets`, `r2_buckets`). `analytics_engine_datasets` is **absent**, so adding the binding to `wrangler.jsonc` alone would **silently drop it** from every operator's deployed config — the exact trap the allowlist's comments call out. Fix is one line (it carries no operator-owned id, like `ai`/`assets`/`r2_buckets`):

```js
if (code.analytics_engine_datasets !== undefined)
  out.analytics_engine_datasets = code.analytics_engine_datasets;
```

…plus a `merge-wrangler-config` test asserting the new binding type propagates (the regression guard the silent-drop trap demands).

## Decision 5 — Graceful degradation, both ends

- **Emit:** `env.USAGE_AE?.writeDataPoint(...)` — unbound ⇒ no-op; a throw is swallowed.
- **Read:** `/admin/api/usage/trends` returns `{ configured: false }` when `CF_ACCOUNT_ID`/token is unset (no SQL call), and the panel renders "trends not available" — identical to the Usage page's existing not-configured state.

## Open questions (gate the trends panel's depth)

1. **Per-run neurons.** Does `env.AI.run`'s response expose a per-call neuron/token cost? If yes, `double_n = neurons` gives per-job neuron attribution — the most valuable metric. If no, the panel shows durations + throughput only, and neuron totals stay on the account view. **Spike required**; not committed here.
2. **AE SQL token scope.** Confirm the minimal token permission that reads AE SQL (likely the same Account Analytics: Read), and document it.
3. **Retention.** AE free-tier retention (≈90 days) caps the trend window — fine for "last 30 days", documented as a known bound.

## Non-goals

Retiring `job_health` (liveness stays in D1); alerting on trends; rich charting. MVP = emit + a per-job last-N-days table/sparkline.
