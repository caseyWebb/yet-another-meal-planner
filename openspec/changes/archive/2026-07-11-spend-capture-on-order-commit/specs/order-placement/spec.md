# order-placement Specification (delta)

## ADDED Requirements

### Requirement: The order flush persists a send-record snapshot

A non-preview `place_order` flush with a non-empty resolved set SHALL persist the send record (see `spend-telemetry`) **in the same D1 batch as the in-cart advance**: one `order_sends` row (`store: "kroger"`, the resolved `location_id`, `fulfillment: "kroger_online"`) and one `order_send_lines` row per resolved line, carrying each line's fresh resolution prices (`regular`/`promo`/`on_sale`, effective `unit_price`, `savings` derived from the same `deriveSavings` single source), the pick (`sku`/`brand`/`size`), package `quantity`, the `department` stamp (via the shared `src/department.ts` grocery-line derivation: deterministic `household` overrides immediately, memoized categories, NULL while pending — see `spend-telemetry`), `provenance`, and `for_recipes` — and each advanced grocery row SHALL be stamped with the send's id (`sent_in`). The provenance mapping SHALL be deterministic: `planned` when the line's key came from a stored `grocery_list` row or the server-derived plan needs, or its merged `for_recipes` is non-empty; `impulse` for a caller-supplied `menu_needs` extra with no recipe attribution. Preview resolves and reports without writing a send record, exactly as it writes nothing else. On a cart-write failure the rollback SHALL delete the send record and lines alongside its existing row compensation (a failed cart write means nothing was sent; no phantom order survives). Building the snapshot SHALL be honest-best-effort: a snapshot-build failure degrades to advancing without a send — reported in the result's `send` field (`{ recorded, id?, error? }`), never failing the flush or the cart write. `place_order`'s tool description and result SHALL state the send-record side effect.

#### Scenario: The flush snapshots atomically with the advance

- **WHEN** `place_order` flushes resolved lines and the advance batch succeeds
- **THEN** the send record and its per-line snapshot exist, each advanced row carries `sent_in` = the send id, and the result reports `send: { recorded: true, id }`

#### Scenario: Preview writes no send record

- **WHEN** `place_order` runs with `preview: true`
- **THEN** no send record, send lines, or `sent_in` stamps are written — identical to preview's existing write-nothing guarantee

#### Scenario: A rolled-back cart write leaves no phantom send

- **WHEN** the cart write fails and the advance is rolled back
- **THEN** the send record and its lines are deleted in the same compensation, and the affected rows carry no `sent_in`

#### Scenario: Provenance is mapped deterministically

- **WHEN** a flush resolves a stored `ad_hoc` list row, a plan-derived need, a `menu_needs` side carrying `for_recipes`, and a bare `menu_needs` extra
- **THEN** the first three snapshot as `planned` and the bare extra as `impulse`

#### Scenario: Telemetry failure never costs the groceries

- **WHEN** building the snapshot fails (e.g. the department memo read errors)
- **THEN** the flush proceeds — rows advance without a send linkage, the cart is written, and the result reports `send: { recorded: false, error }`

## MODIFIED Requirements

### Requirement: Order lifecycle with user-asserted transitions

