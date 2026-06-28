-- Migration 0018: add retry state to discovery_log.
-- `attempts` — how many acquisition passes this row has had (0 for legacy rows and non-retryable
--   outcomes; 1 after the first park; incremented on each re-failure). DEFAULT 0 so existing rows
--   are treated as terminal until an operator hits "Retry now".
-- `next_retry_at` — ISO timestamp when this row next enters the cron retry stream; NULL means the
--   row is terminal (a non-retryable park, an exhausted row, or a successfully-resolved row).
ALTER TABLE discovery_log ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_log ADD COLUMN next_retry_at TEXT;

-- Covers the due-retry scan: outcome IN ('error','failed') AND next_retry_at <= now.
CREATE INDEX idx_discovery_log_retry ON discovery_log(outcome, next_retry_at);
