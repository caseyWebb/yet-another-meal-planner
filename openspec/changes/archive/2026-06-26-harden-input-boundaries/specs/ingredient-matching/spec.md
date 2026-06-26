## MODIFIED Requirements

### Requirement: compare_unit_price deterministic comparison

The system SHALL provide `compare_unit_price(items)` performing deterministic price-per-unit comparison from raw `price` and `size` strings. It SHALL parse, convert, and divide internally so the LLM never performs arithmetic. It SHALL rank only within a single dimension (volume, weight, or count) and SHALL place cross-dimension or unparseable items in `incomparable`. A size SHALL be treated as unparseable — and routed to `incomparable` — whenever its computed base-unit quantity is not a finite positive number (zero, negative, or non-finite), including via a zero/`Infinity` multi-pack multiplier, a divide-by-zero fraction (`"1/0"`), or a `quantity_override` of `0`; such a size SHALL NOT yield a zero or non-finite `unit_price` that could sort as `cheapest`. A `price` string that is ambiguous to parse (more than one decimal point, or a decimal comma) SHALL parse to no value rather than a silently mis-scaled number. It SHALL accept optional `quantity_override`/`unit_override` for residue the parser could not handle. The same core SHALL drive the matcher's tiebreaker.

#### Scenario: Ranked within a dimension

- **WHEN** `compare_unit_price` receives same-dimension items with parseable sizes
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
