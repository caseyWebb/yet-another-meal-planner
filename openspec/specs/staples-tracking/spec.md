# staples-tracking Specification

## Purpose

Defines the per-tenant "don't run out of these" staples list: the data model (D1 `staples` table), the agent-facing tool (`update_staples`), how to read the list (via `read_user_profile().staples`, a bare `StaplesItem[]` array), and the three behavioral flows that key on it — pantry-depletion restock prompting, meal-plan restocking callout, and perishable-staleness nudge. Staples are orthogonal to the bulk-buy watchlist (D1 `stockup` table): an item can appear in both (availability-driven always-on-hand vs. price-opportunism bulk-buy), and they fire at different moments for different reasons.
## Requirements
### Requirement: Staples list is a per-tenant curated opt-in catalog

The system SHALL maintain a per-tenant staples list in the D1 `staples` table that stores the member's "don't run out of these" items. Each item SHALL have a required `name` field and an optional `perishable: true` flag. The list SHALL be curated through the member web app over the shared staples write operation (add deduped by normalized `name`; remove silently succeeding when absent) — there is no `update_staples` MCP tool — and is read via the `staples` array on `read_user_profile()`, a bare `StaplesItem[]` (not `{ items: [...] }`). An empty or absent staples list SHALL degrade gracefully — all staples-driven behaviors become no-ops, preserving existing behavior for members who have not set up a list.

#### Scenario: Staples list is present with items

- **WHEN** a member has `[{ name: "olive oil" }, { name: "eggs", perishable: true }]` in their D1 staples table
- **THEN** `read_user_profile().staples` returns both items with their fields, and staples-driven flows use this list

#### Scenario: Staples list is empty

- **WHEN** a member has no rows in their D1 staples table
- **THEN** `read_user_profile().staples` returns an empty array and all staples-driven prompting behaviors are suppressed (no error, no prompting)

#### Scenario: Curation is a member-app write

- **WHEN** a member adds or removes a staple
- **THEN** the member app writes through the shared operation (dedup by normalized name, silent absent-remove), and no staples write tool appears on the MCP surface

#### Scenario: Perishable flag is optional

- **WHEN** a staple item is added without `perishable`
- **THEN** the item is stored without the flag and is treated as non-perishable (no staleness prompting for it)

### Requirement: Pantry depletion prompts restock only for staples

When a pantry update removes or depletes an item (quantity goes to zero or the item is removed), the agent SHALL cross-reference the depleted item against the caller's staples list (from `read_user_profile().staples`). If the item is a staple, the agent SHALL ask the user whether to add it to the shopping list. If the item is not a staple, the agent SHALL record the pantry change silently without prompting for a restock.

#### Scenario: Depleted staple triggers restock prompt

- **WHEN** the user says "I used the last of the olive oil" and olive oil is in their staples list
- **THEN** the agent updates pantry and asks "Olive oil is one of your staples — want me to add it to the shopping list?"

#### Scenario: Depleted non-staple is silent

- **WHEN** the user says "I used the last of the fish sauce" and fish sauce is NOT in their staples list
- **THEN** the agent updates pantry and does not prompt to add fish sauce to the shopping list

#### Scenario: No staples list — depletion is always silent

- **WHEN** the user reports a depletion and they have no staples in D1
- **THEN** the agent updates pantry and does not prompt for any restock (same as current behavior)

### Requirement: Shopping list / meal-plan restocking callout is backed by staples data

During shopping list assembly or meal plan generation, the agent SHALL read the caller's staples from `read_user_profile().staples` and cross-reference each staple against the caller's current pantry. Staples that are missing from the pantry or appear low (agent judgment over the freeform quantity string) SHALL be surfaced as a restocking callout and confirmed with the user before being added to the grocery list.

#### Scenario: Missing staple surfaces in restocking callout

- **WHEN** olive oil is in the staples list and absent from the pantry
- **THEN** the agent includes "olive oil" in the restocking callout and asks whether to add it to the list

#### Scenario: Low staple surfaces in restocking callout

- **WHEN** kosher salt is in the staples list and the pantry shows quantity "almost out"
- **THEN** the agent includes "kosher salt" in the restocking callout

#### Scenario: Well-stocked staple is skipped

- **WHEN** a staple's pantry quantity reads as adequate
- **THEN** it is not mentioned in the restocking callout

#### Scenario: No staples list — restocking callout falls back to model judgment

- **WHEN** the user has an empty staples list in D1 and a meal plan is requested
- **THEN** the agent's restocking callout (if any) is based on model judgment, same as current behavior

### Requirement: Perishable staples trigger staleness nudge

For staples with `perishable: true`, the agent SHALL check the item's `last_verified_at` in the pantry (D1 pantry table). If `last_verified_at` is absent or older than 7 days, the agent SHALL surface a staleness nudge during the shopping/meal-plan flow asking whether the member still has the item. Multiple stale perishables SHALL be batched into a single natural-language prompt rather than asked individually.

#### Scenario: Stale perishable staple triggers nudge

- **WHEN** eggs are in staples with `perishable: true` and the pantry entry for eggs has `last_verified_at` older than 7 days
- **THEN** the agent asks "It's been a while since you updated eggs — do you still have some?"

#### Scenario: Recently verified perishable is skipped

- **WHEN** a perishable staple's `last_verified_at` is within the last 7 days
- **THEN** no staleness nudge is issued for it

#### Scenario: Multiple stale perishables are batched

- **WHEN** eggs, milk, and butter are all perishable staples and all stale
- **THEN** the agent asks about them together in one prompt, not three separate questions

#### Scenario: Perishable staple absent from pantry triggers nudge

- **WHEN** a perishable staple has no pantry row at all
- **THEN** the agent treats it as stale and includes it in the staleness nudge batch

