CREATE TABLE IF NOT EXISTS operator_config (
  id               INTEGER PRIMARY KEY CHECK (id = 1), -- singleton: only row 1 is permitted
  -- Ranking weights (operator-wide defaults; per-tenant profile.rotation overrides on top)
  favorite_weight  REAL,    -- weight on taste-direction term (DEFAULT 0.15)
  novelty_boost    REAL,    -- magnitude of never-cooked boost / recent-cook demotion (DEFAULT 0.1)
  pantry_weight    REAL,    -- weight on saturated pantry-overlap term (DEFAULT 0.12)
  perish_weight    REAL,    -- per-item weight for perishable ingredient overlap (DEFAULT 1.0)
  key_weight       REAL,    -- per-item weight for key ingredient overlap (DEFAULT 0.4)
  overlap_cap      INTEGER, -- saturation ceiling for ingredient overlap (DEFAULT 2)
  -- Flyer / Kroger behavior
  min_flyer_discount  REAL,    -- minimum markdown fraction to count as flyer-worthy (DEFAULT 0.05)
  flyer_refresh_hours INTEGER, -- minimum hours between Kroger re-scans (DEFAULT 24)
  flyer_batch_units   INTEGER  -- (location, term) pairs processed per cron tick (DEFAULT 12)
);
