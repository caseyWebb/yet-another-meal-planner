-- 0005_session_state — per-tenant working state (pantry, meal plan, grocery list) as
-- normalized D1 row tables (d1-session-state, slice 5). Replaces the three KV blobs
-- `state:<username>:pantry|meal_plan|grocery_list` (JSON arrays). These are the most
-- heavily mutated per-tenant data: every add/remove rewrote the whole JSON array in
-- eventually-consistent KV (stale read-modify-write, silent concurrent clobber). Rows
-- give strong read-after-write consistency and row-level partial updates. The one-time
-- backfill that fills these from the KV blobs is migrations/0004-session-state-d1.mjs.
--
-- pantry / grocery_list are keyed by normalized name (the existing dedup/upsert key);
-- meal_plan by recipe slug. `sides` (meal_plan) and `for_recipes` (grocery_list) are
-- small open lists → JSON columns. idx_grocery_status backs read_grocery_list's status
-- filter; idx_pantry_category backs read_pantry's category filter.

CREATE TABLE IF NOT EXISTS pantry (
  tenant           TEXT,
  name             TEXT,
  normalized_name  TEXT,
  quantity         TEXT,
  category         TEXT,
  prepared_from    TEXT,
  added_at         TEXT,
  last_verified_at TEXT,
  PRIMARY KEY (tenant, normalized_name)
);

CREATE TABLE IF NOT EXISTS meal_plan (
  tenant      TEXT,
  recipe      TEXT,
  planned_for TEXT,
  sides       TEXT,                       -- JSON array of open-world side names
  PRIMARY KEY (tenant, recipe)
);

CREATE TABLE IF NOT EXISTS grocery_list (
  tenant          TEXT,
  name            TEXT,
  normalized_name TEXT,
  quantity        TEXT,
  kind            TEXT,
  domain          TEXT,
  status          TEXT,
  source          TEXT,
  for_recipes     TEXT,                   -- JSON array of recipe slugs
  note            TEXT,
  added_at        TEXT,
  ordered_at      TEXT,
  PRIMARY KEY (tenant, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_grocery_status ON grocery_list(tenant, status);
CREATE INDEX IF NOT EXISTS idx_pantry_category ON pantry(tenant, category);
