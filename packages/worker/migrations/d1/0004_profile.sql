-- 0004_profile — the per-tenant grocery profile as normalized D1 tables (d1-profile,
-- slice 4). Replaces the `profile:<username>` KV bundle (a JSON envelope of
-- TOML/markdown strings). Reads assemble the profile from these rows; writes mutate
-- rows (no whole-blob rewrite, no TOML codec). The one-time backfill that fills these
-- from the KV bundle is migrations/0003-profile-d1.mjs.
--
-- `profile` is the singleton row per tenant: scalars + the two markdown fields +
-- freeform JSON columns (stores/dietary/custom/kitchen_notes). The child tables hold
-- the list/map fields so writes and admin edits are row-level. `brands` is a child
-- table (not a JSON column) specifically because the preferences merge-patch tri-state
-- maps onto row UPSERT (value/`[]`) vs DELETE (`null` → absent → ambiguous), and the
-- matcher reads it per-term. `idx_overlay_recipe` powers the cross-tenant group rating
-- (SELECT … FROM overlay WHERE recipe=?). Normalized-name columns preserve the
-- existing staples/stockup dedup semantics.

CREATE TABLE IF NOT EXISTS profile (
  tenant                      TEXT PRIMARY KEY,
  taste                       TEXT,     -- markdown
  diet_principles             TEXT,     -- markdown
  default_cooking_nights      INTEGER,
  lunch_strategy              TEXT,     -- leftovers | buy | mixed
  ready_to_eat_default_action TEXT,     -- opt-in | auto-add
  stores                      TEXT,     -- JSON: { primary, preferred_location, location_zip }
  dietary                     TEXT,     -- JSON: { avoid[], limit[] }
  custom                      TEXT,     -- JSON: arbitrary agent-added keys
  kitchen_notes               TEXT,     -- JSON: freeform cook-reasoning context
  freezer_capacity_estimate   TEXT
);

CREATE TABLE IF NOT EXISTS brand_prefs (
  tenant TEXT,
  term   TEXT,
  ranks  TEXT,                          -- JSON array; '[]' = don't-care, non-empty = ranked
  PRIMARY KEY (tenant, term)
);

CREATE TABLE IF NOT EXISTS kitchen_equipment (
  tenant TEXT,
  slug   TEXT,
  PRIMARY KEY (tenant, slug)
);

CREATE TABLE IF NOT EXISTS staples (
  tenant          TEXT,
  name            TEXT,
  normalized_name TEXT,
  perishable      INTEGER,
  PRIMARY KEY (tenant, normalized_name)
);

CREATE TABLE IF NOT EXISTS overlay (
  tenant TEXT,
  recipe TEXT,
  rating INTEGER,
  status TEXT,
  PRIMARY KEY (tenant, recipe)
);

CREATE TABLE IF NOT EXISTS ready_to_eat (
  tenant   TEXT,
  slug     TEXT,
  meal     TEXT,
  name     TEXT,
  status   TEXT,
  category TEXT,
  source   TEXT,
  brand    TEXT,
  notes    TEXT,
  PRIMARY KEY (tenant, slug)
);

CREATE TABLE IF NOT EXISTS stockup (
  tenant           TEXT,
  name             TEXT,
  normalized_name  TEXT,
  unit             TEXT,
  typical_purchase TEXT,
  notes            TEXT,
  baseline_price   REAL,
  buy_at_or_below  REAL,
  PRIMARY KEY (tenant, normalized_name)
);

-- Cross-tenant group-ratings aggregate (read_recipe_notes): SELECT … WHERE recipe=?.
CREATE INDEX IF NOT EXISTS idx_overlay_recipe ON overlay(recipe);
