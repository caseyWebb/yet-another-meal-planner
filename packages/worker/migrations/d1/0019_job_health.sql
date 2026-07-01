-- 0019_job_health — background-job health records move from KV to D1 (usage-observability).
--
-- Per-job liveness was persisted on every cron tick as a `health:job:<name>` KV key. With
-- five jobs on a */5 cron that is ~1,440 KV writes/day — over the free-tier 1,000/day write
-- budget on its own, before any other KV use. Health is persistent OPERATIONAL data, which
-- the architecture places in D1 ("KV is ephemeral infra only"); it belongs here, where the
-- same writes cost a trivial fraction of D1's far larger budget.
--
-- One upserted row per registered job (keyed by name), written through src/db.ts:
--   * ok            — 0/1; whether the recorded run succeeded.
--   * last_run_at   — epoch ms of the run that wrote this row (drives staleness detection).
--   * summary       — JSON object of small tenant-clean operational detail (counts, error
--                     classes). MUST stay tenant-data-free, exactly as the KV record was.
CREATE TABLE job_health (
  name        TEXT PRIMARY KEY,
  ok          INTEGER NOT NULL,  -- 0/1
  last_run_at INTEGER NOT NULL,  -- epoch ms
  summary     TEXT NOT NULL      -- JSON object, tenant-clean
);
