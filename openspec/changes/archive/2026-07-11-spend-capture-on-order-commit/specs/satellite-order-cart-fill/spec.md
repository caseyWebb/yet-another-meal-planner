# satellite-order-cart-fill Specification (delta)

## MODIFIED Requirements

### Requirement: Cart-fill advances carted lines to in_cart; mark-placed optionally advances to ordered

The receipt intake SHALL advance `carted` and `substituted` lines to **`in_cart`** using the same advancement the Kroger `place_order` flush uses (keyed by canonical id — the only auto-transition), and SHALL leave an `unavailable` line `active` to retry on the next order. On its **first landing** the intake SHALL persist the send-record snapshot alongside that advance (see `spend-telemetry`): one `order_sends` row whose id **equals the order-list id** (`store`/`location_id` from the issued order-list, `fulfillment: "satellite"`) and one line per carted/substituted observation carrying the observed product (`productId` as the pick, `size`, the single observed `product.price` as the effective `unit_price`; `regular`/`promo`/`on_sale`/`savings` NULL-unknown, `estimated: 0`), the `department` stamp via the shared `src/department.ts` grocery-line derivation (`household` overrides immediate, memoized categories, NULL while pending — see `spend-telemetry`), and `provenance: "planned"` (the pull-list is list ∪ plan by construction) — and SHALL stamp each advanced row's send linkage. Because the send id is deterministic and the writes are insert-or-ignore, a replayed receipt converges without double-recording. Snapshot persistence SHALL be honest-best-effort: its failure never rejects the receipt or blocks the advance. It SHALL NOT advance any line past `in_cart` automatically. An optional **mark-placed** signal — the local helper re-posting with `mark_placed: true` and no new observations, or the user's separate "I placed the order" assertion via `update_grocery_list` — SHALL advance the issued `in_cart` lines to `ordered` **through the shared purchase-assertion path, materializing each advanced line's snapshot as spend events** (verbatim, idempotent on `(send_id, line_key)`); unused, a line SHALL remain at `in_cart` and its snapshot never materializes. Re-applying a receipt or mark-placed SHALL converge (idempotent), never double-advance and never double-count spend.

#### Scenario: Carted lines advance to in_cart, unavailable stays active

- **WHEN** a receipt reports some lines `carted`/`substituted` and others `unavailable`
- **THEN** the carted and substituted lines advance to `in_cart` (same keying as `place_order`) with the order-list's send record persisted and their linkage stamped, and the unavailable lines remain `active` with no snapshot line

#### Scenario: Mark-placed advances the issued in_cart lines to ordered

- **WHEN** the helper posts `mark_placed: true` for a received order-list (or the user asserts "I placed the order")
- **THEN** the issued `in_cart` lines advance to `ordered` and their snapshot lines materialize as spend events; absent the signal they stay `in_cart` — awaiting mark-placed, never auto-counted — identical to an unconfirmed Kroger cart

#### Scenario: A replayed receipt neither double-advances nor double-records

- **WHEN** the satellite retries a receipt (or mark-placed) the Worker already landed
- **THEN** the advance converges, the deterministic send id makes the snapshot insert-or-ignore, and at most one spend event exists per `(send_id, line_key)`

#### Scenario: A snapshot failure never blocks the receipt

- **WHEN** persisting the send record fails during a receipt landing
- **THEN** the intake still advances the carted lines and responds normally — those lines simply carry no send linkage and will produce no spend events
