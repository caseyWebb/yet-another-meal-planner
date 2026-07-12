## ADDED Requirements

### Requirement: Walk and manual-shop spend materializes from the completion receipt

The one shared `src/spend.ts` write boundary SHALL materialize spend for every shop-commit receipt line at completion; neither `/api`, MCP tools, member UI, nor skills SHALL write spend directly. For each grocery-domain line the deterministic estimate ladder SHALL use, in order, the most recent matching SKU-cache store price, the current matching warmed flyer, the household's most recent non-voided paid unit price for the canonical key, then NULL-unpriced. It SHALL make no external request. A loose quantity SHALL use an unambiguous leading positive count or one with `quantity_assumed=true`.

Every `store_walk`/`manual_shop` event SHALL carry `estimated=1`, even when a cached price exists, plus price source, resolved store/fulfillment, capture-time department, provenance, unit price/amount/savings when known, and a deterministic tenant/session/line identity. An unpriced line SHALL still produce an estimated event with NULL price/amount. The immutable shop receipt SHALL be the replay source and SHALL never be re-priced.

#### Scenario: Estimation follows the exact ladder
- **WHEN** SKU cache misses, a current flyer price exists, and last-paid also exists for a committed line
- **THEN** the event/receipt use the flyer value, mark it estimated with `price_source:'flyer'`, and perform no live lookup

#### Scenario: Last-paid fills after store sources miss
- **WHEN** neither store SKU cache nor warmed flyer can price a line but the household has a non-voided prior paid unit price
- **THEN** shop completion copies that unit price with `price_source:'last_paid'` and `estimated=1`

#### Scenario: Unpriced purchase remains observable
- **WHEN** every fallback misses
- **THEN** one estimated spend event and receipt line remain with NULL unit price/amount rather than a fabricated total

#### Scenario: Replay does not re-price or duplicate
- **WHEN** a completed shop request replays after caches or last-paid history change
- **THEN** it returns the original stored pricing and exactly one spend event exists for that session/line
