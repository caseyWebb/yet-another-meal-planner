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

### Requirement: Write the Kroger cart and persist learned mappings

For the freshly revalidated resolved set, `place_order` SHALL first advance/materialize the lines with their D16 send record, then add them to the Kroger cart via `PUT /v1/cart/add`, and only when `cart.written:true` SHALL it compare/upsert learned ingredient→SKU mappings in D1 `sku_cache`. Each mapping SHALL carry the resolved candidate's aisle placement when Kroger provides one. The post-cart cache commit SHALL cover every sent line, including cache hits whose revalidation carries fresh placement, and SHALL report exact `inserted`, `updated`, and `unchanged` line keys; an identical learned row SHALL not be rewritten. When cart write fails, the operation SHALL run its existing list/send compensation and SHALL NOT invoke the cache writer. Cart success and cache success remain independent best-effort outcomes: a cache failure SHALL not roll back groceries, and the result SHALL report it honestly.

#### Scenario: Successful send teaches exact changed mappings
- **WHEN** the cart write succeeds and one mapping is new, one changes placement, and one is identical
- **THEN** the cache result reports those keys under inserted, updated, and unchanged respectively, and only the first two rows are written

#### Scenario: Failed cart never teaches
- **WHEN** list advance succeeds but the Kroger cart write fails and compensation runs
- **THEN** no SKU-cache commit is attempted and the outcome reports zero learned mappings

#### Scenario: Cache failure never costs the sent groceries
- **WHEN** the cart write succeeds but the subsequent cache commit fails
- **THEN** sent rows and their send record remain in cart, the result reports the cache error and no claimed learned mappings, and the cart is not rolled back

#### Scenario: A cache-hit line refreshes its placement after send
- **WHEN** a sent line resolved from a cache row whose aisle differs from the revalidated product
- **THEN** the post-cart cache commit updates its placement and reports that line as updated

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

### Requirement: The order flush persists a send-record snapshot

A non-preview `place_order` flush with a non-empty freshly revalidated set SHALL persist the send record in the same D1 batch as its in-cart advance: one `order_sends` row plus one immutable `order_send_lines` row per resolved line, carrying fresh price/pick/quantity/department/provenance/recipe fields defined by `spend-telemetry`, and each advanced row SHALL carry the send id. The provenance mapping SHALL be deterministic: `planned` for stored list rows, server-derived plan needs, or recipe-attributed supplements; `impulse` for a bare review-added extra. A resolved review impulse SHALL be materialized directly as an `in_cart` grocery row by this shared advance and SHALL not require a prior UI list write. Skipped, undecided, unavailable, revalidation-failed, and cart-failed review impulses SHALL leave no active grocery row. Preview/search SHALL write no send record or impulse row. Cart-write rollback SHALL remove advance-inserted rows and the send record as today. Snapshot-build failure SHALL remain honest best-effort and SHALL never block groceries.

#### Scenario: Sent impulse snapshots through the shared operation
- **WHEN** a member stages a bare extra during review and its final revalidated SKU reaches the Kroger cart
- **THEN** the shared advance materializes it in cart with the send link and snapshots its line with `provenance:impulse`

#### Scenario: Left-off impulse leaves no list residue
- **WHEN** a staged impulse is skipped, unresolved, unavailable, or fails final revalidation
- **THEN** it creates no grocery row, send line, SKU-cache mapping, or spend event

#### Scenario: Preview writes no impulse or send state
- **WHEN** the same staged impulse is previewed or searched repeatedly
- **THEN** no grocery/send/cache state changes

#### Scenario: Provenance remains planned for existing intent
- **WHEN** a stored ad-hoc row, plan need, or recipe-attributed supplement is sent beside a review-added bare extra
- **THEN** the first three snapshot as planned and only the bare extra snapshots as impulse

### Requirement: A send-wide purchase assertion is exact and atomic

