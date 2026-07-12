## MODIFIED Requirements

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

## ADDED Requirements

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
