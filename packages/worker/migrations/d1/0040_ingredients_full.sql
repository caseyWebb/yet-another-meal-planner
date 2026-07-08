-- 0040_ingredients_full — the COMPLETE derived ingredient list (member-app-grocery D2).
--
-- `ingredients_full` is a new Tier A (derived-only) recipe facet: every ingredient the body
-- lists, as plain alias-normalized canonical ids (no amounts, no prep clauses, no
-- optional-markers) — the deterministic source the plan→to-buy derivation reads. One more
-- output field on the SAME classify call that already derives `ingredients_key`; stored on
-- `recipe_facets` as the classify-time snapshot and projected into `recipes` re-resolved
-- through the current resolver each tick (the existing snapshot-vs-index semantics).
ALTER TABLE recipe_facets ADD COLUMN ingredients_full TEXT; -- JSON array; NULL until derived
ALTER TABLE recipes ADD COLUMN ingredients_full TEXT;       -- projected effective value

-- Gate-clear: make every recipe stale to the classify pass so the existing corpus
-- re-derives `ingredients_full` ORGANICALLY over the bounded scheduled ticks (no manual
-- backfill). This is an intentional whole-corpus reclassification — the exact path a body
-- edit takes, at corpus scale, bounded per tick and quota-aware; stored facet VALUES are
-- untouched here (idempotent hash-gated convergence, no data loss), and authored Tier B
-- overrides survive by construction (the projection-time merge, not classify time).
-- Consumers treat a not-yet-derived recipe as an explicit reported gap (`underived`),
-- never as an empty ingredient list.
UPDATE recipe_facets SET body_hash = NULL;
