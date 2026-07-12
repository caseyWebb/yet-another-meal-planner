-- 0053_grocery_snapshot — grocery-list-page-and-widget.
--
-- Checked state is deliberately orthogonal to the online-cart lifecycle. Row versions
-- guard narrow/offline writes; the aggregate snapshot version is derived at read time.
ALTER TABLE grocery_list ADD COLUMN checked_at TEXT;
ALTER TABLE grocery_list ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE grocery_list ADD COLUMN updated_at TEXT;
-- Non-user-facing ownership stamp used only to prove that a decision (rather than a
-- racing ordinary add) created a row before Undo is allowed to delete it.
ALTER TABLE grocery_list ADD COLUMN decision_owner_token TEXT;

-- A send is immutable history once written. `placed_at` records the exact, idempotent
-- household purchase assertion; NULL means the send is still awaiting confirmation.
ALTER TABLE order_sends ADD COLUMN placed_at TEXT;
ALTER TABLE order_sends ADD COLUMN placement_token TEXT;

CREATE TABLE grocery_substitution_decisions (
  tenant                 TEXT NOT NULL,
  original_key           TEXT NOT NULL,
  replacement_key        TEXT NOT NULL,
  attribution_signature  TEXT NOT NULL,
  created_replacement    INTEGER NOT NULL DEFAULT 0,
  replacement_version    INTEGER,
  row_version            INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  operation_token         TEXT,
  ownership_token         TEXT,
  PRIMARY KEY (tenant, original_key)
);
CREATE INDEX idx_grocery_substitution_replacement
  ON grocery_substitution_decisions (tenant, replacement_key);

CREATE TABLE grocery_coverage_decisions (
  tenant               TEXT NOT NULL,
  line_key             TEXT NOT NULL,
  created_row          INTEGER NOT NULL DEFAULT 0,
  created_row_version  INTEGER,
  row_version          INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  operation_token       TEXT,
  ownership_token       TEXT,
  PRIMARY KEY (tenant, line_key)
);
CREATE INDEX idx_grocery_coverage_updated
  ON grocery_coverage_decisions (tenant, updated_at);
