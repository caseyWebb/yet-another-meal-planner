-- 0026_slot_provenance — night-vibe SLOT PROVENANCE (propose-meal-plan-tool change; the
-- meal-planning + cooking-history capabilities). A `meal_plan` row records the night-vibe
-- slot it was proposed to fill (`from_vibe`); when the recipe is cooked, `log_cooked` reads
-- that from the planned row and writes it onto the `cooking_log` row (`satisfied_vibe`) in the
-- same batch that clears the plan, so the cadence scheduler can attribute satisfaction back to
-- the vibe that shaped the slot ("shape in → shape out"). Both columns are additive + optional:
-- absent for a hand-picked / off-vibe plan, and behavior-preserving when null.
ALTER TABLE meal_plan ADD COLUMN from_vibe TEXT;
ALTER TABLE cooking_log ADD COLUMN satisfied_vibe TEXT;

-- Backs the derived `last_satisfied(vibe) = MAX(date) WHERE satisfied_vibe = id` read the
-- cadence-debt scheduler runs each proposal.
CREATE INDEX IF NOT EXISTS idx_cooking_log_satisfied_vibe ON cooking_log(tenant, satisfied_vibe);
