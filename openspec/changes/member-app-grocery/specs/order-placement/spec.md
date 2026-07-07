## MODIFIED Requirements

### Requirement: Resolve the grocery list at order time

`place_order` SHALL resolve the **whole** to-buy set at order time — not at capture time — so the cart reflects current availability. The to-buy set SHALL be `grocery_list(active) ∪ (menu needs) − (pantry has)`, joined on canonical ingredient ids, where menu needs are the **union** of the meal plan's server-derived ingredient needs (the same derivation the to-buy read uses — see `grocery-list`) and any caller-supplied `menu_needs` (supplements: open-world side ingredients, spontaneous extras — no longer the bulk plan expansion). Planned recipes whose full ingredient list is not yet derived SHALL be reported by slug in the result (`underived`) so the caller can compensate rather than silently under-buy. A caller-supplied `exclude` list SHALL drop the named lines (resolved through the same canonical-id funnel) from the to-buy set before resolution — an order-scoped opt-out, never persisted. Each remaining item SHALL be resolved via the `match_ingredient_to_kroger_sku` matcher with cache revalidation against current price and curbside/delivery availability. Items the matcher returns as `ambiguous` or `unavailable` SHALL be collected and surfaced as a **single batch checkpoint** for the user to disposition; the cart write SHALL NOT proceed for those items until resolved. The order operation SHALL be shared: the MCP tool and the member app's order endpoint call one extracted operation over the same injected dependencies, with the tool's observable behavior otherwise unchanged.

#### Scenario: Whole list resolved against current availability

- **WHEN** `place_order` runs with items on the grocery list
- **THEN** each is resolved via the matcher with cache revalidation, and a cache hit that is no longer fulfillable is re-resolved rather than used

#### Scenario: Plan needs are derived, not caller-expanded

- **WHEN** `place_order` runs with no `menu_needs` while the meal plan contains recipes with derived ingredient lists
- **THEN** the to-buy set includes the plan's derived needs (minus pantry coverage) with their `for_recipes` attribution, without the caller having enumerated them

#### Scenario: A derived need and a materialized row resolve once

- **WHEN** an ingredient exists both as a derived plan need and as an explicit `source: "menu"` row
- **THEN** it appears once in the to-buy set (canonical-id merge) and is resolved once

#### Scenario: An excluded line is not resolved or carted

- **WHEN** `place_order` is called with `exclude: ["salmon"]` while salmon is in the to-buy set
- **THEN** the salmon line is dropped before resolution — it is not resolved, not checkpointed, and not carted — and the exclusion persists nowhere beyond this call

#### Scenario: Ambiguous/unavailable items batched for decision

- **WHEN** one or more items resolve to `ambiguous` or `unavailable`
- **THEN** `place_order` returns them together as a checkpoint for the user to decide, and does not add those items to the cart unilaterally

### Requirement: Order lifecycle with user-asserted transitions

The order lifecycle SHALL be `active → in_cart → ordered → received`, where `received` is the terminal receive **action** — the row is removed from the list and, for `grocery`-kind items only, the pantry is restocked — not a stored status value (the stored enum is `active | in_cart | ordered`; see `grocery-list`). `place_order` (the Kroger online flush) SHALL advance resolved items to `in_cart`. The **satellite cart-fill flush** (see the `satellite-order-cart-fill` capability) is a parallel flush for a store the Worker has no API for: the tenant's satellite fills that store's cart and posts a receipt, and the Worker SHALL advance the receipt's `carted` and `substituted` lines to `in_cart` **exactly as `place_order` does** — the same canonical-id keying and the same single auto-transition — while an `unavailable` line stays `active` to retry on the next order. Because the satellite stops at the store's review page and never checks out, the carted state SHALL be `in_cart`, never `ordered`, on the satellite's report alone.

Transitions past `in_cart` SHALL be **user-asserted**, never agent- or satellite-verified: an "I placed the order" assertion advances `in_cart → ordered`; an "I picked up the groceries" assertion triggers the terminal receive action. The agent SHALL NOT claim an order was placed or received without the user's assertion. The `in_cart → ordered` assertion SHALL be **fulfillment-mode-agnostic and surface-agnostic** — the user telling the agent (via `update_grocery_list`), the member app's mark-order-placed affordance (the member route accepting `status: "ordered"`), or, for a satellite cart-fill, an optional local-helper mark-placed post after the human checks out — every surface enforced by the same shared transition guard (legal only from `in_cart`, stamping `ordered_at`). Because the Kroger cart API is write-only and unreadable, and because the satellite is never the sole witness to a purchase, neither flush SHALL advance past `in_cart` on its own.

The terminal receive behavior — remove the item from the list and, for `grocery`-kind items only, restock the pantry (and offer storage tips for fresh perishables) — SHALL be **fulfillment-mode-agnostic**: it is the shared completion of the Kroger online flush, the satellite cart-fill flush, and the in-store walk (see the `in-store-fulfillment` capability). The in-store walk advances picked `grocery`-kind items directly from `active` to received, with no `in_cart` / `ordered` stage, reusing this same restock behavior; a picked line that was a **derived** (virtual) to-buy line has no row to remove — its pantry restock is what removes it from the next derivation. `household` / `other` items never touch the pantry on any path.

#### Scenario: place_order marks items in_cart

- **WHEN** `place_order` adds resolved items to the cart
- **THEN** those grocery-list items advance to `status: in_cart`

#### Scenario: Satellite cart-fill marks carted lines in_cart

- **WHEN** a satellite cart-fill receipt reports lines as `carted` or `substituted`, and others as `unavailable`
- **THEN** the carted and substituted lines advance to `in_cart` (the same keying and auto-transition `place_order` performs) and the unavailable lines remain `active`

#### Scenario: Checkout stays with the human on the satellite flush

- **WHEN** a satellite fills a store's cart
- **THEN** nothing advances past `in_cart` automatically; `ordered` requires the user's (or the local helper's) explicit "I placed the order" assertion after they check out in the store's own UI

#### Scenario: The app's order-placed assertion uses the same guard

- **WHEN** a member marks an order placed in the app
- **THEN** each item advances `in_cart → ordered` with `ordered_at` stamped through the same shared guarded operation the agent's `update_grocery_list` advance uses, and a non-`in_cart` row is rejected with the structured transition error

#### Scenario: Pickup restocks the pantry and clears the list

- **WHEN** the user asserts "I picked up the groceries"
- **THEN** the ordered items are removed from the grocery list and `grocery`-kind items restock their pantry entries; `household`/`other` items do not touch the pantry — and no row is ever stored with a `received` status

#### Scenario: In-store walk completes via the same received behavior

- **WHEN** an in-store walk finishes and its picked `grocery`-kind items complete directly from `active`
- **THEN** explicit rows are removed and restock their pantry entries, and a picked derived line restocks the pantry (which removes it from the next derivation) — the same terminal behavior as a Kroger pickup, without passing through `in_cart` or `ordered`

#### Scenario: Stale-cart reminder on a new order

- **WHEN** a new order begins while the prior list still has `in_cart` items never confirmed `ordered`
- **THEN** the agent (and the app's order dialog, from the to-buy view's `in_cart` section) reminds the user to clear the store cart manually before proceeding, rather than silently double-adding
