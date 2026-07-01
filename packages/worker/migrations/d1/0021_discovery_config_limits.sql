-- Extend discovery_config with operator-tunable processing limits.
-- These are pacing knobs (subrequest / AI budget governors), not match-quality thresholds,
-- so they carry no floor-guard. Absent (NULL) columns fall back to DEFAULT_CONFIG values.
ALTER TABLE discovery_config ADD COLUMN fetch_max_per_tick    INTEGER; -- max external fetches per tick (DEFAULT 16)
ALTER TABLE discovery_config ADD COLUMN max_candidates_per_tick INTEGER; -- triage cost ceiling per tick (DEFAULT 150)
ALTER TABLE discovery_config ADD COLUMN retry_max_attempts    INTEGER; -- max retries before terminal failure (DEFAULT 5)
ALTER TABLE discovery_config ADD COLUMN log_retention_days    INTEGER; -- discovery log retention window (DEFAULT 60)
