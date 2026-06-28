-- Per-tenant retrospective preferences (no user-facing write tool yet; future work).
-- JSON: { stale_after_days, revealed_months, revealed_min_cooks }
-- Absent (NULL) falls back to retrospective() compiled defaults.
ALTER TABLE profile ADD COLUMN retrospective_prefs TEXT;
