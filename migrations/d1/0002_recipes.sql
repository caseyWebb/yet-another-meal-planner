-- 0002_recipes — the shared recipe index as a D1 table (d1-recipe-index, slice 1).
--
-- The recipe index is a DERIVED projection of recipes/*.md: the Worker reconcile
-- (src/recipe-projection.ts) reads the whole R2 corpus, validates it, then replaces this
-- table wholesale each cron tick (DELETE + batched INSERT in one transaction). The reconcile
-- owns the rows; the first pass after a fresh deploy populates them (the bootstrap guarantee).
--
-- Column shape (design "scalar + JSON + extra"):
--   * scalar columns for the promoted objective facets an admin UI sorts/filters on
--     and a future JOIN needs (slug PK, title, protein, cuisine, time_total,
--     ingredients_key, source_url). `ingredients_key` carries a JSON array as TEXT
--     (it is a short list, not a single value) — promoted to its own column but
--     parsed like the JSON-array columns below.
--   * JSON-array columns (TEXT holding a JSON array) for the multi-valued facets;
--     SQLite `json_each` can query them when a later slice wants SQL containment
--     filters, without a schema change now.
--   * `extra` (TEXT holding a JSON object) carries any OTHER objective frontmatter
--     (style, servings, difficulty, discovered_at, meal_preppable, …), keeping the
--     projection lossless so a new recipe field needs no migration until it is
--     promoted to a queryable column.
--
-- NO subjective/per-tenant fields (status, rating, last_cooked): those are stripped
-- from the shared index and merged at read time from the overlay + cooking log
-- (multi-tenant-friend-group §6.1). They arrive in their own slices.
CREATE TABLE IF NOT EXISTS recipes (
  slug                   TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  protein                TEXT,
  cuisine                TEXT,
  time_total             INTEGER,
  ingredients_key        TEXT,   -- JSON array (top 5–7 ingredients)
  source_url             TEXT,   -- the recipe's `source` frontmatter (import URL)
  tags                   TEXT,   -- JSON array
  course                 TEXT,   -- JSON array
  season                 TEXT,   -- JSON array
  dietary                TEXT,   -- JSON array
  pairs_with             TEXT,   -- JSON array
  perishable_ingredients TEXT,   -- JSON array
  requires_equipment     TEXT,   -- JSON array
  extra                  TEXT    -- JSON object: any other objective frontmatter
);

-- Discovery's idempotency check (`SELECT slug FROM recipes WHERE source_url = ?`) is
-- an indexed point lookup rather than a whole-index scan.
CREATE INDEX IF NOT EXISTS idx_recipes_source_url ON recipes(source_url);
