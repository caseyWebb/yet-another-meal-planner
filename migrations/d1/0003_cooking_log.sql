-- 0003_cooking_log — the per-tenant cooking log as a D1 table (d1-cooking-log, slice 2).
--
-- The cooking log is the last per-tenant volatile artifact to leave GitHub
-- (users/<username>/cooking_log.toml). Unlike the derived `recipes` index, it is
-- AUTHORED history, so it ships with a one-time data backfill
-- (migrations/0002-cooking-log-d1.mjs) over the foundation's .mjs+d1 runner — the
-- first migration to exercise that track end to end. The build NO LONGER validates
-- it (it isn't in GitHub); validation is now the write-time `log_cooked` tool's job.
--
-- One row per cooking event:
--   * tenant      — the owning user (every read is tenant-scoped; there is no FK to
--                   a users table — tenants are a KV/identity concept).
--   * date        — YYYY-MM-DD (lexicographically comparable; the window/aggregation
--                   queries compare it as TEXT).
--   * type        — recipe | ready_to_eat | ad_hoc.
--   * recipe      — slug, present for type=recipe. A SOFT reference to recipes.slug
--                   (NO foreign-key constraint — history survives a recipe's removal,
--                   mirroring the history-preserving stance the validator had).
--   * name        — dish name, present for ready_to_eat | ad_hoc.
--   * protein     — optional inline dimension for non-recipe entries; recipe entries
--   * cuisine       resolve protein/cuisine from `recipes` via a JOIN at read time.
--
-- `id` AUTOINCREMENT gives a stable handle for an admin UI to edit/delete a
-- mis-logged entry; the log is append-only in normal use.
CREATE TABLE IF NOT EXISTS cooking_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant  TEXT NOT NULL,
  date    TEXT NOT NULL,        -- YYYY-MM-DD
  type    TEXT NOT NULL,        -- recipe | ready_to_eat | ad_hoc
  recipe  TEXT,                 -- slug, when type = recipe
  name    TEXT,                 -- dish name, when ready_to_eat | ad_hoc
  protein TEXT,                 -- optional inline dimension (non-recipe entries)
  cuisine TEXT
);

-- (tenant, date) backs the retrospective window scan (WHERE tenant=? AND date>=?).
CREATE INDEX IF NOT EXISTS idx_cooking_log_tenant_date   ON cooking_log(tenant, date);
-- (tenant, recipe) backs the last_cooked aggregation (MAX(date) GROUP BY recipe).
CREATE INDEX IF NOT EXISTS idx_cooking_log_tenant_recipe ON cooking_log(tenant, recipe);
