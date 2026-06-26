# order-placement Specification

## Purpose
TBD - created by archiving change order-placement. Update Purpose after archive.
## Requirements
### Requirement: Ready-to-eat adds before order resolution (configured catalog)

Before resolving and flushing the grocery list, if the user has a configured ready-to-eat catalog, the agent SHALL surface heat-and-eat items for buy-time addition — never adding unilaterally. Two passes:

1. **Restock favorites.** Cross-reference `retrospective`'s `ready_to_eat_favorites` against pantry on-hand; for a favored item that is low or out, suggest a restock ("you're out of the frozen lasagna you keep reaching for — add it?"). On agreement, add to the grocery list.
2. **On-sale discovery.** Scan `kroger_flyer` for on-sale heat-and-eat / grab-and-go items not already in the member's catalog; draft 1–2 worthwhile candidates via `add_draft_ready_to_eat` (`source: "kroger-flyer"`). On agreement, add to the grocery list.

Both passes SHALL be skipped for an empty catalog. Items added here are picked up by the subsequent resolve/preview step.

#### Scenario: Favored but out-of-stock RTE item is suggested for restock

- **WHEN** `retrospective` shows a ready-to-eat favorite and that item is low or absent from the pantry
- **THEN** the agent suggests restocking it before the order resolves, and adds it to the grocery list only on the user's agreement

#### Scenario: On-sale RTE item not in catalog is drafted

- **WHEN** `kroger_flyer` surfaces an on-sale heat-and-eat item absent from the member's catalog
- **THEN** the agent drafts it via `add_draft_ready_to_eat` and, on agreement, adds it to the grocery list for this order

#### Scenario: Nothing added without agreement

- **WHEN** the agent surfaces a restock or on-sale RTE suggestion at order time
- **THEN** nothing is written to the grocery list until the user says yes

### Requirement: Resolve the grocery list at order time

`place_order` SHALL resolve the **whole** to-buy set at order time — not at capture time — so the cart reflects current availability. The to-buy set SHALL be `grocery_list ∪ (menu needs) − (pantry has)`. Each item SHALL be resolved via the `match_ingredient_to_kroger_sku` matcher with cache revalidation against current price and curbside/delivery availability. Items the matcher returns as `ambiguous` or `unavailable` SHALL be collected and surfaced as a **single batch checkpoint** for the user to disposition; the cart write SHALL NOT proceed for those items until resolved.

#### Scenario: Whole list resolved against current availability

- **WHEN** `place_order` runs with items on the grocery list
- **THEN** each is resolved via the matcher with cache revalidation, and a cache hit that is no longer fulfillable is re-resolved rather than used

#### Scenario: Ambiguous/unavailable items batched for decision

- **WHEN** one or more items resolve to `ambiguous` or `unavailable`
- **THEN** `place_order` returns them together as a checkpoint for the user to decide, and does not add those items to the cart unilaterally

### Requirement: Write the Kroger cart and persist learned mappings

For the resolved set, `place_order` SHALL add items to the Kroger cart via `PUT /v1/cart/add` and SHALL upsert newly learned ingredient→SKU mappings to the D1 `sku_cache` table. The cart write and the SKU-cache upsert SHALL be **independent best-effort** operations — neither is transactional with the other, and a failure of one SHALL NOT corrupt the other. `place_order` SHALL return honest partial status and SHALL NOT report a populated cart when the cart write failed.

#### Scenario: Resolved items added and mappings cached

- **WHEN** the resolved set is non-empty and the cart write succeeds
- **THEN** the items are added via `PUT /v1/cart/add` and the new SKU mappings are upserted to the D1 `sku_cache` table

#### Scenario: Honest partial failure

- **WHEN** the SKU-cache commit succeeds but the cart write fails (or vice versa)
- **THEN** `place_order` reports the true status of each operation and never claims the cart is populated when it is not

### Requirement: Order lifecycle with user-asserted transitions

The Kroger order lifecycle SHALL be `active → in_cart → ordered → received`. `place_order` SHALL advance resolved items to `in_cart`. Because the Kroger cart API is write-only and unreadable, transitions past `in_cart` SHALL be **user-asserted**, never agent-verified: an "I placed the order" assertion advances `in_cart → ordered`; an "I picked up the groceries" assertion advances `ordered → received`. The agent SHALL NOT claim an order was placed or received without the user's assertion.

