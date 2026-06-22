## MODIFIED Requirements

### Requirement: Grocery list file and schema

The system SHALL maintain the grocery list as a JSON value stored at DATA_KV key `state:<username>:grocery_list` — an ingredient-level, **SKU-free** buy list of committed buy-intent that accumulates across a week. The list is no longer stored as `grocery_list.toml` in the GitHub data repo. Each item SHALL carry: `name` (required, the order-time search term), `quantity` (loose buy amount), `kind` (`grocery` | `household` | `other`, default `grocery`), `domain` (free string identifying the kind of store; common values `grocery` | `home-improvement` | `garden` | `pharmacy`; default `grocery`), `status` (`active` | `in_cart` | `ordered`, required), `source` (`ad_hoc` | `menu` | `pantry_low` | `stockup`), `for_recipes` (recipe slugs; may be empty), `note` (freeform or null), `added_at` (ISO date, required), and `ordered_at` (ISO date or null). Items SHALL NOT store a resolved Kroger SKU — resolution is deferred to order time. `domain` is orthogonal to `kind`: `kind` governs pantry reconcile on receive, `domain` governs which store-type a walk includes the item in. All reads and writes to the grocery list SHALL go through DATA_KV with no GitHub API call.

#### Scenario: Item conforms to schema

- **WHEN** an item is written to the grocery list KV key
- **THEN** it carries a `name`, a `status` from the legal set, an `added_at` date, and no resolved SKU

#### Scenario: Non-food item is representable

- **WHEN** a household item such as "paper towels" is added
- **THEN** it is stored with `kind = "household"` and is not tied to any recipe or pantry entry

#### Scenario: Domain defaults to grocery

- **WHEN** an item is added without an explicit `domain`
- **THEN** `domain` is stored as `"grocery"`

#### Scenario: Grocery list reads from KV with no GitHub call

- **WHEN** `read_grocery_list()` is called
- **THEN** the Worker reads `state:<username>:grocery_list` from DATA_KV and returns the item array without making any GitHub API call