The shared `mark_grocery_send_placed` operation SHALL accept a tenant-owned `send_id`, the caller's sorted `expected_line_keys`, and rendered `snapshot_version`. Before writing, it SHALL verify that the expected set exactly equals all current rows with `status:"in_cart"` and `sent_in=send_id`; any missing, added, moved, or differently linked line SHALL return `conflict` with the fresh grocery snapshot and SHALL advance/materialize nothing. On success one atomic operation SHALL advance exactly those rows to `ordered`, stamp `ordered_at`, materialize every linked D16 send line through the one shared writer, and stamp the send `placed_at`.

#### Scenario: Whole send succeeds atomically
- **WHEN** expected keys exactly match five current in-cart rows for the send
- **THEN** all five become ordered, all five linked snapshot lines materialize idempotently, and the send records its placed time

#### Scenario: Membership mismatch writes nothing
- **WHEN** one line was relisted after the caller rendered the five-line send
- **THEN** the assertion returns conflict with the four-line current snapshot and none of the remaining rows advances

#### Scenario: Cross-send key is rejected
- **WHEN** an expected line belongs to another send or tenant
- **THEN** the operation returns a structured error and writes no status or spend change

### Requirement: Send-wide assertion replay is idempotent

Once a send is stamped placed, replay of the same send assertion SHALL return the completed outcome and current snapshot without re-advancing a relisted row or duplicating spend. A never-placed send with zero current in-cart members SHALL not be assertable. Existing per-row `update_grocery_list(in_cart → ordered)` remains a compatible surface, but member whole-send UI and agent choreography with a send id SHALL use the batch operation.

#### Scenario: Completed assertion replay does not resurrect a row
- **WHEN** a completed send assertion is replayed after later state changes
- **THEN** it reports the prior completion without changing current rows or spend events

### Requirement: Back to list is linkage-guarded and writes no spend

The shared `relist_grocery_send_line` operation SHALL accept nullable `send_id`, canonical `line_key`, and `expected_row_version`, and SHALL conditionally perform only `in_cart → active`. A non-null send SHALL match the row's current linkage and the line's current `order_send_lines` membership in an unplaced tenant-owned send. A null send SHALL match only a row that the Grocery snapshot projects into its synthetic unlinked group because no current unplaced send has matching `order_send_lines` membership for that row, including a null or dangling linkage, an already-placed send, or an open send missing that line. It SHALL clear `sent_in`, retain the row's quantity, write no spend, and leave any historical send snapshot immutable. A stale row version or mismatched current open-send line membership SHALL return conflict without a write. Ordered-row relist/void behavior remains governed by the existing lifecycle and is not exposed as Back to list in an in-cart group.

#### Scenario: One line returns to active
- **WHEN** Back to list succeeds for one unplaced send line
- **THEN** only that row becomes active with no send linkage, the persisted send quote remains historical, and no spend event exists for it

#### Scenario: Stale relist cannot move a newer row
- **WHEN** the row changed after the caller rendered it
- **THEN** relist returns conflict and leaves the newer state intact

#### Scenario: A cart row outside every open-send line membership returns to the list
- **WHEN** Back to list supplies a null send id for an `in_cart` row whose linkage is absent, dangling, already placed, or points to an open send that has no matching `order_send_lines` member
- **THEN** only that row becomes active, its quantity is retained, and no spend event is written

#### Scenario: Null cannot escape a current open-send line membership
- **WHEN** Back to list supplies a null send id for a row with matching `order_send_lines` membership in its current unplaced tenant send
- **THEN** relist conflicts without moving the row or writing spend

### Requirement: Final send compares a complete preview fingerprint

The order-review send path SHALL accept the complete plain-JSON stage, the rendered `preview_fingerprint`, and cleared-cart acknowledgement. Immediately before any D1 or cart write, it SHALL rerun current to-buy derivation, location resolution, brand reads, matching/search and every selected-SKU availability/price check, and recompute the fingerprint over all commit-relevant state. A mismatch SHALL return `review_changed` with a refreshed preview and categorized divergences and SHALL write nothing. When prior in-cart rows require the cleared-cart gate, false acknowledgement SHALL return `cart_clearance_required` and write nothing.

