-- 0051_spend_capture — spend-capture-on-order-commit.
--
-- Spend telemetry's two-phase capture (D16): the SEND RECORD snapshot persisted by the
-- order flushes (`order_sends` + `order_send_lines`, written in the same batch as the
-- in-cart advance) and the `spend_events` materialized at the purchase assertion (the
-- guarded in_cart → ordered advance) by the ONE shared writer (src/spend.ts), copying
-- the snapshot verbatim. `grocery_list.sent_in` is the internal row↔send linkage the
-- materializer keys on; `profile.weekly_budget` is the household budget preference.
-- Purely additive — production has zero lifecycle history (spike-verified), no backfill.
-- Assumes 0050 (`ingredient_identity.category`) is applied: the NULL-pending
-- `department` stamps on both line tables converge via the ingredient-category cron.

CREATE TABLE order_sends (
  id            TEXT PRIMARY KEY,   -- place_order: minted per flush; satellite: the order_list id
  tenant        TEXT NOT NULL,
  store         TEXT NOT NULL,      -- 'kroger' | the satellite store slug
  location_id   TEXT,               -- resolved Kroger locationId; the order-list's (nullable)
  fulfillment   TEXT NOT NULL,      -- 'kroger_online' | 'satellite'
  order_list_id TEXT,               -- satellite correlation; NULL on the Kroger path
  created_at    TEXT NOT NULL       -- ISO 8601
);
CREATE INDEX idx_order_sends_tenant ON order_sends (tenant, created_at);

CREATE TABLE order_send_lines (
  send_id       TEXT NOT NULL,
  line_key      TEXT NOT NULL,      -- === grocery_list.normalized_name (the canonical key the advance uses)
  name          TEXT NOT NULL,      -- display at send
  sku           TEXT,               -- Kroger UPC / satellite productId; NULL when unreported
  brand         TEXT,
  size          TEXT,
  quantity      INTEGER NOT NULL,   -- package count sent
  price_regular REAL,               -- per-package regular price at resolution (NULL on the satellite path)
  price_promo   REAL,
  on_sale       INTEGER,            -- 1/0; NULL = unknown (satellite)
  unit_price    REAL,               -- effective per-package price: promo when on sale else regular;
                                    -- the satellite's observed product.price; NULL when unpriced
  savings       REAL,               -- deriveSavings(regular, promo) when on sale, else 0; NULL = unknown
  estimated     INTEGER NOT NULL DEFAULT 0,  -- 1 = fallback-priced (band 3); send-path quotes are 0
  department    TEXT,               -- D17 stamp; NULL ONLY while pending classification
  provenance    TEXT NOT NULL,      -- 'planned' | 'impulse'
  for_recipes   TEXT,               -- JSON array
  PRIMARY KEY (send_id, line_key)
);

CREATE TABLE spend_events (
  send_id     TEXT NOT NULL,
  line_key    TEXT NOT NULL,
  tenant      TEXT NOT NULL,
  occurred_on TEXT NOT NULL,        -- ISO date of the purchase assertion (parity with ordered_at)
  name        TEXT NOT NULL,
  sku         TEXT,
  quantity    INTEGER NOT NULL,
  unit_price  REAL,                 -- copied verbatim from the snapshot line
  amount      REAL,                 -- unit_price * quantity; NULL when the snapshot was unpriced
  savings     REAL,
  estimated   INTEGER NOT NULL DEFAULT 0,
  department  TEXT,                -- copied from the snapshot line; NULL ONLY while pending (filled once by the ingredient-category job)
  provenance  TEXT NOT NULL,
  store       TEXT NOT NULL,
  fulfillment TEXT NOT NULL,
  voided_at   TEXT,
  PRIMARY KEY (send_id, line_key)   -- D16's idempotency key
);
CREATE INDEX idx_spend_events_tenant ON spend_events (tenant, occurred_on);
CREATE INDEX idx_spend_events_item   ON spend_events (tenant, line_key, occurred_on);

-- The row↔send linkage: stamped ONLY by the snapshot-writing order-flush advances,
-- cleared when the row leaves the flight without a purchase assertion. Internal —
-- never caller-writable on any tool or HTTP surface.
ALTER TABLE grocery_list ADD COLUMN sent_in TEXT;

-- The household weekly grocery budget (dollars/week); NULL or 0 = no budget line.
ALTER TABLE profile ADD COLUMN weekly_budget REAL;
