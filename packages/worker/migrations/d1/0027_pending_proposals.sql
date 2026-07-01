-- 0027_pending_proposals — the profile-reconciliation queue (propose-meal-plan-tool change,
-- profile-reconciliation capability). Each row is a proposed profile edit (add/adjust/prune a
-- night vibe, …) reconciling STATED preference (the palette/profile) against REVEALED behavior
-- (the cooking log + in-app edits). A per-member queue the member confirms from either surface;
-- the PRODUCER is pluggable (the deterministic signal cron, or the operator's frontier). `id`
-- is a STABLE hash of (kind, target[, cadence bucket]) so re-enqueue is idempotent (INSERT OR
-- IGNORE) and a proposal the member already rejected is never re-surfaced. Tenant is NOT in the
-- hash — the PRIMARY KEY is (tenant, id), so a hash collision can at worst clobber within one
-- tenant, never drop another member's proposal.
CREATE TABLE IF NOT EXISTS pending_proposals (
  id          TEXT NOT NULL,      -- stable hash(kind|target[|cadence bucket]) — dedup + no-re-propose
  tenant      TEXT NOT NULL,      -- the member the proposal is for
  kind        TEXT NOT NULL,      -- add_vibe | adjust_cadence | prune_vibe
  target      TEXT,               -- the vibe id the proposal acts on
  payload     TEXT,               -- JSON: the proposed profile diff
  rationale   TEXT,               -- human-readable "why"
  evidence    TEXT,               -- JSON: the signals that triggered it
  status      TEXT NOT NULL,      -- pending | accepted | rejected
  producer    TEXT,               -- signal-cron | edge | operator
  created_at  TEXT,
  resolved_at TEXT,               -- when accepted/rejected
  PRIMARY KEY (tenant, id)
);
CREATE INDEX IF NOT EXISTS idx_pending_proposals_tenant_status ON pending_proposals(tenant, status);
