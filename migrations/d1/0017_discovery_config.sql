-- 0017_discovery_config — operator-tunable discovery sweep configuration
-- (discovery-calibration-console change). The discovery sweep's knobs (τ, triage threshold,
-- δ, classify cap, rate cap) move from hardcoded DEFAULT_CONFIG constants to a D1-backed
-- sparse override; the sweep reads and merges at job start. KV is reserved for ephemeral
-- infra; this is operational config, same tier as feeds / flyer_terms.
--
-- Single-row table (no tenant column — knobs are global to the group). All knob columns are
-- nullable: absent = use the compiled DEFAULT_CONFIG value for that knob. The sparse-override
-- design keeps DEFAULT_CONFIG as the single source of truth for sane defaults; the table only
-- records deltas an operator has explicitly chosen.

CREATE TABLE IF NOT EXISTS discovery_config (
  id               INTEGER PRIMARY KEY CHECK (id = 1), -- singleton: only row 1 is permitted
  taste_threshold  REAL,    -- τ: cosine a member must clear to match (DEFAULT 0.55)
  triage_threshold REAL,    -- loose gate for cheap title+summary embed (DEFAULT 0.45)
  dedup_threshold  REAL,    -- δ: near-duplicate cosine vs corpus (DEFAULT 0.9)
  classify_max     INTEGER, -- max candidates classified per tick (DEFAULT 12)
  rate_cap         INTEGER  -- max imports per tick (DEFAULT 10)
);
