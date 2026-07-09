-- 0044_title_audit — the one-shot convergence stamp for the corpus title re-audit
-- (clean-discovery-import-titles / recipe-title-audit).
--
-- The scheduled title-audit pass (src/title-audit.ts) drains projected recipes with no row
-- here (the `audited_at` pattern), runs the guarded title-clean judgment, rewrites only the
-- R2 frontmatter `title` when it differs, and stamps the outcome one-shot; NEW writes are
-- born-stamped by both import paths (the sweep's importRecipe and create_recipe), so the
-- backlog is exactly the pre-existing corpus and the pass quiesces once drained.
--
-- A SIBLING table keyed by slug (like recipe_facets/recipe_derived), NOT a column on
-- `recipes`: the recipes table is a replace-all projection rebuilt each tick and cannot
-- carry a durable stamp. `before_title`/`after_title` are the audit trail (after_title only
-- on a `cleaned` outcome). Slugs are immutable ids — the audit never renames one.
CREATE TABLE IF NOT EXISTS title_audit (
  slug         TEXT PRIMARY KEY,
  audited_at   INTEGER NOT NULL,       -- epoch ms of the stamp
  outcome      TEXT NOT NULL,          -- 'kept' | 'cleaned'
  before_title TEXT,                   -- the title as audited (or at birth, for a born-stamp)
  after_title  TEXT                    -- the rewritten title ('cleaned' outcomes only)
);
