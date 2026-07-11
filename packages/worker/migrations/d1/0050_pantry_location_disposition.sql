-- 0050_pantry_location_disposition — pantry-disposition-foundations.
--
-- Splits the pantry's conflated free-text `category` into two orthogonal controlled
-- fields — `location` (fridge | freezer | pantry | spice_rack | counter | cabinet) and
-- `category` (the 14-value food taxonomy) — adds the `waste_events` capture table
-- (removal-as-disposition), and adds the `ingredient_identity.category` memo the
-- `ingredient-category` cron fills (no backfill here; the cron converges it).
--
-- The one-time legacy remap below transposes location-flavored category values onto
-- `location` and maps the exact food-flavored values production holds onto the new
-- vocabulary; everything unmapped reads NULL (uncategorized — never an error) and
-- converges via the classifier pass. Ground truth: the pre-migration production
-- category distribution and expected post-remap counts are archived as the F1
-- acceptance-fixture table in
-- openspec/changes/archive/*pantry-disposition-foundations/design.md §8.

ALTER TABLE pantry ADD COLUMN location TEXT;
CREATE INDEX idx_pantry_location ON pantry(tenant, location);

-- Waste events (design D4): append-only from the write path; the ONLY subsequent
-- mutation is the pending-department fill (NULL → value, once, by the cron). PK
-- includes `tenant` so a client-minted event id can never collide with (or squat on)
-- another tenant's event. No `value` column — band 4 derives value from spend history.
CREATE TABLE waste_events (
  tenant        TEXT NOT NULL,
  id            TEXT NOT NULL,   -- client-minted event id (ULID); server-minted when omitted
  name          TEXT NOT NULL,   -- the row's display label at capture
  item_id       TEXT NOT NULL,   -- canonical ingredient id (the row's stored normalized_name)
  prepared_from TEXT,            -- recipe slug snapshot when the tossed row was a leftover
  quantity      TEXT,            -- the row's loose quantity at capture
  department    TEXT,            -- D17 stamp; NULL ONLY while pending classification (D5)
  reason        TEXT NOT NULL,   -- the canonical waste-reason enum (design D1)
  occurred_at   TEXT NOT NULL,   -- ISO date the toss happened
  created_at    TEXT NOT NULL,   -- ISO timestamp recorded
  PRIMARY KEY (tenant, id)
);
CREATE INDEX idx_waste_events_when ON waste_events(tenant, occurred_at);

-- The identity category memo (design D6): one of the 14 food categories or `household`
-- (the non-food catch-all). NULL = not yet classified; cron-owned, survivors only.
ALTER TABLE ingredient_identity ADD COLUMN category TEXT;

-- One-time legacy remap, location FIRST (computed from the pre-rewrite category),
-- then the category rewrite. Both match on LOWER(TRIM(category)).
UPDATE pantry SET location = 'pantry'     WHERE LOWER(TRIM(category)) = 'pantry';
UPDATE pantry SET location = 'fridge'     WHERE LOWER(TRIM(category)) = 'fridge';
UPDATE pantry SET location = 'freezer'    WHERE LOWER(TRIM(category)) = 'freezer';
UPDATE pantry SET location = 'spice_rack' WHERE LOWER(TRIM(category)) IN ('spice', 'spices', 'spice blend');

UPDATE pantry SET category = CASE LOWER(TRIM(category))
  WHEN 'spice'        THEN 'spices'
  WHEN 'spices'       THEN 'spices'
  WHEN 'spice blend'  THEN 'spices'
  WHEN 'condiment'    THEN 'condiments'
  WHEN 'baking'       THEN 'baking'
  WHEN 'canned goods' THEN 'canned'
  WHEN 'dairy'        THEN 'dairy'
  WHEN 'produce'      THEN 'produce'
  WHEN 'grain'        THEN 'grains'
  WHEN 'pasta'        THEN 'grains'
  WHEN 'meat'         THEN 'meat'
  WHEN 'bread'        THEN 'bakery'
  ELSE NULL
END;
