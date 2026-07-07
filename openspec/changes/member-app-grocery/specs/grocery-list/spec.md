## MODIFIED Requirements

### Requirement: Grocery list schema

The grocery list SHALL be an ingredient-level, **SKU-free** buy list of committed buy-intent that accumulates across a week. Each item SHALL carry: `name` (required, the order-time search term), `quantity` (loose buy amount, same looseness as pantry), `kind` (`grocery` | `household` | `other`, default `grocery`), `domain` (free string identifying the kind of store it's bought at — common values `grocery` | `home-improvement` | `garden` | `pharmacy`; default `grocery`), `status` (`active` | `in_cart` | `ordered`, required), `source` (`ad_hoc` | `menu` | `pantry_low` | `stockup`), `for_recipes` (recipe slugs; may be empty), `note` (freeform or null), `added_at` (ISO date, required), and `ordered_at` (ISO date or null). **`received` SHALL NOT be a stored status value**: receiving is the terminal receive *action* — the row is removed from the list and, for `grocery`-kind items only, the pantry is restocked — identical across every fulfillment mode (Kroger pickup, satellite checkout, in-store walk). The schema SHALL be documented in `docs/SCHEMAS.md`, and the list SHALL be agent-writable side-effect state (not user-curated config). Items SHALL NOT store a resolved Kroger SKU — resolution is deferred to order time. `domain` is orthogonal to `kind`: `kind` governs pantry reconcile on receive, `domain` governs which store-type a walk includes the item in.

#### Scenario: Item conforms to schema

- **WHEN** an item is written to the `grocery_list` table
- **THEN** it carries a `name`, a `status` from the legal set (`active` | `in_cart` | `ordered`), an `added_at` date, and no resolved SKU, and it passes write-time validation

#### Scenario: Receiving removes the row rather than storing a terminal status

- **WHEN** the user asserts groceries were picked up / received
- **THEN** each received item's row is removed (and `grocery`-kind items restock the pantry) — no row is ever written with `status: "received"`

#### Scenario: Non-food item is representable

- **WHEN** a household item such as "paper towels" is added
- **THEN** it is stored with `kind = "household"` and is not tied to any recipe or pantry entry

#### Scenario: Domain defaults to grocery

- **WHEN** an item is added with no `domain` supplied
- **THEN** it is stored with `domain = "grocery"` and validates unchanged (rows without a `domain` are read as `grocery`)

#### Scenario: Non-grocery item carries its domain

- **WHEN** a "2x4 lumber" item is added with `domain = "home-improvement"`
- **THEN** it is stored with that domain, included in an in-store walk for a `home-improvement` store, and excluded from a `grocery` walk

### Requirement: Provenance supports order-time dedup and aggregation

The list's `source` and `for_recipes` fields SHALL carry enough provenance for order-time reconciliation without storing portion math. The order-time to-buy set SHALL be `grocery_list(active) ∪ menu-needs − pantry-has`, where **menu needs are derived server-side from the meal plan's recipes' derived full ingredient lists** (see the derived to-buy read requirement) rather than materialized into rows at plan time; `for_recipes` SHALL let the agent aggregate how much the menu needs of an ingredient from the recipes' stated amounts. Explicit `source: "menu"` rows remain legal and meaningful: they are **materializations** — a derived need pinned or edited into an explicit row (or an open-world side's world-knowledge ingredients, which have no recipe to derive from) — and they merge with the derived need under the same canonical id. Lifecycle transitions past `active` (`in_cart`, `ordered`, and the terminal receive action) are driven by the order-placement flow and the user-asserted transitions.

#### Scenario: Menu-derived item records its recipes

- **WHEN** an ingredient reaches the list as an explicit menu row (a materialization or an open-world side ingredient)
- **THEN** it is recorded with `source: "menu"` and any contributing recipe slugs in `for_recipes`

#### Scenario: A materialized row and its derived need do not double-count

- **WHEN** the order-time to-buy set is computed while an ingredient exists both as a derived plan need and as an explicit `source: "menu"` row
- **THEN** the two merge on the canonical id into a single to-buy line with unioned `for_recipes`

## ADDED Requirements

### Requirement: The to-buy set is a derived, first-class read

The system SHALL expose the order-time to-buy set as a read — computed at read time from the `active` grocery list, the meal plan's derived ingredient needs, and the pantry, joined on canonical ingredient ids by the same shared set-algebra operation `place_order` uses — via the MCP `read_to_buy` tool and the member app's grocery read surface, both calling one shared operation. Derived lines SHALL carry `source:"menu"`-shaped provenance (`origin: "plan"`, `for_recipes`) and SHALL exist only in the read: no reconcile, cron, or write path SHALL materialize plan needs into `grocery_list` rows automatically — materialization SHALL happen only through an explicit edit/pin (the standard add upsert). Pantry-covered needs SHALL be returned as a distinct section (never silently dropped), and planned recipes with no derived ingredient list SHALL be reported by slug.

#### Scenario: The plan is the source of truth for derived lines

- **WHEN** the meal plan changes (a recipe added, removed, or swapped)
- **THEN** the next to-buy read reflects the change with no intervening write to `grocery_list`

#### Scenario: No automatic materialization

- **WHEN** the to-buy read computes derived lines
- **THEN** it writes nothing: repeated reads with unchanged inputs return the same lines and leave `grocery_list` untouched
