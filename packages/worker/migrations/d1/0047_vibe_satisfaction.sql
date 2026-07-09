-- 0047_vibe_satisfaction — cook-time VIBE SATISFACTION records (converge-meal-planning-surfaces,
-- D4; the cooking-history + night-vibe-palette capabilities). Night-vibe cadence attribution
-- moves from plan-time SLOT PROVENANCE to a COOK-TIME COSINE MATCH: when a recipe is cooked,
-- `log_cooked` cosine-matches the cooked recipe's embedding against the caller's night-vibe palette
-- (both vectors are cron-captured — `recipe_derived` / `night_vibe_derived` — so there is NO new AI
-- call) and writes one row here per vibe it satisfies: the cleared plan row's `from_vibe` as a
-- GUARANTEED-RESET PRIOR (always recorded, even at a borderline cosine), unioned with every palette
-- vibe the recipe matches at/above a calibrated threshold. A single cook MAY satisfy MORE THAN ONE
-- vibe, and an OFF-PLAN cook (no plan row, or one without `from_vibe`) still resets any vibe it
-- genuinely matches — off-plan cooks are no longer null-attributed.
--
-- One row per (cook, vibe): keyed by the cooking_log row × vibe so a cook's multi-vibe reset is N
-- rows and `last_satisfied(vibe) = MAX(date)` derives cheaply per (tenant, vibe). `score` is the
-- cosine at attribution time — provenance for calibrating the thresholds against real cook logs; it
-- does NOT scale the reset (any record fully advances the vibe's cadence to the cook date). `date`
-- is denormalized from the cooking_log row so the MAX(date) derivation needs no JOIN. The rows are
-- written in the SAME D1 batch as the cooking_log insert + the meal-plan clear (atomic).
--
-- Per-tenant PRIVATE, isolated by `tenant`. `cooking_log_id` is a SOFT reference to the cooking_log
-- row (no FK — history survives an admin edit/delete, mirroring the log's own history-preserving
-- stance); `vibe_id` is a soft ref to `night_vibes.id` (a since-deleted vibe simply never matches a
-- live palette row on read). `last_satisfied` is NEVER stored on the vibe — it stays a derived query.
CREATE TABLE IF NOT EXISTS vibe_satisfaction (
  tenant         TEXT NOT NULL,
  cooking_log_id INTEGER NOT NULL,  -- the cooking_log row that satisfied the vibe (soft ref, no FK)
  vibe_id        TEXT NOT NULL,     -- the night_vibes id satisfied (soft ref)
  date           TEXT NOT NULL,     -- YYYY-MM-DD of the cook (denormalized from cooking_log)
  score          REAL,              -- cosine at attribution time (provenance only; NULL when unknown)
  PRIMARY KEY (tenant, cooking_log_id, vibe_id)
);

-- Backs the derived last_satisfied(vibe) = MAX(date) GROUP BY vibe_id read the cadence-debt
-- scheduler + the profile palette run each proposal.
CREATE INDEX IF NOT EXISTS idx_vibe_satisfaction_vibe ON vibe_satisfaction(tenant, vibe_id);

-- Backfill: carry the existing provenance-stamped history (cooking_log.satisfied_vibe, migration
-- 0026) into the new records so past attribution is not lost when `readVibeLastSatisfied` switches
-- its source here. `score` is NULL — these rows predate cosine attribution, so the cosine is unknown;
-- the guaranteed-prior semantics are unchanged (they were an explicitly-aimed slot).
INSERT OR IGNORE INTO vibe_satisfaction (tenant, cooking_log_id, vibe_id, date, score)
  SELECT tenant, id, satisfied_vibe, date, NULL
  FROM cooking_log
  WHERE satisfied_vibe IS NOT NULL;
