-- 0034_reconfirm — periodic identity re-confirm (periodic-identity-reconfirm).
-- The scheduled re-confirm pass re-examines edgeless concrete auto-nodes against the
-- now-denser registry and enriches them (adds satisfies edges / merges a clear synonym).
-- Two columns back it: a one-shot stamp on the node (the eligibility filter + self-quiesce),
-- and a marker on each log row so a re-confirm decision is distinguishable from an initial
-- capture in the Normalization Decisions view.

-- One-shot re-confirm stamp: NULL = not yet re-confirmed (eligible), else epoch ms.
ALTER TABLE ingredient_identity ADD COLUMN reconfirmed_at INTEGER;

-- Marks a normalization-log decision as produced by the re-confirm pass (1) vs capture (0).
ALTER TABLE ingredient_normalization_log ADD COLUMN is_reconfirm INTEGER NOT NULL DEFAULT 0;
