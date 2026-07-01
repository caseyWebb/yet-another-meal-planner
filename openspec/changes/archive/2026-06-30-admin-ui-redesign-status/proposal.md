## Why

The redesigned Status area (from the Claude Design handoff) replaces the bare service-health list with an operator dashboard: page-level corpus stat tiles, and per-job rows that show a **run-history uptime sparkline** and a **healthy/unhealthy-since** timestamp, with live dependencies in their own group. The uptime view needs per-run history the Worker does not keep today — `job_health` stores only each job's last state, and the usage Analytics Engine dataset has per-day metrics with no individual-run outcome or stable id. This change builds that backing (a bounded `job_runs` history) and the redesigned Status surface over it. It is the first area to consume the foundation's component kit, validating that vocabulary before the other areas depend on it.

## What Changes

- **New per-run job history.** Every background process that writes a `job_health` record SHALL also append a tenant-data-free run record (id, job, ok, ran-at, duration, summary) to a new bounded D1 `job_runs` table. A reader returns the last N runs per job (newest first) plus the start of the current ok/fail streak (for "healthy since"). This history also backs the downstream Logs area.
- **Status corpus stat tiles.** The Status area gains a 4-up stat-tile row — Recipes, Members, RSS feeds, Cached SKUs — from a small corpus-counts reader; the Recipes and Members tiles link to their areas (the foundation's clickable `StatCard`).
- **Per-job uptime + healthy-since.** Each job row renders an uptime sparkline (the last N runs as ok/fail bars, with a % uptime label) and a "healthy since / unhealthy since" timestamp derived from the run streak, alongside the existing state glyph, name, last-run age, status badge, and the job's summary-count chips.
- **Dependencies as a distinct group.** The D1 probe and the admin-gate posture render as their own "Dependencies" item group, separate from the background jobs.
- **Composed from the foundation kit** (`StatCardGrid`/`StatCard`, `Item`/`ItemGroup`, `Sparkline`, `Badge`), in the existing SSR model. The bar→log deep-link target lands with the **Logs** area; in this change the sparkline is read-only (hover tooltip only).

## Capabilities

### New Capabilities
<!-- None — extends existing capabilities. -->

### Modified Capabilities
- `background-job-health`: **adds** a per-run **run-history record** requirement — each background process appends a bounded, tenant-data-free `job_runs` record on every run (alongside the existing last-state `job_health` upsert), with a reader for the last N runs per job and the current streak start.
- `operator-admin`: **adds** the redesigned Status surface — corpus stat tiles (with the Recipes/Members tiles navigating), per-job run-history uptime + healthy-since, and the live dependencies as a distinct group.

## Impact

- **Migrations:** a new `migrations/d1/00NN_job_runs.sql` (the bounded history table + an index on `(job, ran_at)`).
- **Worker code:** `src/health.ts` (a `writeJobRun` writer + a `readJobRuns` reader, through `src/db.ts`); the `scheduled`/`email` call sites in `src/index.ts` (and the per-job modules) append a run record where they already call `writeJobHealth`; a small corpus-counts reader (likely in `src/admin-data.ts`).
- **Admin panel:** `src/admin/pages/status.tsx` (the tiles + job rows + dependencies, composing the foundation kit). No new client island — the page stays SSR (the sparkline's hover tooltip is the only interactivity, deferred with the Logs deep-link).
- **Depends on:** `admin-ui-redesign-foundation` (the kit primitives + the relocated rollup) — archive that first.
- **Downstream:** the `job_runs` history is the data source the **Logs** area's all-jobs run log will consume.