#### Scenario: Price or availability drift blocks the send
- **WHEN** a selected SKU price changes or becomes unavailable after the rendered preview
- **THEN** final send returns the refreshed review with price/availability divergence and performs no advance, cart, cache, send-record, or brand write

#### Scenario: Grocery membership drift blocks the send
- **WHEN** another member changes the to-buy set after preview
- **THEN** the fingerprint differs, the response names list divergence, and the member must confirm the refreshed set

#### Scenario: Matching fingerprint proceeds with fresh facts
- **WHEN** all recomputed commit-relevant facts match the fingerprint and the clearance gate is satisfied
- **THEN** the operation commits the freshly revalidated resolved set through the shared advance/cart/cache sequence

### Requirement: Final send returns an honest discriminated result

The review send result SHALL distinguish `review_changed`, structured pre-write failure, `send_failed`, and `sent`. It SHALL report list advance/rollback, cart write/count, send-record id or snapshot error, exact cache mapping changes or error, verified saved-brand markers, and every left-off line with `skipped | undecided | unavailable | revalidation_failed | underived` reason. A `sent` result's item count, estimated total and flyer savings SHALL be read from its persisted D16 send lines by send id; when no send snapshot was recorded, those values SHALL be unavailable with the error rather than copied from preview. Only a cart-written result SHALL enter the confirmed state.

#### Scenario: Partial failure is described step by step
- **WHEN** the cart succeeds, the send snapshot exists, and cache commit fails
- **THEN** the result confirms cart/list/send totals, reports cache failure and zero learned mappings, and lists every left-off line independently

#### Scenario: Snapshot failure does not fabricate totals
- **WHEN** cart/list succeed but D16 snapshot recording degraded
- **THEN** the result confirms the cart count while estimated total/flyer savings are unavailable and no preview totals are substituted

#### Scenario: Saved brands are verified, not trusted from the client
- **WHEN** the stage names a family/brand as saved
- **THEN** the result includes it only if a fresh preference read finds that brand in tier 1 with `any_brand:false`

### Requirement: Instacart Marketplace handoff is not an order lifecycle transition

Creating or opening an Instacart Marketplace shopping-list URL SHALL NOT be treated as an order/cart flush. The shared Instacart handoff operation SHALL NOT mutate grocery rows, advance `active → in_cart`, stamp `sent_in`, write `order_sends` or `order_send_lines`, invoke a purchase assertion, write or materialize spend events, or restock pantry. Its result and every calling surface SHALL state only that a shopping-list page is ready for member review; it SHALL NOT assert that any product was matched, added to a cart, checked out, ordered, or purchased. Kroger `place_order`, satellite cart-fill, manual/walk commit, and user-asserted lifecycle behavior SHALL remain unchanged.

#### Scenario: Successful handoff leaves active rows active

- **WHEN** Instacart returns a valid `products_link_url` for a tenant's active to-buy lines
- **THEN** the operation returns the URL while every stored grocery row, `sent_in`, and `ordered_at` remains unchanged

#### Scenario: No send or spend record exists for handoff

- **WHEN** a handoff URL is created, reused, or opened
- **THEN** no order send, send line, spend event, or purchase assertion is written for those actions

#### Scenario: Derived virtual lines remain virtual

- **WHEN** an Instacart request includes a plan-derived to-buy line with no grocery row
- **THEN** the handoff does not materialize a row or otherwise change the next derived to-buy view

#### Scenario: Existing fulfillment transitions are unchanged

- **WHEN** a tenant uses Kroger, satellite cart-fill, a store walk, or a user-asserted mark-placed action after this change
- **THEN** its existing lifecycle/send/spend contract applies exactly as before and never infers state from an Instacart URL