The order lifecycle SHALL be `active → in_cart → ordered → received`, where `received` is the terminal receive **action** — the row is removed from the list and, for `grocery`-kind items only, the pantry is restocked — not a stored status value (the stored enum is `active | in_cart | ordered`; see `grocery-list`). `place_order` (the Kroger online flush) SHALL advance resolved items to `in_cart`. The **satellite cart-fill flush** (see the `satellite-order-cart-fill` capability) is a parallel flush for a store the Worker has no API for: the tenant's satellite fills that store's cart and posts a receipt, and the Worker SHALL advance the receipt's `carted` and `substituted` lines to `in_cart` **exactly as `place_order` does** — the same canonical-id keying and the same single auto-transition — while an `unavailable` line stays `active` to retry on the next order. Because the satellite stops at the store's review page and never checks out, the carted state SHALL be `in_cart`, never `ordered`, on the satellite's report alone. Both flushes SHALL stamp the rows they advance with their send record's id (`sent_in` — the row's in-flight send linkage; see `spend-telemetry`); a manual `active → in_cart` write stamps nothing.

Transitions past `in_cart` SHALL be **user-asserted**, never agent- or satellite-verified: an "I placed the order" assertion advances `in_cart → ordered`; an "I picked up the groceries" assertion triggers the terminal receive action. The agent SHALL NOT claim an order was placed or received without the user's assertion. The `in_cart → ordered` assertion SHALL be **fulfillment-mode-agnostic and surface-agnostic** — the user telling the agent (via `update_grocery_list`), the member app's mark-order-placed affordance (the member route accepting `status: "ordered"`), or, for a satellite cart-fill, an optional local-helper mark-placed post after the human checks out — every surface enforced by the same shared transition guard (legal only from `in_cart`, stamping `ordered_at`). The `in_cart → ordered` advance is the **purchase assertion**: inside the shared operations (never per-surface), it SHALL invoke the one shared spend writer, materializing the advancing rows' send-snapshot lines as spend events (verbatim copy, idempotent on `(send_id, line_key)`); a row with no send linkage advances without writing spend. A row leaving `in_cart` for `active` SHALL clear its send linkage and write no spend; a row leaving `ordered` (re-listed in either direction) SHALL void its materialized events and clear the linkage — the same shared-op branch that already clears `ordered_at`. `remove_from_grocery_list` SHALL never write spend. Because the Kroger cart API is write-only and unreadable, and because the satellite is never the sole witness to a purchase, neither flush SHALL advance past `in_cart` on its own.

The terminal receive behavior — remove the item from the list and, for `grocery`-kind items only, restock the pantry (and offer storage tips for fresh perishables) — SHALL be **fulfillment-mode-agnostic**: it is the shared completion of the Kroger online flush, the satellite cart-fill flush, and the in-store walk (see the `in-store-fulfillment` capability). Receive itself SHALL price nothing and write no spend, and the shared removal operation SHALL never write spend — guarantees homed in the operations, independent of any skill. Any operation that completes a receive for rows still `in_cart` (the collapsed ordered+received assertion) SHALL internally perform the purchase assertion first — advance `in_cart → ordered` through the shared guarded transition (materializing spend via the one writer), then complete the removes/restocks; while receive is realized as removals (no receive-completing operation exists), the persona's receive flows carry the advance-first step as advisory choreography. The in-store walk advances picked `grocery`-kind items directly from `active` to received, with no `in_cart` / `ordered` stage, reusing this same restock behavior; a picked line that was a **derived** (virtual) to-buy line has no row to remove — its pantry restock is what removes it from the next derivation. `household` / `other` items never touch the pantry on any path.

#### Scenario: place_order marks items in_cart

- **WHEN** `place_order` adds resolved items to the cart
- **THEN** those grocery-list items advance to `status: in_cart`, each stamped with the flush's send id

#### Scenario: Satellite cart-fill marks carted lines in_cart

- **WHEN** a satellite cart-fill receipt reports lines as `carted` or `substituted`, and others as `unavailable`
- **THEN** the carted and substituted lines advance to `in_cart` (the same keying and auto-transition `place_order` performs) with the order-list's send id stamped, and the unavailable lines remain `active`

#### Scenario: Checkout stays with the human on the satellite flush

- **WHEN** a satellite fills a store's cart
- **THEN** nothing advances past `in_cart` automatically; `ordered` requires the user's (or the local helper's) explicit "I placed the order" assertion after they check out in the store's own UI

#### Scenario: The app's order-placed assertion uses the same guard

- **WHEN** a member marks an order placed in the app
- **THEN** each item advances `in_cart → ordered` with `ordered_at` stamped through the same shared guarded operation the agent's `update_grocery_list` advance uses — materializing the same spend events — and a non-`in_cart` row is rejected with the structured transition error

#### Scenario: The advance materializes spend from the snapshot

- **WHEN** an `in_cart` row carrying a send linkage is advanced to `ordered` on any surface
- **THEN** the shared writer copies its send-snapshot line into a spend event verbatim, exactly once per `(send_id, line_key)`

#### Scenario: Pickup restocks the pantry and clears the list

- **WHEN** the user asserts "I picked up the groceries"
- **THEN** rows still `in_cart` are first advanced to `ordered` (the purchase assertion), then the ordered items are removed from the grocery list and `grocery`-kind items restock their pantry entries; `household`/`other` items do not touch the pantry — and no row is ever stored with a `received` status, and the receive itself writes no spend

#### Scenario: In-store walk completes via the same received behavior

- **WHEN** an in-store walk finishes and its picked `grocery`-kind items complete directly from `active`
- **THEN** explicit rows are removed and restock their pantry entries, and a picked derived line restocks the pantry (which removes it from the next derivation) — the same terminal behavior as a Kroger pickup, without passing through `in_cart` or `ordered` (walk spend capture is the band-3 shop-commit extension, not this path)

#### Scenario: Stale-cart reminder on a new order

- **WHEN** a new order begins while the prior list still has `in_cart` items never confirmed `ordered`
- **THEN** the agent (and the app's order dialog, from the to-buy view's `in_cart` section) reminds the user to clear the store cart manually before proceeding, rather than silently double-adding — and those items remain "awaiting mark-placed", never auto-counted as spend
