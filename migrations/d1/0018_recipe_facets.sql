-- 0018_recipe_facets — recipe FACETS become Worker-DERIVED on the cron (derive-recipe-facets).
--
-- The descriptive recipe facets move out of authored R2 frontmatter into a cron-derived,
-- reconcile-independent D1 table, generalizing the discovery classifier over the WHOLE
-- corpus (see the recipe-facet-derivation capability). The classify pass writes the RAW
-- classifier output here; the recipe-index projection merges the EFFECTIVE value into
-- `recipes` (Tier A classified-wins; Tier B authored-override ?? classified; tags
-- unioned), so every reader keeps reading `recipes` columns unchanged.
--
-- A SIBLING of `recipes` (like recipe_derived / taste_derived), keyed by slug, so the
-- index projection's wholesale DELETE+INSERT of `recipes` never clobbers it — a different
-- producer + cadence than the projection (body-gated vs corpus-gated), the same reason
-- recipe_derived is a separate table.
--
--   * body_hash — change-detection hash over the recipe BODY + the authored Tier-B
--     overrides the classifier conditions on. The classify pass reclassifies only when
--     this differs (or is NULL), so a steady corpus does ~no work.
--   * Tier A (classified-only): ingredients_key, perishable_ingredients,
--     side_search_terms, meal_preppable.
--   * Tier B (classified default; an authored frontmatter value overrides at merge):
--     protein, cuisine, course, season, tags.
--   * Tier C (dietary, requires_equipment, time_total) is NOT here — it stays authored.
CREATE TABLE recipe_facets (
  slug                   TEXT PRIMARY KEY,
  body_hash              TEXT,    -- gate: hash(body + conditioning overrides); NULL until first classified
  protein                TEXT,    -- classified coarse bucket or NULL
  cuisine                TEXT,    -- classified coarse bucket or NULL
  course                 TEXT,    -- JSON array of strings (open vocab)
  season                 TEXT,    -- JSON array of SEASON_VOCAB tokens
  tags                   TEXT,    -- JSON array of strings
  ingredients_key        TEXT,    -- JSON array of normalized ingredient names
  perishable_ingredients TEXT,    -- JSON array of normalized ingredient names
  side_search_terms      TEXT,    -- JSON array of strings
  meal_preppable         INTEGER  -- 0/1 boolean; NULL until classified
);