The terminal `received` behavior — remove the item from the list and, for `grocery`-kind items only, restock the corresponding `pantry.toml` quantity (and offer storage tips for fresh perishables) — SHALL be **fulfillment-mode-agnostic**: it is the shared completion of *both* the Kroger online flush and the in-store walk (see the `in-store-fulfillment` capability). The in-store walk advances picked `grocery`-kind items directly `active → received`, with no `in_cart` / `ordered` stage, reusing this same restock behavior. `household` / `other` items never touch the pantry on either path.

#### Scenario: place_order marks items in_cart

- **WHEN** `place_order` adds resolved items to the cart
- **THEN** those grocery-list items advance to `status: in_cart`

#### Scenario: Pickup restocks the pantry and clears the list

- **WHEN** the user asserts "I picked up the groceries"
- **THEN** the ordered items are removed from the grocery list and `grocery`-kind items restock their pantry entries; `household`/`other` items do not touch the pantry

#### Scenario: In-store walk completes via the same received behavior

- **WHEN** an in-store walk finishes and its picked `grocery`-kind items advance directly `active → received`
- **THEN** those items are removed from the list and restock their pantry entries — the same terminal behavior as a Kroger pickup, without passing through `in_cart` or `ordered`

#### Scenario: Stale-cart reminder on a new order

- **WHEN** a new order begins while the prior list still has `in_cart` items never confirmed `ordered`
- **THEN** the agent reminds the user to clear the Kroger cart manually before proceeding, rather than silently double-adding

### Requirement: Quantity and partial-stock prompting

`place_order` SHALL default the buy quantity to one package per item unless a package count is supplied. A package count MAY be supplied per item via `menu_needs[].quantity`, and the per-name `quantities` map SHALL override it when both are present (precedence: `quantities` map → `menu_needs[].quantity` → default 1; a non-positive value is treated as not supplied). A supplied package count SHALL be a positive integer within a sane upper bound; `place_order` SHALL reject a fractional, zero, negative, or oversized count with a structured `validation_failed` error and SHALL NOT write the Kroger cart with it. The `grocery_list` item `quantity` is a human need-annotation (e.g. "2 lbs") and SHALL NOT be interpreted as a package count.

Each to-buy and resolved line SHALL carry `assumed_quantity` — `true` exactly when no package count was supplied from either source and the line fell back to 1. The tool SHALL surface this fact but SHALL NOT itself classify a line as "by-the-each produce" or compute portion math; that judgment SHALL remain with the agent (consistent with the no-portion-math stance). At the `preview` step the agent SHALL reconcile `assumed_quantity` lines that are by-the-each produce against the recipe's required amount and set an explicit quantity before the real flush, rather than silently ordering one.

When the pantry holds a **partial** of an ingredient the plan needs, the agent SHALL tell the user how much the plan needs (aggregated from the recipes' stated amounts) and ask whether to buy more — it SHALL NOT silently net partials against the order.

#### Scenario: Partial triggers a prompt

- **WHEN** an ingredient on the to-buy set is also present in the pantry as a partial
- **THEN** the agent surfaces the plan's required amount and asks whether to add it, rather than auto-deciding

#### Scenario: menu_needs quantity is honored

- **WHEN** `place_order` is called with `menu_needs: [{ name: "anaheim peppers", quantity: 4 }]` and no `quantities` override for that name
- **THEN** the to-buy line for anaheim peppers has quantity 4 (not the default 1) and `assumed_quantity: false`

#### Scenario: quantities map overrides the per-need quantity

- **WHEN** `place_order` is called with `menu_needs: [{ name: "anaheim peppers", quantity: 4 }]` and `quantities: { "anaheim peppers": 6 }`
- **THEN** the to-buy line has quantity 6 (the explicit override wins) and `assumed_quantity: false`

#### Scenario: a defaulted line is flagged as assumed

- **WHEN** an item reaches the to-buy set with no package count from either source
- **THEN** its line has quantity 1 and `assumed_quantity: true`, so the agent can reconcile by-the-each produce against the recipe at preview

#### Scenario: an invalid package count is rejected before the cart

- **WHEN** `place_order` is called with a fractional (`1.5`), zero, negative, or oversized (e.g. `100000`) package count via `quantities` or `menu_needs[].quantity`
- **THEN** the tool returns a structured `validation_failed` error and writes no Kroger cart

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

