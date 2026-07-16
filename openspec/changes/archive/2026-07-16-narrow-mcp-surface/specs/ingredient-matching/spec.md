# ingredient-matching — delta

## MODIFIED Requirements

### Requirement: Resolve-only matching pipeline

The system SHALL provide the deterministic 7-step matching pipeline from `docs/ARCHITECTURE.md` as an internal operation (`matchIngredient`) consumed by the order flow (`place_order`'s resolution) and the order-review surfaces — it is **not** a model-advertised MCP tool. It SHALL be **resolve-only**: it returns a result but SHALL NOT write the D1 `sku_cache` table (that write is deferred to the order path via `place_order`). It SHALL return exactly one of three shapes — a confident match, an `ambiguous` result with narrowed candidates, or an `unavailable` result.

#### Scenario: Confident match returned

- **WHEN** the pipeline resolves an ingredient via a cache hit or a defined brand preference
- **THEN** it returns `{ resolved: true, sku, brand, size, price: { regular, promo }, on_sale, reason }` without writing the cache

#### Scenario: Ambiguous result returned

- **WHEN** deterministic narrowing leaves no confident pick
- **THEN** it returns `{ resolved: false, ambiguous: true, candidates: [...], reason }` for the consuming surface (the order checkpoint / review widget) to resolve

#### Scenario: Unavailable result returned

- **WHEN** no candidate is fulfillable via curbside or delivery at the resolved location
- **THEN** it returns `{ resolved: false, reason: "unavailable" }` and does not substitute

#### Scenario: The matcher is not a model tool

- **WHEN** a member connector's tool list is enumerated
- **THEN** `match_ingredient_to_kroger_sku` does not appear; ingredient resolution reaches the model only through `place_order`'s checkpoint reporting and the review widget's app ops

### Requirement: compare_unit_price deterministic comparison

The system SHALL provide the deterministic price-per-unit comparison core (`compareUnitPrice`) as an internal operation — it drives the matcher's tiebreaker, the substitution/order-review ranking, and any surface presenting comparable candidates; it is **not** a model-advertised MCP tool, so no LLM performs the arithmetic anywhere. It SHALL parse, convert, and divide internally, rank only within a single dimension (volume, weight, or count), and place cross-dimension or unparseable items in `incomparable`. A size SHALL be treated as unparseable — and routed to `incomparable` — whenever its computed base-unit quantity is not a finite positive number (zero, negative, or non-finite), including via a zero/`Infinity` multi-pack multiplier, a divide-by-zero fraction (`"1/0"`), or a `quantity_override` of `0`; such a size SHALL NOT yield a zero or non-finite `unit_price` that could sort as `cheapest`. A `price` string that is ambiguous to parse (more than one decimal point, or a decimal comma) SHALL parse to no value rather than a silently mis-scaled number. It SHALL accept optional `quantity_override`/`unit_override` for residue the parser could not handle.

#### Scenario: Ranked within a dimension

- **WHEN** the core receives same-dimension items with parseable sizes
- **THEN** it returns them ranked by ascending unit price with a `cheapest` id

#### Scenario: Cross-dimension and unparseable excluded

- **WHEN** items span different dimensions or carry unparseable size strings
- **THEN** those items are returned in `incomparable` rather than mis-ranked

#### Scenario: Degenerate size routes to incomparable, never cheapest

- **WHEN** an item's size yields a zero, negative, or non-finite base-unit quantity (e.g. `"0 x 1 oz"`, `"1/0 gal"`, or a `quantity_override` of `0`)
- **THEN** the item is returned in `incomparable` and is never selected as `cheapest`

#### Scenario: Ambiguous price string is not silently mis-parsed

- **WHEN** an item's `price` is an ambiguous string such as `"1.234,56"` or `"1.2.3"`
- **THEN** it parses to no value (the item is not ranked on a mis-scaled price) rather than producing a 1000×-wrong figure
