-- 0013_recipe_derived — description becomes a Worker-DERIVED field (ai-derived-recipe-metadata).
--
-- The recipe `description` is AI-written, not human-authored, so it moves out of the
-- authored tier (frontmatter, projected onto `recipes` by the build) into the
-- reconcile-owned derived tier — co-located with its embedding, which is already
-- derived Worker-side on the cron. The two derived halves of one artifact (description
-- + its vector) now share one row, one producer, one cadence, one `slug` key.
--
-- The table is RECREATED (not ALTER-renamed) because the old `embedding` column is
-- `NOT NULL`, but the describe pass inserts a `{slug, description, content_hash}` row
-- BEFORE the embed pass fills the vector — so `embedding` must become nullable.
--
--   * `description`  — the AI-generated brief; reconcile-owned. NULL until first generated.
--   * `content_hash` — hash of the AUTHORED FACETS the description was generated from
--     (title, ingredients_key, course, protein, cuisine, time_total, dietary, season).
--     The describe pass regenerates only when this differs (or is NULL); NOT the body —
--     the reconcile stays pure D1 + AI.
--   * `embedding` (now NULLABLE) — JSON array of EMBED_DIM floats; filled by the embed pass.
--   * `description_hash` — hash of the description the vector was built from; gates re-embed.
--
-- `recipes.description` (added in 0008, build-projected from frontmatter) is dropped: the
-- build no longer projects it and the reconcile is its sole writer, so a lingering column
-- on the wholesale-rebuilt `recipes` table would be a confusing dead NULL.
CREATE TABLE recipe_derived (
  slug             TEXT PRIMARY KEY,
  description      TEXT,            -- AI-generated brief (reconcile-owned); NULL until generated
  content_hash     TEXT,            -- change-detection hash of the authored facets
  embedding        TEXT,            -- JSON array of EMBED_DIM (768) floats; NULL until embedded
  description_hash TEXT             -- change-detection hash of the embedded description
);

INSERT INTO recipe_derived (slug, embedding, description_hash)
  SELECT slug, embedding, description_hash FROM recipe_embeddings;

DROP TABLE recipe_embeddings;

ALTER TABLE recipes DROP COLUMN description;
