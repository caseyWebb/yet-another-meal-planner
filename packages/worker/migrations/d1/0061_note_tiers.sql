-- 0061_note_tiers — recipe-note visibility tiers (note-visibility-tiers, D30-final).
-- One ALTER + a pure-mapping backfill, no other data change:
--
--   * recipe_notes.tier — 'public' | 'friends' | 'private'; the source of truth on
--     every read and write from this migration on. The legacy `private` column is
--     RETAINED and dual-written (`private = 1` exactly when `tier = 'private'`) so a
--     rolled-back Worker reading only `private` never widens a private note's
--     audience. Nullable by construction (SQLite ADD COLUMN): a row inserted by old
--     code during a rollback window carries NULL and heals at read time via the same
--     COALESCE mapping the backfill applies (converge-don't-surgeon).
--
--   * the backfill — D30-final's exact mapping: `private = 1` → 'private', everything
--     else → 'friends' (today's shared note IS the friends tier: under self-hosted's
--     implicit all-to-all graph it reaches exactly the same audience). NULL-guarded,
--     so re-running the statement is a no-op over already-mapped rows.
--
-- Store notes are deliberately NOT tiered (household-scoped surface; D30 is a
-- recipe-notes decision) — `store_notes` keeps the binary `private` flag.
ALTER TABLE recipe_notes ADD COLUMN tier TEXT
  CHECK (tier IN ('public','friends','private'));

UPDATE recipe_notes
   SET tier = CASE WHEN private = 1 THEN 'private' ELSE 'friends' END
 WHERE tier IS NULL;
