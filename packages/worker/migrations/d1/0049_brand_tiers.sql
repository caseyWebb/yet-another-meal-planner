-- 0049_brand_tiers.sql — brands→tiers model (brand-tier-model change).
-- Each legacy rank becomes its own tier; legacy '[]' (don't-care) becomes any_brand=1.
-- A NULL/invalid ranks value read as don't-care under the shipped tolerant parser, so it
-- migrates to any_brand=1 with no tiers (production holds none — defensive only).
CREATE TABLE brand_prefs_tiers (
  tenant    TEXT,
  term      TEXT,
  tiers     TEXT NOT NULL DEFAULT '[]',   -- JSON string[][]
  any_brand INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant, term)
);
INSERT INTO brand_prefs_tiers (tenant, term, tiers, any_brand)
SELECT
  tenant,
  term,
  CASE
    WHEN ranks IS NOT NULL AND json_valid(ranks) AND json_type(ranks) = 'array'
    THEN (SELECT json_group_array(json_array(value))
          FROM (SELECT value FROM json_each(brand_prefs.ranks) ORDER BY key))
    ELSE '[]'
  END,
  CASE
    WHEN ranks IS NULL OR NOT json_valid(ranks) OR json_type(ranks) != 'array' OR ranks = '[]'
    THEN 1 ELSE 0
  END
FROM brand_prefs;
DROP TABLE brand_prefs;
ALTER TABLE brand_prefs_tiers RENAME TO brand_prefs;
