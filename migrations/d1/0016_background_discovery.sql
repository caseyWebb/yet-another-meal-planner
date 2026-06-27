-- 0016_background_discovery — schema for the autonomous background discovery sweep
-- (background-discovery-sweep change). Discovery moves from the in-chat, plan-time pull
-- into a fourth scheduled capture job that classifies/taste-matches/imports recipes; this
-- migration adds the queryable state that job and the meal-plan new-for-me read need.
--
-- Sweep-/reconcile-OWNED tables (discovery_matches, taste_derived, discovery_log) are
-- siblings of `recipes` — the recipe-index projection's wholesale DELETE+INSERT on
-- `recipes` must never own them (the same separation that put recipe_derived in a sibling
-- table). `discovered_at` is the ONE exception: it is authored frontmatter projected onto
-- `recipes`, so the projection writes it (see src/recipe-projection.ts).

-- discovered_at: promoted from the `recipes.extra` JSON blob to a queryable column so the
-- new-for-me read can filter `WHERE discovered_at > <watermark>` against an index. The
-- projection (src/recipe-projection.ts) writes it from each recipe's frontmatter.
ALTER TABLE recipes ADD COLUMN discovered_at TEXT;
CREATE INDEX IF NOT EXISTS idx_recipes_discovered_at ON recipes(discovered_at);

-- Per-tenant planning watermark: stamped when meal-plan saves an agreed plan; bounds the
-- new-for-me read so each member sees only discoveries newer than their last plan.
ALTER TABLE profile ADD COLUMN last_planned_at TEXT;

-- Per-member match attribution: which member(s) the sweep matched a recipe to. This one
-- record is BOTH the import gate (>=1 row -> import) AND the per-member new-for-me filter,
-- so the shared corpus never floods any one member with the group's combined discovery.
-- `score` is the taste cosine that cleared the threshold (provenance / log detail).
CREATE TABLE IF NOT EXISTS discovery_matches (
  recipe     TEXT NOT NULL,   -- recipe slug (joins recipes.slug)
  tenant     TEXT NOT NULL,
  score      REAL,
  matched_at TEXT,            -- YYYY-MM-DD
  PRIMARY KEY (recipe, tenant)
);
CREATE INDEX IF NOT EXISTS idx_discovery_matches_tenant ON discovery_matches(tenant);

-- Per-member taste vector, derived from `profile.taste` via env.AI and content-hash gated
-- (mirrors recipe_derived's description/embedding gate). The sweep's cosine recall scores a
-- candidate against this plus the member's favorite-recipe vectors. NULL/absent -> the
-- member is matched on favorites alone (or the cold-start fallback).
CREATE TABLE IF NOT EXISTS taste_derived (
  tenant     TEXT PRIMARY KEY,
  taste_hash TEXT,            -- hash of the taste text the vector was built from (gate)
  embedding  TEXT,            -- JSON array (EMBED_DIM floats), or NULL until first derived
  updated_at TEXT
);

-- The sweep's per-candidate outcome log: ONE table serving THREE roles, so the audit
-- surface and the operational state are not three tables (design Decision 11):
--   * the operator admin Discovery log  -> recent rows, any outcome (idx_..._created)
--   * the "already evaluated" dedup set  -> any row for a url (idx_..._url): don't re-process
--   * the parked-error surface           -> WHERE outcome = 'error' (read_discovery_errors)
-- Pruned under a retention window so it doesn't grow without bound (a no-match aged out of
-- the window may be re-evaluated later, which is acceptable).
CREATE TABLE IF NOT EXISTS discovery_log (
  id         TEXT PRIMARY KEY,   -- sweep-provided unique id
  url        TEXT,               -- canonical source URL (the dedup key)
  title      TEXT,
  source     TEXT,               -- feed name / sender address
  outcome    TEXT NOT NULL,      -- imported | duplicate | no_match | rejected_source | dietary_gated | error
  slug       TEXT,               -- resulting recipe slug (imports only)
  detail     TEXT,               -- JSON: attribution, matched-dup slug, validation error, etc.
  created_at TEXT                -- ISO timestamp (most-recent-first ordering)
);
CREATE INDEX IF NOT EXISTS idx_discovery_log_url ON discovery_log(url);
CREATE INDEX IF NOT EXISTS idx_discovery_log_created ON discovery_log(created_at);
CREATE INDEX IF NOT EXISTS idx_discovery_log_outcome ON discovery_log(outcome);
