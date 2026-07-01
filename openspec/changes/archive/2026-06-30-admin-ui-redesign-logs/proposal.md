## Why

`/admin/logs` today renders only the Discovery sweep's per-candidate outcome log — useful for that one pipeline, but the operator has no single place to see whether *any* background cron actually ran, when, and with what result. The Status change (`admin-ui-redesign-status`) already built the backing for that: a bounded D1 `job_runs` table recording every cron tick (id, job, ok, ran-at, duration, summary), surfaced on Status as a per-job uptime sparkline. That sparkline's individual ticks have nowhere to link — the Status design explicitly deferred the "tick → log entry" deep-link to this area. This change turns Logs into the all-cron-jobs run log the redesign mock specifies, with the Discovery log remaining reachable as the one source with its own row-level operator actions (Retry/Delete).

## What Changes

- Add an **all-jobs run log view** to the Logs area: a flat, newest-first list of `job_runs` entries across every registered job, filterable by a job pill row (All jobs + one pill per job name), with a hint line (N runs · M ok · K failed) and pagination. Each entry shows a status dot, job name (with icon), ok/failed, relative run time, and duration; expanding an entry reveals its `job_health`-shaped `summary` (rendered with the existing `PrettyKV` kit primitive) and, on failure, the error.
- Add a backend reader, `readAllJobRuns(env, limit)`, in `src/health.ts`: merges `job_runs` across all registered jobs, newest-first, bounded by `limit`, degrading to an empty array on a storage error (mirrors `readJobRuns`). Add `readJobRunById(env, id)` for the cross-area deep-link lookup.
- Wire the **deep-link**: the Status area's uptime sparkline bars (currently read-only `<span>`s with a `title` tooltip) become links to `/admin/logs?run=<id>`; the Logs page resolves that query param server-side via `readJobRunById`, pre-selects the run's job in the pill filter, jumps to the page containing the run, and renders that entry expanded and highlighted.
- Keep the existing **Discovery** log (its own entries, Retry/Delete row actions, and detail dialog) reachable at its existing route; reframe it as one job's worth of detail within the all-jobs model rather than the area's only content. See `design.md` for how the two coexist on one page.
- Render the new all-jobs view server-side (SSR), consistent with the area's already-read-only job-run data and the panel's SSR-by-default rule; the Discovery-specific mutations stay in their existing island.

## Capabilities

### New Capabilities

<!-- None — extends an existing capability. -->

### Modified Capabilities

- `operator-admin`: the "Logs area with a left submenu and a detail dialog" requirement is **MODIFIED** — the area's primary content becomes the all-jobs run log (filter pills, run entries, expand-to-summary, pagination, the run-id deep-link), with the Discovery log demoted from "the area's only content" to one reachable source within it; **ADDS** a run-log requirement (filter, entry list, expand-to-detail, pagination) and a deep-link requirement (Status sparkline tick → Logs entry, highlighted). The existing Discovery-log-content requirement, the cross-tenant Discovery-log-serving requirement, and the retry/delete requirements are unchanged in substance (route/behavior preserved) and are carried forward, not modified.

## Impact

- `src/health.ts` — new `readAllJobRuns(env, limit)` and `readJobRunById(env, id)` readers over the existing `job_runs` table (no schema change; same retention/degradation behavior as `readJobRuns`).
- `src/admin/pages/logs.tsx` — gains the all-jobs run-log SSR composition (job-pill filter, run-entry list via the kit `Item`/`ItemGroup` or a dedicated row, `PrettyKV` detail, `Pager`), the run-id query-param resolution for the deep-link, and continues to host the Discovery log's entries list.
- `src/admin/pages/status.tsx` — the `Uptime` sparkline's `spark-bar` `<span>`s become `<a>` links to `/admin/logs?run=<id>`.
- `src/admin/app.tsx` — `/admin/logs` route gains the `run` query param handling; `/admin/logs/discovery` is unchanged.
- `src/admin/client/logs.tsx` — unchanged in scope (Discovery retry/delete island); may need a prop/DOM-id adjustment if the all-jobs view and the Discovery island now share the page (see design.md).
- `docs/TOOLS.md`/`docs/SCHEMAS.md` — no change (no MCP tool surface, no D1 schema change); `docs/ARCHITECTURE.md` not affected (no architectural shift, same `job_runs` table from the Status change).
- Depends on `admin-ui-redesign-status` (the `job_runs` table, `readJobRuns`, `currentStreakStart`) and `admin-ui-redesign-foundation` (the kit primitives) — both already archived.
