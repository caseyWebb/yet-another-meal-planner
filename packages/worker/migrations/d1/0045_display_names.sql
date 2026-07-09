-- 0045_display_names — reify a human-facing display name
-- (reify-ingredient-display-names). Adds a nullable `display_name` to the three surfaces
-- that carry an ingredient/item label, so a friendly presentation string is stored
-- distinct from the canonical id / resolver-input `name` used for matching and lookup.
--
-- All columns are additive and nullable — NO backfill. Existing rows read NULL and the
-- reader falls back to the derived label (labelOf) or the stored `name`, so nothing
-- changes for un-reified rows.
ALTER TABLE ingredient_identity ADD COLUMN display_name TEXT;
ALTER TABLE grocery_list ADD COLUMN display_name TEXT;
ALTER TABLE pantry ADD COLUMN display_name TEXT;
