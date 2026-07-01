-- 0008_recipe_embeddings — semantic recipe search (semantic-meal-plan, slice 1).
--
-- Two additive promoted columns on `recipes` + a sibling embedding table. All
-- additive: the pre-semantic flow ignores the new columns, and an empty
-- recipe_embeddings table is a valid "nothing indexed yet" state.
--
--   * `description` — the AI-written brief, craving-aligned summary of the dish. It
--     is the recipe's semantic-identity field: the embed source, the compact
--     per-candidate context row, and the user-facing "why this dish" line. Authored
--     content (recipe frontmatter, human-editable); the build projects it verbatim.
--   * `side_search_terms` — AI-memoized phrases describing the KIND of side that
--     complements this main ("bright acidic salad, crusty bread"); the semantic
--     side-retrieval query (tier 2 of the three-tier side model). JSON array as TEXT,
--     like the other multi-valued facet columns.
ALTER TABLE recipes ADD COLUMN description        TEXT;
ALTER TABLE recipes ADD COLUMN side_search_terms  TEXT;   -- JSON array of strings

-- The derived embedding of each recipe's description, in its OWN table rather than a
-- `recipes` column because it has a different producer and cadence: the build
-- replaces `recipes` wholesale on every recipe push (a full DELETE + re-INSERT that
-- would clobber a vector it doesn't own), whereas the embedding is reconciled
-- Worker-side on the cron (src/recipe-embeddings.ts) via the `env.AI` binding — the
-- Node build has no binding. Keying by `slug` lets each rebuild on its own cadence;
-- semantic search JOINs the two (facet-prefilter on recipes, cosine over the joined
-- vectors). See the semantic-meal-plan design's embedding-placement decision (B).
--
--   * `embedding` — JSON array of 768 floats (EMBED_DIM, @cf/baai/bge-base-en-v1.5)
--     as TEXT. Brute-force cosine in the Worker; exact, no second store.
--   * `description_hash` — hash of the description the vector was built from. The
--     reconcile re-embeds only when this differs (or the row is missing), so a steady
--     corpus does ~no work; it prunes rows whose slug no longer has a description.
--
-- No FK to recipes: `recipes` is rebuilt wholesale, so a hard FK would fight the
-- replace-all projection; the cron prunes orphans instead (slug NOT IN recipes).
CREATE TABLE IF NOT EXISTS recipe_embeddings (
  slug             TEXT PRIMARY KEY,
  embedding        TEXT NOT NULL,   -- JSON array of EMBED_DIM (768) floats
  description_hash TEXT NOT NULL    -- change-detection hash of the embedded description
);
