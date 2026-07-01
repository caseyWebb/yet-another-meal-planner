-- 0023_job_runs — per-run background-job history (background-job-health), alongside the
-- existing last-state `job_health` row.
--
-- `job_health` (migration 0019) upserts ONE row per job — the current state, no series. The
-- redesigned Status area's per-job uptime sparkline and "healthy/unhealthy since" label need a
-- per-run series with a stable, addressable id (so a sparkline bar can later deep-link to a log
-- entry — the Logs area, downstream). This table is that series: appended on every run, beside
-- the `job_health` upsert, and bounded per job (the writer prunes beyond a fixed per-job cap) so
-- it cannot grow without limit.
--
-- One inserted row per run (never updated), keyed by `id` (a writer-stamped unique id):
--   * job          — the job name (job_health's `name`; not a foreign key — job_health rows can
--                    predate this table).
--   * ok           — 0/1; whether this run succeeded.
--   * ran_at       — epoch ms of the run.
--   * duration_ms  — the run's wall-clock duration.
--   * summary      — JSON object of small tenant-clean operational detail, the SAME shape as the
--                    paired `job_health.summary` for that run. MUST stay tenant-data-free.
--
-- Indexed on (job, ran_at DESC) — the reader's "last N runs of job X, newest first" and the
-- writer's per-job prune both filter+order on exactly this pair.
CREATE TABLE job_runs (
  id          TEXT PRIMARY KEY,
  job         TEXT NOT NULL,
  ok          INTEGER NOT NULL,  -- 0/1
  ran_at      INTEGER NOT NULL,  -- epoch ms
  duration_ms INTEGER NOT NULL,
  summary     TEXT NOT NULL      -- JSON object, tenant-clean
);

CREATE INDEX idx_job_runs_job_ran_at ON job_runs (job, ran_at DESC);
