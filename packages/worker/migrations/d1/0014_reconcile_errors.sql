-- 0014_reconcile_errors — observable record of recipes the index reconcile SKIPPED
-- (r2-corpus-store). The recipe index is now projected by the Worker reconcile from the
-- R2 corpus (src/recipe-projection.ts), replacing the retired CI build. A recipe that
-- fails validation (required-field/vocabulary contract, missing body sections, duplicate
-- slug, or a dangling `pairs_with`) is NOT projected and is recorded here, so a malformed
-- human edit is observable — surfaced via `/health`, an agent-readable read path
-- (`read_reconcile_errors`), and an ntfy push — instead of silently dropped. This is the
-- eventual-feedback model that replaces red CI (design Decision 3).
--
-- The table is REPLACED wholesale on every reconcile (DELETE + batched INSERT in one
-- transaction), so it always reflects the latest pass: a fixed recipe drops out on the
-- next tick. Shared corpus (not per-tenant) — recipe slugs/paths are group content, not
-- tenant data, so there is no `tenant` column.
--
--   * `slug`        — the recipe slug that failed to index (basename of the object).
--   * `path`        — its corpus object path (recipes/<slug>.md), for the operator/author.
--   * `message`     — the first (most actionable) validation error, human-readable.
--   * `recorded_at` — ISO date (YYYY-MM-DD) of the reconcile that recorded it.
--
-- No PRIMARY KEY on `slug`: a duplicate-slug pair plus a later cross-corpus failure can
-- yield two rows for one slug, so this is a plain rowid table replaced each pass.
CREATE TABLE IF NOT EXISTS reconcile_errors (
  slug        TEXT NOT NULL,
  path        TEXT NOT NULL,
  message     TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
