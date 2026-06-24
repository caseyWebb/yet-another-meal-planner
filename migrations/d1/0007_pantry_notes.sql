-- 0007_pantry_notes — add a freeform `notes` column to the per-tenant pantry table.
--
-- Pantry items can carry a short freeform note alongside the structured columns
-- (e.g. "freezer burned, best for stocks or stews", "opened — use first"). The
-- original 0005_session_state shape omitted it; this adds it so a note round-trips
-- through read_pantry / update_pantry. Existing rows get NULL and are populated by a
-- one-time data backfill from the retired `state:<tenant>:pantry` KV blobs.
ALTER TABLE pantry ADD COLUMN notes TEXT;
