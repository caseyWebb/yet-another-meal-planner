## MODIFIED Requirements

### Requirement: Order lifecycle with user-asserted transitions

The order lifecycle SHALL be `active → in_cart → ordered → received`. `place_order` (the Kroger online flush) SHALL advance resolved items to `in_cart`. The **satellite cart-fill flush** (see the `satellite-order-cart-fill` capability) is a parallel flush for a store the Worker has no API for: the tenant's satellite fills that store's cart and posts a receipt, and the Worker SHALL advance the receipt's `carted` and `substituted` lines to `in_cart` **exactly as `place_order` does** — the same canonical-id keying and the same single auto-transition — while an `unavailable` line stays `active` to retry on the next order. Because the satellite stops at the store's review page and never checks out, the carted state SHALL be `in_cart`, never `ordered`, on the satellite's report alone.

Transitions past `in_cart` SHALL be **user-asserted**, never agent- or satellite-verified: an "I placed the order" assertion advances `in_cart → ordered`; an "I picked up the groceries" assertion advances `ordered → received`. The agent SHALL NOT claim an order was placed or received without the user's assertion. The `in_cart → ordered` assertion SHALL be **fulfillment-mode-agnostic** — the user telling the agent (via `update_grocery_list`), or, for a satellite cart-fill, an optional local-helper mark-placed post after the human checks out. Because the Kroger cart API is write-only and unreadable, and because the satellite is never the sole witness to a purchase, neither flush SHALL advance past `in_cart` on its own.

The terminal `received` behavior — remove the item from the list and, for `grocery`-kind items only, restock the corresponding `pantry.toml` quantity (and offer storage tips for fresh perishables) — SHALL be **fulfillment-mode-agnostic**: it is the shared completion of the Kroger online flush, the satellite cart-fill flush, and the in-store walk (see the `in-store-fulfillment` capability). The in-store walk advances picked `grocery`-kind items directly `active → received`, with no `in_cart` / `ordered` stage, reusing this same restock behavior. `household` / `other` items never touch the pantry on any path.

#### Scenario: place_order marks items in_cart

- **WHEN** `place_order` adds resolved items to the cart
- **THEN** those grocery-list items advance to `status: in_cart`

#### Scenario: Satellite cart-fill marks carted lines in_cart

- **WHEN** a satellite cart-fill receipt reports lines as `carted` or `substituted`, and others as `unavailable`
- **THEN** the carted and substituted lines advance to `in_cart` (the same keying and auto-transition `place_order` performs) and the unavailable lines remain `active`

#### Scenario: Checkout stays with the human on the satellite flush

- **WHEN** a satellite fills a store's cart
- **THEN** nothing advances past `in_cart` automatically; `ordered` requires the user's (or the local helper's) explicit "I placed the order" assertion after they check out in the store's own UI

#### Scenario: Pickup restocks the pantry and clears the list

- **WHEN** the user asserts "I picked up the groceries"
- **THEN** the ordered items are removed from the grocery list and `grocery`-kind items restock their pantry entries; `household`/`other` items do not touch the pantry

#### Scenario: In-store walk completes via the same received behavior

- **WHEN** an in-store walk finishes and its picked `grocery`-kind items advance directly `active → received`
- **THEN** those items are removed from the list and restock their pantry entries — the same terminal behavior as a Kroger pickup, without passing through `in_cart` or `ordered`

#### Scenario: Stale-cart reminder on a new order

- **WHEN** a new order begins while the prior list still has `in_cart` items never confirmed `ordered`
- **THEN** the agent reminds the user to clear the store cart manually before proceeding, rather than silently double-adding
