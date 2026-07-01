## Context

`src/admin/pages/logs.tsx` + `src/admin/client/logs.tsx` today implement ONE log source (Discovery): the page SSRs the entries list for first paint, then an island (`#logs-island`) hydrates it with per-row Retry/Delete and a detail `<dialog>`. The page's left "submenu" (`ul.log-sources`) currently lists exactly one item.

The redesign mock (`LogsScreen.jsx`) is a different shape entirely: a flat, filterable, paginated list of **individual cron run records** drawn from `GA.health.jobRuns` (built in `health-data.jsx` by flattening every job's `runs` into one newest-first array, each carrying `id`, `job`, `icon`, `ok`, `at`, `durationMs`, `summary`, and — on failure — `error`). This is exactly the shape `src/health.ts`'s `job_runs` table already stores (added by `admin-ui-redesign-status`, archived): `JobRun { id, ok, ran_at, duration_ms, summary }`, keyed per job via `readJobRuns(env, name, limit)`. The mock's "every tick on the Status sparkline links here" comment matches `admin-ui-redesign-status`'s design.md, which explicitly deferred the deep-link target and the dedicated all-jobs view to "Logs … its own change" (this one).

The existing Discovery-log requirement and its retry/delete requirement are unaffected in their own right — they describe a per-candidate import-pipeline log with import-specific fields (slug, source, title) that don't fit the job-run shape at all. The redesign's IA shift is which view is "Logs" by default, not a replacement of Discovery's content.

## Goals / Non-Goals

**Goals:**
- Make `/admin/logs` show, by default, the all-cron-jobs run log: filterable by job, paginated, each entry expandable to its `job_health`-shaped `summary` via the existing `PrettyKV` kit primitive.
- Add the minimal new backend surface (`readAllJobRuns`, `readJobRunById`) needed to back that view — no new D1 table, no schema change (the Status change already built `job_runs` for exactly this kind of consumer).
- Wire the deep-link Status deferred: a sparkline tick is a link carrying a run id; Logs resolves it to the right job filter, the right page, and a highlighted, expanded entry.
- Keep Discovery's existing log, and its Retry/Delete actions, reachable exactly as they work today — no regression to that requirement.

**Non-Goals:**
- No change to the `job_runs` table, its retention cap, or `writeJobRun`/`readJobRuns`/`currentStreakStart` (Status's contract stays exactly as archived).
- No new MCP tool, no new D1 migration.
- No redesign of the Discovery log's own row content/actions (Retry/Delete, the detail dialog) — only how it's reached relative to the new default view.
- No cross-job search/sort beyond the job-pill filter the mock specifies (no free-text search, no sort-by-duration — not in the mock, not requested).

## Decisions

### Decision 1 — SSR for the all-jobs run log, not an island

The existing Discovery log is an island because it has **mutations** (Retry/Delete) that must update specific rows' busy/error state without a full reload, per `admin/CLAUDE.md` rule 8 ("Add an island only for genuine interactivity"). The all-jobs run log has none of that: it is `job_runs` rows rendered read-only, with **expand/collapse** (pure local disclosure, no data fetch) and a **filter** (which subsets of already-loaded-or-paginated data to show). Per the same CLAUDE.md rule, a page that only reads is pure SSR.

Concretely: filter and pagination become **query params on `/admin/logs`** (`?job=<name>&page=<n>`, or `/admin/logs/<job>` mirroring the Discovery sub-route precedent — see Open Questions), each a normal navigation the Worker re-renders. Expand/collapse for an individual entry needs no server round-trip but also needs no client JS to be *correct* — it can be the native `<details>`/`<summary>` element (zero-JS disclosure, matches the "no client island for read-only interactivity" precedent already used for the Status sparkline's `title`-only hover). This keeps the area's new content at the SSR pattern Status/Usage already established (`admin-ui-redesign-status`, `admin-ui-redesign-usage`), rather than introducing a second, divergent islanding style within one page.

*Alternative considered:* mirror the mock literally — a single client island holding `job`/`page`/`open`/`hl` React state, fetching `health.jobRuns` once. Rejected: it would special-case Logs as the one area with a read-only island, contradicting CLAUDE.md rule 8 and the precedent both Status and (per its own design.md) Usage just set; query-param navigation gives free deep-linkability (the mock's own `logTarget`/`openLog` behavior) without any client JS.

### Decision 2 — Discovery log coexists as a reachable sub-view, not folded into job runs

Discovery's entries are NOT `job_runs` rows — they're per-*candidate* outcomes from one sweep tick (import/duplicate/no_match/parked-error), with import-specific fields (`slug`, `source`, `title`, `detail`) that have no equivalent in a job-run record. Folding them into the all-jobs list would either lose those fields or force the job-run shape to grow discovery-specific fields it shouldn't carry (the table is intentionally job-agnostic, per `health.ts`'s job-runs section comment).

Resolution: the Logs area keeps its existing **submenu** concept, now with two destinations instead of one:
- `/admin/logs` (and explicitly `/admin/logs?job=discovery-sweep` via the pill row) — the all-jobs run log, the area's new default/landing content.
- `/admin/logs/discovery` — the existing per-candidate Discovery log, UNCHANGED (same SSR page + island, same Retry/Delete, same routes `/admin/api/discovery/:id/retry` and `DELETE /admin/api/discovery/:id`).

A run-log entry for the `discovery-sweep` job (one row per sweep tick, summarizing `processed`/`imported`/`duplicate`/etc. counts — the same `summary` the job already upserts to `job_health`) is therefore distinct from, and links out to, the existing candidate-level Discovery log: its expanded detail includes a "View discovery candidates →" link to `/admin/logs/discovery` for the operator who wants per-candidate granularity. This avoids inventing a join between a `job_runs` row and the discovery candidates that ran within it (no `run_id` foreign key exists on the discovery log table, and adding one is out of scope — Non-Goals).

*Alternative considered:* make the Discovery submenu item a *filter* of the all-jobs view (`?job=discovery-sweep` shows candidate rows instead of run rows when job=discovery-sweep). Rejected — it would make the row shape conditional on the filter value, reintroducing exactly the kind of representable-nonsense the panel's modeling discipline (admin/CLAUDE.md) warns against; keeping them as two distinct, separately-routed lists is simpler and matches what the table contents actually are.

### Decision 3 — Deep-link shape: `?run=<id>`, resolved server-side

The Status sparkline bar becomes `<a href={`/admin/logs?run=${run.id}`}>` (replacing the current read-only `<span title=...>`). `/admin/logs` SSR resolves `?run=<id>` via the new `readJobRunById(env, id)`: if found, it sets the job-pill filter to that run's `job`, computes which page (under the existing-job-filtered, newest-first ordering) the run falls on, and renders that page with the matching entry pre-expanded and CSS-highlighted (a `log-entry hl` class, mirroring the mock's `hl` state but as a render-time decision instead of a `setTimeout`-cleared client flag — the highlight is simply present on that one SSR response; navigating away or reloading without `?run=` drops it, which is sufficient since the highlight's only job is "you just arrived here from a link").

If the run id is not found (e.g. pruned past the `JOB_RUNS_PER_JOB_CAP` retention window since the Status page was rendered), the page falls back to the unfiltered, first-page, default view rather than erroring — a stale deep-link degrading to "just show the log" is the right failure mode for a TTL'd history table.

### Decision 4 — `readAllJobRuns` is a new admin-data reader in `src/health.ts`, not a `background-job-health` capability change

`background-job-health`'s job-run-history requirement (added by the Status change) already specifies the table, the write path, and the per-job reader/streak-start function; an all-jobs merge is a presentation-shaped convenience (newest-first across jobs, for one admin page) rather than a new guarantee a background job depends on. It lives beside `readJobRuns`/`readJobRunById` in `src/health.ts` (same module, same degrade-to-empty-on-storage-error contract) but is scoped to `operator-admin` in the spec deltas, matching how Status's own corpus-counts reader was framed as admin-data rather than job-health.

Implementation shape: a single `SELECT id, job, ok, ran_at, duration_ms, summary FROM job_runs ORDER BY ran_at DESC LIMIT ?` (no per-job grouping needed — the table is already job-agnostic with a `job` column), decoded with the existing `rowToRun` mapper. `readJobRunById` is `SELECT … FROM job_runs WHERE id = ?1` through the same mapper, returning `JobRun | null`.

## Risks / Trade-offs

- **[Pagination over a merged cross-job query at scale.]** → At `JOB_RUNS_PER_JOB_CAP = 100` per job × `HEALTH_JOBS.length = 6` jobs, the table tops out at 600 rows — a single unindexed-by-job `ORDER BY ran_at DESC LIMIT N` scan is cheap at that bound; no new index needed beyond the existing `(job, ran_at)` one (the merge query doesn't filter by job, but D1/SQLite still uses the rowid/PK efficiently at this row count). If a future change raises the per-job cap by an order of magnitude, revisit.
- **[The job-pill filter re-derives "all distinct job names" from data, not from `HEALTH_JOBS`.]** → The mock builds `jobNames` from observed runs; using `src/health.ts`'s `HEALTH_JOBS` constant instead is more correct (a job with zero runs yet still gets a pill, consistent with Status always listing it as never-run) and avoids a second source of truth — documented as the implementation's deviation from the literal mock.
- **[Deep-link race: the linked run is pruned between Status render and the operator's click.]** → Mitigated by Decision 3's fallback (unfiltered default view, no error).
- **[Discovery's "two submenu destinations" could read as inconsistent IA if not labeled clearly.]** → The pill row's "All jobs" + per-job pills (including a `discovery-sweep` pill showing sweep-tick summaries) sits beside, not instead of, a distinct way to reach the existing per-candidate Discovery log; the expanded `discovery-sweep` run's "View discovery candidates →" link (Decision 2) is the connective tissue so the operator isn't left to guess that a second, more granular log exists.

## Open Questions

- Whether the per-job filter is a query param (`/admin/logs?job=<name>`) or a path sub-route (`/admin/logs/<job>`), matching the existing `/admin/logs/discovery` precedent more literally. This change recommends the **query-param** form for the all-jobs filter (since `page` must also be a param, and `/admin/logs/<job>?page=<n>` vs `/admin/logs?job=<job>&page=<n>` is a wash) while keeping `/admin/logs/discovery` as the one path-based sub-route (it's a categorically different view, not a filter value) — confirm during implementation that this doesn't collide with any existing `/admin/logs/:source`-shaped routing in `app.tsx`.
