# grocery-list Specification (delta)

## MODIFIED Requirements

### Requirement: Grocery list schema

The grocery list SHALL be an ingredient-level, **SKU-free** buy list of committed buy-intent that accumulates across a week. Each item SHALL carry: `name` (required, the member's surface form and the order-time search-term input), `display_name` (nullable, the human-facing label rendered to the member; when null the rendered label falls back to `name`), `quantity` (loose buy amount, same looseness as pantry), `kind` (`grocery` | `household` | `other`, default `grocery`), `domain` (free string identifying the kind of store it's bought at — common values `grocery` | `home-improvement` | `garden` | `pharmacy`; default `grocery`), `status` (`active` | `in_cart` | `ordered`, required), `source` (`ad_hoc` | `menu` | `pantry_low` | `stockup`), `for_recipes` (recipe slugs; may be empty), `note` (freeform or null), `added_at` (ISO date, required), `ordered_at` (ISO date or null), and `sent_in` (nullable — the internal send-record linkage: the `order_sends` id whose flush advanced this row's current in-flight cart state; see `spend-telemetry` and the `order-placement` lifecycle). `sent_in` SHALL be stamped only by the order-flush advances (never by a manual status write, never accepted as a caller-writable field on any tool or HTTP surface) and cleared when the row leaves its in-flight send without a purchase assertion. The `name` and the dedup key (`normalized_name`, the canonical id for a food row) are stored separately, and `display_name` is stored independently of both — a surface a human reads SHALL render `display_name ?? name`, never the raw `normalized_name`/id. **`received` SHALL NOT be a stored status value**: receiving is the terminal receive *action* — the row is removed from the list and, for `grocery`-kind items only, the pantry is restocked — identical across every fulfillment mode (Kroger pickup, satellite checkout, in-store walk). The schema SHALL be documented in `docs/SCHEMAS.md`, and the list SHALL be agent-writable side-effect state (not user-curated config). Items SHALL NOT store a resolved Kroger SKU — resolution is deferred to order time. `domain` is orthogonal to `kind`: `kind` governs pantry reconcile on receive, `domain` governs which store-type a walk includes the item in.

#### Scenario: Item conforms to schema

- **WHEN** an item is written to the `grocery_list` table
- **THEN** it carries a `name`, a `status` from the legal set (`active` | `in_cart` | `ordered`), an `added_at` date, and no resolved SKU, and it passes write-time validation

#### Scenario: Display name is stored independently of the key

- **WHEN** a row is materialized by canonical id (e.g. accepting a graph-sibling swap) so its `normalized_name` is `cabbage::color-red`
- **THEN** its `display_name` holds the curated label ("Red cabbage"), the row still dedups/joins on the id, and the rendered label is "Red cabbage" — never the raw id

#### Scenario: Receiving removes the row rather than storing a terminal status

- **WHEN** the user asserts groceries were picked up / received
- **THEN** each received item's row is removed (and `grocery`-kind items restock the pantry) — no row is ever written with a `status: "received"`

#### Scenario: Non-food item is representable

- **WHEN** a household item such as "paper towels" is added
- **THEN** it is stored with `kind = "household"` and is not tied to any recipe or pantry entry

#### Scenario: Domain defaults to grocery

- **WHEN** an item is added with no `domain` supplied
- **THEN** it is stored with `domain = "grocery"` and validates unchanged (rows without a `domain` are read as `grocery`)

#### Scenario: Non-grocery item carries its domain

- **WHEN** a "2x4 lumber" item is added with `domain = "home-improvement"`
- **THEN** it is stored with that domain, included in an in-store walk for a `home-improvement` store, and excluded from a `grocery` walk

#### Scenario: The send linkage is not caller-writable

- **WHEN** any tool or HTTP write supplies a `sent_in` value
- **THEN** it is not accepted as an input field — `sent_in` is stamped and cleared only by the shared order-flush and status-transition operations
