-- 0054_shop_commits_and_store_note_recency — offline-stores-and-store-walk.
-- Completion receipts are idempotency/audit records, not mutable walk sessions.

ALTER TABLE store_notes ADD COLUMN updated_at TEXT;
ALTER TABLE sku_cache ADD COLUMN price_regular REAL;
ALTER TABLE sku_cache ADD COLUMN price_promo REAL;
ALTER TABLE sku_cache ADD COLUMN price_captured_at TEXT;

CREATE TABLE shop_commits (
  tenant TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('store_walk','manual_shop')),
  store_slug TEXT,
  domain TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  PRIMARY KEY (tenant, session_id)
);
CREATE INDEX idx_shop_commits_committed ON shop_commits (tenant, committed_at);

-- Short-lived compare-and-swap claim for whole-document aisle-map reconciliation.
CREATE TABLE aisle_map_reconcile_claims (
  tenant TEXT NOT NULL,
  store_slug TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant, store_slug)
);

CREATE TABLE shop_commit_lines (
  tenant TEXT NOT NULL,
  session_id TEXT NOT NULL,
  line_key TEXT NOT NULL,
  line_json TEXT NOT NULL,
  PRIMARY KEY (tenant, session_id, line_key),
  FOREIGN KEY (tenant, session_id) REFERENCES shop_commits(tenant, session_id)
);
