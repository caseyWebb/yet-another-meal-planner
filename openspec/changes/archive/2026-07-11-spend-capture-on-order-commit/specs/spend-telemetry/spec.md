# spend-telemetry Specification (delta)

## ADDED Requirements

### Requirement: Spend is captured in two phases — snapshot at send, materialize at the purchase assertion

Spend telemetry SHALL be captured in two phases (D16). SNAPSHOT: an order flush that advances grocery rows to `in_cart` (the `place_order` Kroger flush and the satellite cart-fill receipt's first landing) SHALL persist a **send record** — one `order_sends` row (`store`, `location_id`, `fulfillment` path, `created_at`; the satellite send's id SHALL equal its order-list id so replays converge) plus one `order_send_lines` row per advanced line carrying the resolved pick (`sku`/`brand`/`size`), package `quantity`, the per-package `price_regular`/`price_promo`/`on_sale`/effective `unit_price`, sale `savings`, an `estimated` flag (`0` on send-path quotes), the `department` stamp (NULL only while pending classification — see the department requirement), the `provenance` class, and `for_recipes`. Fields the path cannot know SHALL be stored NULL-unknown (the satellite's single observed price populates `unit_price` only), never fabricated. MATERIALIZE: spend events SHALL be written by ONE shared `src/` writer at the purchase assertion — the guarded `in_cart → ordered` advance on every surface, per the `order-placement` lifecycle — **copying the snapshot line verbatim** (prices, department — a pending NULL copies as NULL, provenance, store, fulfillment; `amount = unit_price × quantity`, NULL when unpriced), idempotent on the `(send_id, line_key)` primary key. Emission SHALL live inside the shared operations, never in a surface, and no path SHALL re-price or re-derive at materialize time. Snapshot prices are send-time quotes by definition — the Kroger cart is write-only and no fulfillment receipt exists — and no reconciliation step SHALL be implied or attempted.

#### Scenario: A Kroger flush snapshots and a later assertion materializes verbatim

- **WHEN** `place_order` flushes a resolved line at `{regular: 4.99, promo: 3.99, on_sale: true}` × 2 packages and the user later asserts "I placed the order"
- **THEN** the send line stores those prices with `savings: 1.00` and the materialized spend event copies them verbatim with `amount: 7.98` — no live re-pricing at assertion time

#### Scenario: Materialization is idempotent on (send, line)

- **WHEN** the purchase assertion for the same row is replayed (a retried satellite `mark_placed`, a re-landed receipt)
- **THEN** exactly one spend event exists for that `(send_id, line_key)` — the replay converges without duplicating

#### Scenario: The satellite snapshot stores only what was observed

- **WHEN** a cart-fill receipt reports a carted line with `product: { productId, description, price: 6.49 }`
- **THEN** its send line stores `unit_price: 6.49` with `price_regular`/`price_promo`/`on_sale`/`savings` NULL-unknown — nothing is fabricated to fill the Kroger-shaped fields

#### Scenario: Spend events are retained, not rolled up

- **WHEN** spend events age beyond any analyzer window
- **THEN** they are retained as line items indefinitely (voided events included) — no prune, no rollup

### Requirement: Negative rules — no purchase assertion, no spend

The capture SHALL enforce D16's negative rules, each homed in a shared operation — never in a skill. A row leaving `in_cart` without a purchase assertion (re-listed to `active`, removed, or rolled back by a failed cart write) SHALL write no spend and SHALL drop its send linkage. The terminal receive action SHALL price nothing itself, and the shared removal operation SHALL never write spend — a bare removal of an `in_cart` row is NOT an assertion (a remove is also "changed my mind"). Any operation that completes a receive for rows still `in_cart` (the collapsed ordered+received assertion — e.g. the shared shop-commit/receive operation when it ships) SHALL internally perform the purchase assertion first: advance through the shared guarded transition, materialize via the one writer, then complete the receive; until such an operation exists, receive is realized as removals (which write no spend) and the persona's advance-first receive choreography is advisory. Re-listing an `ordered` row SHALL void its materialized events (a `voided_at` stamp — never a delete; reads filter voided events out). Rows advanced by a manual `active → in_cart` write carry no send linkage, and a purchase assertion for a row without one SHALL write no spend event (band 3's shop-commit op extends coverage to unsnapshotted purchases). Never-marked orders SHALL surface as "awaiting mark-placed" (the retrospective spend section's count and the to-buy view's existing `in_cart` section) and SHALL never be auto-counted as spend.

#### Scenario: Re-listing an in_cart row writes nothing

- **WHEN** an `in_cart` row that was advanced by a flush is set back to `active`
- **THEN** no spend event is written and the row's send linkage is cleared — its snapshot lines simply never materialize

#### Scenario: Re-listing an ordered row voids its events

- **WHEN** an `ordered` row with materialized spend events is re-listed (to `active` or `in_cart`)
- **THEN** its events for that send are stamped `voided_at` (not deleted), the send linkage clears, and spend reads no longer count them

#### Scenario: A manual in_cart move never manufactures spend

- **WHEN** a member freely moves a row `active → in_cart` by hand and later marks it `ordered`
- **THEN** no send record backs the row, so no spend event is written — prices from an unrelated historical send are never resurrected

#### Scenario: A bare removal writes no spend, with no skill involved

- **WHEN** an `in_cart` row is removed through the shared removal operation (a collapsed receive expressed as removes, or a changed mind) by any caller — skill-guided or not
- **THEN** no spend event is written and the send linkage dies with the row — the guarantee is the operation's, not the choreography's

#### Scenario: An unmarked order is surfaced, not counted

- **WHEN** rows sit at `in_cart` under a send with no `ordered` assertion
- **THEN** spend aggregates exclude them and report their count as awaiting mark-placed

### Requirement: Spend lines stamp the one canonical department dimension at capture, pending until classified

Every send line and spend event SHALL carry a `department` from the ONE canonical analytics dimension (D17) owned by `src/department.ts`: the snake_case food vocab — `produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks | beverages` — plus `household` and `leftovers`, with NO other value. The stamp SHALL never be derived at read time and SHALL never come from store placement (`sku_cache` aisle data and Kroger product categories are presentation-only). Derivation SHALL be deterministic and identity-keyed via a grocery-line helper in that shared module: a non-food line (`kind` of `household`/`other`, or a non-grocery `domain` — the "2x4 lumber" fixture) SHALL stamp `household` immediately (never pending; included in spend, excluded from cost-per-meal); a food line SHALL stamp its canonical ingredient id's memoized category (`ingredient_identity.category`, representative-resolved — the same memo pantry-add autofill and waste stamping read); a food id not yet classified SHALL be stored **NULL = pending classification**, filled exactly once (NULL → value, never a rewrite) by the shared `ingredient-category` scheduled job — so a capture that races the classifier records pending rather than a guess, "Not mapped" never reaches analytics (band 4 reads stamped values and the backlog drains to zero), and a stamped value is never rewritten (vocab/memo evolution never rewrites history). `leftovers` SHALL be stamped only by waste capture over `prepared_from` pantry rows, never by spend lines. The cost-per-meal exclusion set `{household, beverages}` SHALL be defined beside the vocab in `src/department.ts` as the constant band 4's analyzer consumes. Capture paths SHALL only apply overrides and read the memo — no tool or capture path SHALL invoke the model inline (the determinism boundary).

#### Scenario: A household line stamps household immediately

- **WHEN** a "paper towels" (`kind: household`) or "2x4 lumber" (`domain: home-improvement`) line is snapshotted
- **THEN** its department is `household` — never pending, included in spend, excluded from the cost-per-meal constant — with no ingredient-graph involvement

#### Scenario: A memoized food line stamps its category

- **WHEN** a "tomatillos" line is snapshotted after the `ingredient-category` job memoized its identity as `produce`
- **THEN** the send line and its later spend event both carry `produce`

#### Scenario: A cold id records pending and converges to the true category

- **WHEN** a food line is snapshotted before its identity has classified
- **THEN** its department is stored NULL (pending), and once the identity classifies the fill stamps the TRUE category on the NULL rows exactly once — never rewriting an already-stamped value

#### Scenario: Store placement never feeds the dimension

- **WHEN** a line's resolved product carries an aisle placement or Kroger category
- **THEN** the department stamp ignores them — placement data remains presentation-only for list grouping and the walk

#### Scenario: Capture never calls the model

- **WHEN** a send snapshot stamps departments
- **THEN** it resolves overrides and memo lookups only — no AI call occurs on the order path

### Requirement: Pending spend departments are filled by the shared ingredient-category job

The shared `ingredient-category` scheduled job (owned by the pantry-disposition capability: classify unclassified identity survivors → backfill pantry categories → stamp pending waste events) SHALL additionally fill `order_send_lines.department` and `spend_events.department` where NULL, from the identity memo via each row's `line_key` (alias → identity → representative `category`, any memo value including `household`). The fill SHALL be NULL → value only, bounded, and idempotent; no separate job, `scheduled()` wiring, or AI activity SHALL be introduced for spend. No separate enqueue mechanism is needed: every food line key is a canonical ingredient id minted through the IngredientContext funnel, so pending ids appear in the classify phase's existing backlog, and non-food keys never need classification (the `household` override stamps them at capture).

#### Scenario: Pending spend rows drain across ticks

- **WHEN** send lines and spend events hold NULL departments whose identities have classified (or classify this tick)
- **THEN** the job's fill phase stamps them from the memo, the pending count decreases monotonically, and a replayed tick rewrites nothing

#### Scenario: A stamped spend row is never revisited

- **WHEN** the memo for an identity later changes (a reclassify migration)
- **THEN** send lines and spend events already stamped keep their capture-time value — the fill touches NULL rows only

### Requirement: Spend aggregates are agent-readable via retrospective; no spend-write tool exists

The `retrospective` tool SHALL return a read-only, household-scoped `spend` section: the trailing 4 ISO weeks' totals (`total`, `savings`, event and estimated counts) over non-voided events, the caller's `weekly_budget` (or null), and `awaiting_mark_placed` (current `in_cart` rows carrying a send linkage). The aggregation SHALL be plain SQL — no LLM in the read path. No MCP tool SHALL write spend events directly: the agent influences spend only through the shared order/list operations, and the writer is not a surface.

#### Scenario: The spend section reflects materialized events

- **WHEN** spend events exist within the trailing window and the tenant has `weekly_budget: 95`
- **THEN** `retrospective` returns per-week totals excluding voided events, `weekly_budget: 95`, and the current awaiting-mark-placed count

#### Scenario: No write tool

- **WHEN** the MCP tool surface is enumerated
- **THEN** no tool accepts a spend event; spend materializes only inside the shared status-advance operations
