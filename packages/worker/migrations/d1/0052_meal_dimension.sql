-- 0052_meal_dimension — meal-dimension-foundations (band 1).
--
-- The meal dimension lands on plan/log/vibes/cadence in one forward-only pass:
--   * meal_plan moves to PER-SLOT identity (D26-final): PRIMARY KEY (tenant, id) with
--     SQL-minted 32-hex ids for the existing rows (new mints are ULIDs — src/ids.ts);
--     `meal` is a closed set defaulting 'dinner'. SQLite cannot alter a PK: rebuild.
--     Deliberately NO unique index on (tenant, recipe) — duplicates are legal by
--     explicit user action; uniqueness moves to the op layer's slug-global coalesce.
--     No project CHECK beyond the meal set — the "no date/sides on a project" rule is
--     op-layer enforcement (a structured conflict, never a raw SQL failure).
--   * cooking_log gains a NULLABLE `meal` — existing rows stay NULL ("unknown / not a
--     meal"), never fabricated.
--   * night_vibes gains `meal` (NOT NULL default 'dinner' — semantically correct for
--     every live row) and `members` (JSON string[]; NULL = everyone; D29-final
--     readiness). NO table rename (D21 is a tool-contract decision), and ZERO
--     re-embeds: night_vibe_derived's vibe_hash gates on the vibe TEXT, which no row
--     here changes.
--   * profile gains the per-meal `cadence` map, backfilled from the frozen
--     `default_cooking_nights` COLUMN (the defined column wins over any `custom`-bag
--     shadow — precedence, not merge; the `custom` bag is untouched). The retired
--     lunch_strategy / ready_to_eat_default_action columns are NOT dropped here —
--     they converge to NULL via the pref-retirement seed pass and drop (with
--     default_cooking_nights) in the window-close cleanup migration.

-- meal_plan: per-slot identity (D26-final). SQLite cannot alter a PK: rebuild.
CREATE TABLE meal_plan_v2 (
  tenant      TEXT NOT NULL,
  id          TEXT NOT NULL,               -- opaque row id; new mints are ULIDs
  recipe      TEXT NOT NULL,
  meal        TEXT NOT NULL DEFAULT 'dinner'
              CHECK (meal IN ('breakfast','lunch','dinner','project')),
  planned_for TEXT,
  sides       TEXT,
  from_vibe   TEXT,
  PRIMARY KEY (tenant, id)                 -- per-tenant-table precedent; cross-tenant
);                                         -- id collision structurally impossible
INSERT INTO meal_plan_v2 (tenant, id, recipe, meal, planned_for, sides, from_vibe)
  SELECT tenant, lower(hex(randomblob(16))), recipe, 'dinner', planned_for, sides, from_vibe
  FROM meal_plan;
DROP TABLE meal_plan;
ALTER TABLE meal_plan_v2 RENAME TO meal_plan;
CREATE INDEX meal_plan_tenant_recipe ON meal_plan (tenant, recipe);

-- cooking_log: meal is nullable — existing rows stay NULL ("unknown"), never fabricated.
ALTER TABLE cooking_log ADD COLUMN meal TEXT
  CHECK (meal IN ('breakfast','lunch','dinner','project'));

-- night_vibes: meal dimension + band-5-ready member assignment (D29-final). NO table rename.
ALTER TABLE night_vibes ADD COLUMN meal TEXT NOT NULL DEFAULT 'dinner'
  CHECK (meal IN ('breakfast','lunch','dinner'));
ALTER TABLE night_vibes ADD COLUMN members TEXT;   -- JSON string[]; NULL = everyone

-- profile: per-meal cadence map. Shape backfill is legitimate one-shot SQL (identity/shape,
-- like the id mint); the VALUE migration for retired prefs is pipeline convergence
-- (runPrefRetirementSeedJob).
ALTER TABLE profile ADD COLUMN cadence TEXT;       -- JSON {breakfast, lunch, dinner}
UPDATE profile
  SET cadence = json_object('breakfast', 0, 'lunch', 0, 'dinner', default_cooking_nights)
  WHERE default_cooking_nights IS NOT NULL;
