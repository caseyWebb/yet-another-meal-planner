-- 0025_night_vibes — the per-tenant NIGHT-VIBE PALETTE (propose-meal-plan-tool change,
-- night-vibe-palette capability). A "night vibe" is a saved search-spec (a `vibe` phrase +
-- optional hard-gate `facets`) plus lifecycle metadata (a cadence period, weather affinity,
-- a seasonal lean): the durable, editable "shape of a week" that the two-level
-- propose_meal_plan planner samples from at Level 1, then fills at Level 2.
--
-- Per-tenant PRIVATE profile data — a sibling of `staples`/`stockup`, isolated by `tenant`,
-- never shared. Its derived embedding lives in the sibling `night_vibe_derived` (hash-gated,
-- reconciled Worker-side like `taste_derived`), so the palette CRUD and the embedding
-- reconcile own their own rows and neither clobbers the other.

CREATE TABLE IF NOT EXISTS night_vibes (
  tenant            TEXT NOT NULL,
  id                TEXT NOT NULL,   -- stable per-tenant vibe id (slug)
  vibe              TEXT NOT NULL,   -- the free-text craving/query phrase (the slot's retrieval query)
  facets            TEXT,            -- JSON object: optional hard-gate facets for the slot (NULL = none)
  cadence_days      INTEGER,         -- target period in days; NULL = no cadence (occasional/weighted)
  pinned            INTEGER NOT NULL DEFAULT 0,  -- 1 = sticky weekly intent (placed when due, exempt from the weather reserve)
  base_weight       REAL,            -- base sampling weight before debt/weather (NULL → 1)
  weather_affinity  TEXT,            -- JSON string[]: weather meal_vibes that favor this vibe (NULL = [])
  weather_antipathy TEXT,            -- JSON string[]: weather meal_vibes that suppress it (NULL = [])
  season            TEXT,            -- JSON string[]: seasonal lean (spring|summer|fall|winter) (NULL = [])
  created_at        TEXT,
  updated_at        TEXT,
  PRIMARY KEY (tenant, id)
);
CREATE INDEX IF NOT EXISTS idx_night_vibes_tenant ON night_vibes(tenant);

-- Per-vibe derived embedding, hash-gated on the vibe text (mirrors taste_derived). The
-- reconcile (re)embeds a vibe whose text hash changed and prunes rows whose (tenant,id) no
-- longer has a vibe. NULL embedding until first derived → the vibe is "not yet indexed" for
-- Level-2 fill (handled gracefully, never an error).
CREATE TABLE IF NOT EXISTS night_vibe_derived (
  tenant     TEXT NOT NULL,
  id         TEXT NOT NULL,
  vibe_hash  TEXT,            -- hash of the vibe text the vector was built from (the gate)
  embedding  TEXT,            -- JSON array (EMBED_DIM floats), or NULL until first derived
  updated_at TEXT,
  PRIMARY KEY (tenant, id)
);
