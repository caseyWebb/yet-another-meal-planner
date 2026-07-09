-- 0045_dup_scan — the corpus dup-scan's per-recipe watermark (corpus-dedup-reconcile /
-- recipe-dedup).
--
-- The scheduled dup-scan (src/dup-scan.ts, `scheduled()` phase 5) compares corpus recipes'
-- description vectors + `ingredients_key` overlap against each other, bounded per tick.
-- `scanned_hash` = hashText(description_hash + "|" + ingredients_key JSON) at scan time:
-- a missing or differing stamp re-queues the recipe (a re-described/re-embedded recipe's
-- description_hash changes; a facet re-derivation changes the key), so the scan converges
-- once and then quiesces to a no-op. Rows for slugs no longer in `recipe_derived` are
-- pruned by the job each tick (never wholesale-replaced — the stamp is durable state, a
-- sibling of recipe_facets/recipe_derived/title_audit, not a projection).
CREATE TABLE IF NOT EXISTS dup_scan (
  slug         TEXT PRIMARY KEY,
  scanned_hash TEXT NOT NULL,  -- hash of (description_hash | ingredients_key JSON) at scan time
  scanned_at   TEXT NOT NULL   -- ISO timestamp of the stamp
);
