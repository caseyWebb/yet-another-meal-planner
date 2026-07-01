-- Per-tenant planning cadence: how far out the caller plans/shops, in days (onboarding
-- asks a coarse few-days/weekly/two-weeks choice, mapped to a day count). Read alongside
-- default_cooking_nights (src/profile-db.ts); NULL falls back to the default 7-day window.
ALTER TABLE profile ADD COLUMN planning_cadence_days INTEGER;
