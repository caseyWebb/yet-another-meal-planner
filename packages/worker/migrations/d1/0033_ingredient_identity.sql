-- 0025_ingredient_identity — organic ingredient normalization
-- (organic-ingredient-normalization). Generalizes the flat `aliases(variant, canonical)`
-- table into a directed identity graph the cron grows itself: an alias front-door
-- (variant -> canonical id), a node registry (base + optional detail + a union-find
-- `representative` pointer + a cron-owned embedding + a concrete/concept flag), directed
-- `satisfies` edges, a novel-term capture queue, and a decision audit log.
--
-- Canonical id format: `base` or `base::detail[::detail]`. The BASE keeps the existing
-- lowercase/space normalized form ("ground beef", "olive oil") so pre-change `sku_cache`
-- and `brand_prefs` keys resolve unchanged; the base is `id` up to the first "::". Details
-- are opaque discriminators to deterministic code (it only ever compares full-id or base).
--
-- Existing `aliases` rows were HUMAN-curated, so the backfill lands them as `source='human'`
-- base-level nodes (no "::") + their aliases, then drops the old table (superseded here, per
-- design.md D8). Variants are lowercased to match the hot-path exact lookup.

-- Canonical ingredient nodes. `representative` NULL = this id is its own survivor.
CREATE TABLE ingredient_identity (
  id             TEXT PRIMARY KEY,               -- canonical id; base = id up to first "::"
  base           TEXT NOT NULL,                  -- the base segment (id.split("::")[0])
  detail         TEXT,                           -- the "::"-joined detail suffix, or NULL for a bare base
  search_term    TEXT,                           -- human phrase for Kroger search ("80/20 ground beef")
  representative TEXT,                            -- union-find pointer to the surviving id, or NULL (self)
  concrete       INTEGER NOT NULL DEFAULT 1,     -- 0 = concept node (queryable class, not buyable)
  embedding      TEXT,                           -- JSON array of EMBED_DIM floats; cron-owned, NULL until embedded
  source         TEXT NOT NULL DEFAULT 'auto',   -- 'auto' | 'human' (human wins, never overwritten by auto)
  decided_at     INTEGER                         -- epoch ms
);

-- Surface form -> canonical id (the hot-path exact-match front door). Generalizes `aliases`.
CREATE TABLE ingredient_alias (
  variant    TEXT PRIMARY KEY,                   -- lowercased, quantity-stripped surface form
  id         TEXT NOT NULL,                      -- -> ingredient_identity.id (pre-representative)
  source     TEXT NOT NULL DEFAULT 'auto',       -- 'auto' | 'human'
  confidence REAL,                               -- classifier confidence, when auto
  decided_at INTEGER
);

-- Directed "satisfies" edges: from_id can be used where to_id is requested (reachability).
CREATE TABLE ingredient_edge (
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  kind       TEXT NOT NULL,                      -- 'general' | 'containment' | 'membership'
  source     TEXT NOT NULL DEFAULT 'auto',
  decided_at INTEGER,
  PRIMARY KEY (from_id, to_id, kind)
);

-- Novel-term capture queue: surface forms the resolver has not yet placed. `attempts` +
-- `next_retry_at` back the transient-failure retry (NULL next_retry_at = not deferred).
CREATE TABLE novel_ingredient_terms (
  term          TEXT PRIMARY KEY,
  first_seen    INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER
);

-- Capture decision audit log + evaluated-set (mirrors discovery_log's role).
CREATE TABLE ingredient_normalization_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  term        TEXT NOT NULL,
  outcome     TEXT NOT NULL,                     -- same | specialization | novel | merge | error | failed
  resolved_id TEXT,                              -- the id the term resolved/merged to
  candidates  TEXT,                              -- JSON [{id, score}] the embedder proposed
  model       TEXT,                              -- classifier model id, when a confirm ran
  detail      TEXT,                              -- JSON: reason / proposed edges / error message
  created_at  INTEGER
);

CREATE INDEX idx_ingredient_alias_id ON ingredient_alias (id);
CREATE INDEX idx_ingredient_edge_to ON ingredient_edge (to_id);
CREATE INDEX idx_ingredient_norm_log_outcome ON ingredient_normalization_log (outcome);

-- Backfill the curated aliases as human-sourced base-level nodes + their aliases.
INSERT OR IGNORE INTO ingredient_identity (id, base, source)
  SELECT DISTINCT canonical, canonical, 'human' FROM aliases WHERE TRIM(canonical) <> '';
INSERT OR IGNORE INTO ingredient_alias (variant, id, source)
  SELECT LOWER(TRIM(variant)), canonical, 'human'
    FROM aliases WHERE TRIM(variant) <> '' AND TRIM(canonical) <> '';

DROP TABLE aliases;
