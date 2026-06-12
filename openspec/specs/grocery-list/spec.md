# grocery-list Specification

## Purpose
TBD - created by archiving change git-write-tools. Update Purpose after archive.
## Requirements
### Requirement: Grocery list file and schema

The system SHALL maintain `grocery_list.toml` at the repo root as an ingredient-level, **SKU-free** buy list of committed buy-intent that accumulates across a week. Each item SHALL carry: `name` (required, the order-time search term), `quantity` (loose buy amount, same looseness as pantry), `kind` (`grocery` | `household` | `other`, default `grocery`), `status` (`active` | `in_cart` | `ordered`, required), `source` (`ad_hoc` | `menu` | `pantry_low` | `stockup`), `for_recipes` (recipe slugs; may be empty), `note` (freeform or null), `added_at` (ISO date, required), and `ordered_at` (ISO date or null). The schema SHALL be documented in `docs/SCHEMAS.md`, and the file SHALL be an agent-writable side-effect file (not user-curated config). Items SHALL NOT store a resolved Kroger SKU — resolution is deferred to order time (Change 06b).

#### Scenario: Item conforms to schema

- **WHEN** an item is written to `grocery_list.toml`
- **THEN** it carries a `name`, a `status` from the legal set, an `added_at` date, and no resolved SKU, and it passes structural validation

#### Scenario: Non-food item is representable

- **WHEN** a household item such as "paper towels" is added
- **THEN** it is stored with `kind = "household"` and is not tied to any recipe or pantry entry

### Requirement: Grocery list CRUD tools

The system SHALL provide `read_grocery_list`, `add_to_grocery_list`, `update_grocery_list`, and `remove_from_grocery_list` for single-item live edits. `add_to_grocery_list` SHALL be keyed by normalized `name`: re-adding an existing name MERGES into the existing entry (union `for_recipes`, reconcile `quantity`) rather than creating a duplicate. New items SHALL be created with `status: active`. All mutations SHALL persist via the atomic commit engine.

Multiple grocery-list mutations produced while resolving a single turn SHALL be persisted as **one** commit — via `commit_changes`' `grocery_list_ops` field — rather than as a sequence of single-item commits or as parallel single-item writes. Because grocery-list writes are full-file read-modify-writes of one file, concurrent single-item writes are not safe (the commit engine's full-file replay can drop updates); the single-item tools are for genuine one-off edits, and any batch SHALL go through `commit_changes`.

#### Scenario: Re-adding an existing item merges

- **WHEN** `add_to_grocery_list` is called with a name already present on the list
- **THEN** the existing entry is updated (merged `for_recipes`, reconciled `quantity`) and no duplicate entry is created

#### Scenario: New item starts active

- **WHEN** a not-yet-present item is added
- **THEN** it is created with `status: "active"` and an `added_at` date and committed

#### Scenario: Read returns the current list

- **WHEN** `read_grocery_list` is called
- **THEN** it returns the current items with their fields, including `status` and `source`

#### Scenario: A multi-item capture is one commit

- **WHEN** a menu capture adds several to-buy items at once
- **THEN** they are persisted through `commit_changes` `grocery_list_ops` as a single commit (together with the menu's other repo writes), not as one commit per item

### Requirement: Prompted promotion from pantry

When a pantry item is low or out, the system SHALL treat adding it to the grocery list as a prompted, user-confirmed decision and SHALL NOT auto-add it. An item promoted from pantry SHALL be recorded with `source: "pantry_low"`. Observation (pantry quantity) and intent (the buy list) are kept as distinct facts.

#### Scenario: Low pantry item is offered, not auto-added

- **WHEN** the user reports an item is low or out and the agent considers it for the buy list
- **THEN** the item is added to `grocery_list.toml` only after the user confirms, recorded with `source: "pantry_low"`

### Requirement: Provenance supports order-time dedup and aggregation

The list's `source` and `for_recipes` fields SHALL carry enough provenance for order-time reconciliation (Change 06b) without storing portion math. `for_recipes` SHALL let the agent aggregate how much the menu needs of an ingredient from the recipes' stated amounts; the order-time to-buy set SHALL be definable as `grocery_list ∪ menu-needs − pantry-has`. This capability defines the data contract only; SKU resolution and the cart write are out of scope here.

#### Scenario: Menu-derived item records its recipes

- **WHEN** an ingredient is added because the agreed menu needs it
- **THEN** it is recorded with `source: "menu"` and the contributing recipe slugs in `for_recipes`

#### Scenario: Lifecycle field present but order transitions deferred

- **WHEN** the grocery-list tools in this change write an item
- **THEN** they set only `status: "active"`; the transitions to `in_cart`, `ordered`, and removal-on-receive are introduced with order placement in Change 06b

