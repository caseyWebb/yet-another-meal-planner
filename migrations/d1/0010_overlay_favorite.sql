-- 0010_overlay_favorite — the rating→favorite cutover (semantic-meal-plan, BREAKING).
--
-- The 1–5 `rating` becomes a `favorite` boolean: a crisp anchor set for the
-- semantic-search nearest-liked re-rank, and a simpler group signal (COUNT(favorite)
-- vs AVG(rating)). The lost granularity is recovered, more honestly, from revealed
-- preference (cook frequency in the cooking log).
--
-- ADDITIVE + reversible: this adds `favorite` and backfills `rating >= 4 => 1`, but
-- KEEPS the `rating` column (the code stops reading/writing it; new overlay writes set
-- favorite/status and leave rating untouched) so the cutover can be rolled back. A
-- later migration drops `rating` once the new path is proven.
ALTER TABLE overlay ADD COLUMN favorite INTEGER;   -- 1 = favorited; NULL/0 = not

-- Backfill: a 4–5 star rating was the de-facto "I like this", so it seeds the
-- favorite set. Lower ratings carry no positive signal and are left unfavorited.
UPDATE overlay SET favorite = 1 WHERE rating >= 4;
