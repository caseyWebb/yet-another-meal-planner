## 1. Backend readers (`src/health.ts`)

- [x] 1.1 Add `readAllJobRuns(env, limit)`: `SELECT id, ok, ran_at, duration_ms, summary, job FROM job_runs ORDER BY ran_at DESC LIMIT ?`, decoded via (an extended) `rowToRun` that also carries `job`; degrades to `[]` on a storage error, mirroring `readJobRuns`
- [x] 1.2 Add `readJobRunById(env, id)`: `SELECT … FROM job_runs WHERE id = ?1`, returning `JobRun & { job: string } | null`; degrades to `null` on a storage error
- [x] 1.3 Widen the exported `JobRun` type (or introduce a sibling `JobRunWithJob`) to carry the `job` field these two readers need but the existing per-job `readJobRuns` doesn't (its caller already knows the job)
- [x] 1.4 Unit test both readers: multi-job ordering (newest-first across jobs), the `limit` bound, an unknown id returning `null`, and the storage-error degrade path (mirrors existing `readJobRuns` tests)

## 2. Logs area — all-jobs run log (SSR)

- [x] 2.1 Rewrite `src/admin/pages/logs.tsx`'s default `/admin/logs` content: job-pill filter row (All jobs + `HEALTH_JOBS` pills) as links/query-param navigation, hint line (N runs · M ok · K failed) for the current filter, paginated entry list (`Pager` from the kit)
- [x] 2.2 Render each run entry: status dot, job name + icon, ok/failed label, relative age, duration — using or extending the kit's `Item` row primitive
- [x] 2.3 Make each entry expandable via a native disclosure element (`<details>`/`<summary>`, no client JS) revealing the run's `summary` via the existing `PrettyKV` kit component, and the error string when the run failed
- [x] 2.4 Add a `discovery-sweep`-run-specific "View discovery candidates →" link in the expanded detail, pointing to `/admin/logs/discovery`
- [x] 2.5 Implement the job-with-zero-runs case: a pill renders for every `HEALTH_JOBS` entry even with no recorded runs; selecting it shows an empty-state, not an error
- [x] 2.6 Keep the existing Discovery log (`/admin/logs/discovery`) and its island (`src/admin/client/logs.tsx`) unchanged in behavior; adjust only what's needed for the two views to coexist on/under the Logs area (e.g. a submenu or area-level nav distinguishing "Logs" default vs. "Logs · Discovery")

## 3. Deep-link resolution

- [x] 3.1 Add `?run=<id>` handling to the `/admin/logs` route in `src/admin/app.tsx`: resolve via `readJobRunById`, and when found, compute the job filter, the page index (under that job's filtered, newest-first ordering), and pass an "expand + highlight this id" flag into `LogsPage`
- [x] 3.2 Render the resolved entry pre-expanded (disclosure `open` attribute) and with a highlight class (e.g. `log-entry hl`) in `src/admin/pages/logs.tsx`
- [x] 3.3 Implement the not-found fallback: an unresolvable `run` id renders the default unfiltered, first-page view (no error banner)
- [x] 3.4 Change `src/admin/pages/status.tsx`'s `Uptime` component: each `spark-bar` becomes an `<a href="/admin/logs?run={run.id}">` instead of a bare `<span title=...>`, preserving the existing hover tooltip (title attribute) on the link

## 4. Styling

- [x] 4.1 Add/extend `src/admin/styles.css` layout rules for the run-log list (`log-entry`, `log-row`, `log-detail`, `.hl` highlight, pill row reuse from existing `.pill`/`.data-nav` classes) per `admin/CLAUDE.md`'s "Basecoat + Tailwind utilities first, custom CSS only for layout Basecoat lacks" rule

## 5. Docs & contract lockstep

- [x] 5.1 No `docs/TOOLS.md` change (no MCP tool surface touched)
- [x] 5.2 No `docs/SCHEMAS.md` change (no D1 schema change — `job_runs` shape is unchanged, only new read queries over it)
- [x] 5.3 Confirm `docs/ARCHITECTURE.md` needs no update (the Logs area's backing data and architecture are unchanged from what the Status change already documented)

## 6. Verification

- [x] 6.1 `aubr typecheck`
- [x] 6.2 `aubr test`, extending `test/health.test.ts` (or equivalent) for the two new readers and any `test/admin-logs.test.ts`-equivalent SSR-page tests for the filter/pagination/expand/deep-link behavior
- [x] 6.3 Manual check via `aubr dev`: `/admin/logs` shows the merged run list with working filter pills (including a never-run job's empty pill) and pagination; expanding a run shows its summary (and error, for a failed run); a `discovery-sweep` run's detail links to `/admin/logs/discovery`; clicking a Status sparkline bar opens the matching, highlighted Logs entry; `/admin/logs/discovery`'s existing Retry/Delete flow is unaffected
