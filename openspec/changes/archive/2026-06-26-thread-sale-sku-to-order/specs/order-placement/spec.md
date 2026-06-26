## ADDED Requirements

### Requirement: Forced-SKU overrides are revalidated before the cart

`place_order` SHALL accept `overrides` (`[{ name, sku, brand?, size? }]`) as the seam to force a specific Kroger SKU for a to-buy line — to disposition a previously `ambiguous`/`unavailable` item **or** to lock a SKU the agent verified (e.g. an on-sale one from `kroger_prices`). An overridden line SHALL bypass the `match_ingredient_to_kroger_sku` matcher. Before adding a forced SKU to the cart, `place_order` SHALL revalidate it with one targeted lookup for current curbside/delivery availability and fresh price — the same revalidation the matcher's cache path performs. A fulfillable forced SKU SHALL be resolved with its **fresh** `price` and `on_sale` (not caller-supplied or stale values). A forced SKU that is not fulfillable SHALL be returned in the single `checkpoint` batch as `kind: "unavailable"` and SHALL NOT be added to the cart. A resolved forced SKU SHALL still upsert its learned `(ingredient, location)` mapping to the shared SKU cache, exactly as a matcher-resolved line does.

#### Scenario: Verified on-sale SKU is revalidated, then carted

- **WHEN** `place_order` is called with `overrides: [{ name: "trout", sku: "X" }]` and SKU `X` is currently fulfillable
- **THEN** the line resolves to SKU `X` with its fresh `price`/`on_sale`, is added to the cart via `PUT /v1/cart/add` as that exact SKU, and its mapping is upserted to the SKU cache

#### Scenario: Override SKU that went unavailable is checkpointed, not blind-carted

- **WHEN** `place_order` is called with an override whose SKU is no longer fulfillable at the resolved location
- **THEN** that line is returned in the `checkpoint` batch as `kind: "unavailable"` and is not added to the cart

#### Scenario: Lapsed promo is surfaced, not auto-dropped

- **WHEN** an overridden SKU is still fulfillable but its promo has lapsed since verification
- **THEN** the resolved line carries the fresh `on_sale: false` (so the agent can surface the lapse at `preview`) and the line is still carted rather than silently dropped

### Requirement: Overrides pin the SKU, not the price

`place_order` SHALL pin only the **SKU** of an overridden line into the cart; it SHALL NOT claim to lock or guarantee a price. The Kroger cart write (`PUT /v1/cart/add`) carries only `{ upc, quantity }` and no price, so whether a sale price realizes SHALL be Kroger's determination at fulfillment, against flyer data that may be hours-stale. The `place_order` contract (tool description and `docs/TOOLS.md`) SHALL state this SKU-not-price guarantee explicitly so the agent does not over-promise a locked price.

#### Scenario: Cart write carries no price

- **WHEN** an overridden line is added to the cart
- **THEN** only the SKU (`upc`) and quantity are sent, and `place_order` reports the SKU as carted without asserting the sale price is locked
