## 1. Run-history store (job_runs)

- [x] 1.1 Add `migrations/d1/00NN_job_runs.sql`: a `job_runs` table (`id` TEXT, `job` TEXT, `ok` INTEGER, `ran_at` INTEGER, `duration_ms` INTEGER, `summary` TEXT) plus an index on `(job, ran_at DESC)`
- [x] 1.2 Add `writeJobRun(env, name, { ok, ran_at, duration_ms, summary })` to `src/health.ts` — append through `src/db.ts`, prune that job's rows beyond the per-job cap, and degrade to a no-op on a storage error (mirroring `writeJobHealth`)
- [x] 1.3 Add `readJobRuns(env, name, limit)` returning the last N runs newest-first (`{ id, ok, ran_at, duration_ms, summary }`), degrading to `[]` when D1 is unreachable
- [x] 1.4 Add a current-streak-start helper (the earliest `ran_at` in the job's current unbroken `ok`-streak) for the "healthy/unhealthy since" label
- [x] 1.5 Append `writeJobRun` at every existing `writeJobHealth` call site (`src/index.ts` scheduled + email, and any per-job module), sharing the run's `ok`/`summary` and a stamped `ran_at`/`duration_ms`/`id`

## 2. Corpus counts reader

- [x] 2.1 Add a small aggregate corpus-counts reader (recipes indexed, members allowlisted, RSS feeds, cached SKUs) — `COUNT` queries through `src/db.ts` + `listTenants`, returning aggregate-only counts (no per-tenant data)

## 3. Status page redesign

- [x] 3.1 Render the corpus stat-tile row in `src/admin/pages/status.tsx` with the foundation `StatCardGrid`/`StatCard`; make the Recipes and Members tiles link to `/admin/data` and `/admin/members`
- [x] 3.2 Render the background-jobs `ItemGroup` with each job's state glyph, name, last-run age, status badge, and summary-count chips (preserving the existing per-job/D1/posture detail)
- [x] 3.3 Add the per-job uptime sparkline (foundation `Sparkline`, ok/fail bars + % uptime) and the "Healthy/Unhealthy since" label from the streak helper; omit the sparkline for a job with no history
- [x] 3.4 Render the D1 probe + admin-gate posture as a distinct "Dependencies" item group; keep the prominent exposed-gate warning

## 4. Tests, build, and verify

- [x] 4.1 Unit-test `writeJobRun`/`readJobRuns` (append, newest-first read, per-job prune cap, storage-error no-op) and the streak-start helper
- [x] 4.2 Extend the Status SSR test for the stat tiles (incl. the navigating Recipes/Members tiles), the uptime sparkline + uptime %, the healthy/unhealthy-since label, and the Dependencies group
- [x] 4.3 Run `aubr typecheck`, `aubr test`, and `aubr build:admin`; fix any fallout
- [x] 4.4 Run `openspec validate "admin-ui-redesign-status"` and confirm the change is apply-complete
