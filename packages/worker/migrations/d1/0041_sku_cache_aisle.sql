-- 0041_sku_cache_aisle — aisle placement capture on the SKU cache
-- (member-app-differentiators D5). Four nullable columns carrying the resolved
-- candidate's Kroger `aisleLocation` at the row's `location_id`, written by
-- `place_order`'s batched commit (refresh-on-difference) and stamped
-- `aisle_captured_at` when placement data is present. No backfill: existing rows
-- start NULL and converge organically as orders resolve their lines (repo rule —
-- convergence through the pipeline, never manual surgery).
ALTER TABLE sku_cache ADD COLUMN aisle_number TEXT;
ALTER TABLE sku_cache ADD COLUMN aisle_description TEXT;
ALTER TABLE sku_cache ADD COLUMN aisle_side TEXT;
ALTER TABLE sku_cache ADD COLUMN aisle_captured_at TEXT;
