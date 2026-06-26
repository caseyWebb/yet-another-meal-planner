-- 0012_overlay_favorites_rejections — collapse the per-tenant overlay (and the
-- parallel ready_to_eat catalog) to a favorites/rejections model (BREAKING).
--
-- The `status` lifecycle (active/draft/rejected/archived) was an OPT-IN gate: a recipe
-- with no overlay row read as effective `draft` (hidden from list_recipes' default)
-- until a member set it `active`. That existed only because dump-and-reason loaded the
-- whole *active* set; semantic retrieval (recipe_semantic_search) made it obsolete. The
-- model flips to OPT-OUT: the whole shared corpus is available by default, and the
-- overlay records only the two deviations from neutral — `favorite` (loved) and
-- `reject` (hidden-from-me), mutually exclusive, a row iff favorited-or-rejected.
--
-- This is PURE SUBTRACTION except for one IRREVERSIBLE part: the visibility-default
-- flip. A rollback can re-add the dropped columns by migration, but the values are not
-- recovered and the "curated active set" semantics cannot be restored. The inert
-- `rating` column (unread since the favorite cutover, 0010) is dropped here too.

-- overlay: status → reject, drop status + rating ------------------------------
ALTER TABLE overlay ADD COLUMN reject INTEGER;        -- 1 = hidden-from-me; NULL/0 = visible

-- `rejected` carries forward as the hide mark; `active`/`draft` are neutral now.
UPDATE overlay SET reject = 1 WHERE status = 'rejected';

-- favorite ⊕ reject invariant: an explicit hide wins over a stale favorite on the
-- same row (a row could carry both under the old model, where the two tools did not
-- clear each other).
UPDATE overlay SET favorite = NULL WHERE reject = 1;

-- Neutral rows (the old active/draft, never favorited) become "no row": under opt-out
-- the absence of a row IS the available default, so they carry no information.
DELETE FROM overlay
  WHERE (favorite IS NULL OR favorite = 0)
    AND (reject   IS NULL OR reject   = 0);

ALTER TABLE overlay DROP COLUMN status;
ALTER TABLE overlay DROP COLUMN rating;

-- ready_to_eat: same collapse. The catalog ITEM is data (name/meal/…) and survives
-- regardless of disposition, so rows are NOT deleted — only `status` collapses to
-- `reject` and `favorite` is added (ready_to_eat never had a `rating` column).
ALTER TABLE ready_to_eat ADD COLUMN favorite INTEGER;  -- 1 = loved
ALTER TABLE ready_to_eat ADD COLUMN reject   INTEGER;  -- 1 = stop suggesting
UPDATE ready_to_eat SET reject = 1 WHERE status = 'rejected';
ALTER TABLE ready_to_eat DROP COLUMN status;
