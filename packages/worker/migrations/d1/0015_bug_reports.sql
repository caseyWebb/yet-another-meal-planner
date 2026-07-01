-- 0015_bug_reports — agent-filed bug reports as a D1 table (r2-corpus-store).
--
-- `report_bug` previously opened a GitHub issue on the operator's private data repo
-- (the only non-content GitHub use on the write path). With the GitHub App dropped for
-- data, bug reports become a D1 table the operator reviews via the admin panel
-- (`GET /admin/api/bug-reports`) — no GitHub account, App permission, or issues API
-- involved. Attribution (reporter + timestamp) is stored server-side in columns, not
-- trusted from the agent.
--
--   * `reporter`   — the tenant id who filed it (attributed server-side).
--   * `title`/`body` — the agent-authored report.
--   * `created_at` — ISO timestamp the server stamped at filing.
--   * `status`     — operator-managed lifecycle (`open` by default; `closed` when handled).
CREATE TABLE IF NOT EXISTS bug_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open'
);

-- The operator's review queue is "open reports, newest first".
CREATE INDEX IF NOT EXISTS idx_bug_reports_status_created ON bug_reports(status, created_at DESC);
