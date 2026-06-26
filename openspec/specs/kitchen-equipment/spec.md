# kitchen-equipment Specification

## Purpose

Defines the per-tenant kitchen equipment inventory: the data model (D1 `kitchen_equipment` table + profile notes), how to read the inventory (via `read_user_profile().kitchen`), and the `update_kitchen` write tool. Equipment data drives the deterministic recipe makeability gate (`requires_equipment ⊆ owned`) and is surfaced to the cook skill for parallelization context.
## Requirements
### Requirement: Per-tenant kitchen inventory with a gating/non-gating split

The system SHALL store each member's kitchen equipment in D1 with two structurally-separated regions: a `kitchen_equipment` table of controlled-vocabulary equipment slugs (the **only** region that gates recipe makeability) — surfaced as `owned: [...]` — and profile-level `notes` of free-text equipment context (oven count, pan sizes, sheet trays — read by the `cook` skill for parallelization, **never** by the makeability gate). The gate SHALL read only `owned`; free-text in `notes` SHALL NOT be able to gate any recipe. An absent kitchen inventory or an empty `owned` SHALL be valid and means the member's owned equipment is unknown.

#### Scenario: Owned slugs gate, notes never do

- **WHEN** a member's kitchen inventory has `owned = ["blender"]` and `notes.free_text = "10-inch cast iron"`
- **THEN** the makeability gate considers only `["blender"]` and the free-text never causes any recipe to be gated in or out

#### Scenario: Absent inventory is valid

- **WHEN** a member has no kitchen equipment rows in D1
- **THEN** the system treats their owned equipment as unknown rather than empty-and-known, and reading their kitchen via `read_user_profile().kitchen` returns an empty inventory without error

### Requirement: Deterministic makeability rule

The system SHALL define recipe **makeability** for a caller as the subset test `recipe.requires_equipment ⊆ owned`, where `owned` is the caller's `kitchen_equipment` rows from D1 (surfaced as `read_user_profile().kitchen.owned`). A recipe whose `requires_equipment` is empty or absent SHALL be makeable by everyone. When the caller's `owned` is empty or their kitchen inventory is absent from D1, **every** recipe SHALL be considered makeable (unknown inventory is a gate no-op — unknown is not the same as not-owned), so a member who has not recorded equipment is never shown a reduced corpus. The rule SHALL be a pure, deterministic function of the recipe's indexed `requires_equipment` and the caller's `owned` — no ranking, scoring, or fuzzy matching.

#### Scenario: Recipe requiring un-owned equipment is unmakeable

- **WHEN** a recipe has `requires_equipment: ["pressure-cooker"]` and the caller's `owned` is `["blender"]`
- **THEN** the recipe is unmakeable for that caller (its requirement is not a subset of `owned`)

#### Scenario: Empty requirement is always makeable

- **WHEN** a recipe has empty or absent `requires_equipment`
- **THEN** it is makeable for every caller regardless of their `owned` list

#### Scenario: Empty inventory makes everything makeable

- **WHEN** the caller's `owned` is empty or their kitchen inventory is absent from D1
- **THEN** every recipe is considered makeable for that caller, and the gate suppresses nothing

### Requirement: Kitchen inventory is read via read_user_profile

The system SHALL expose the caller's kitchen inventory as `{ owned: [...], notes: {...} }` within the `kitchen` field of `read_user_profile()`, assembled from the D1 `kitchen_equipment` rows and profile notes in one batched call. There is no separate `read_kitchen` tool; callers SHALL access `read_user_profile().kitchen`. An absent inventory SHALL return `owned: []`, `notes: {}` rather than an error.

#### Scenario: Reading a populated inventory

- **WHEN** `read_user_profile()` is called and the caller's D1 kitchen inventory has owned equipment and notes
- **THEN** `kitchen.owned` contains the equipment slugs and `kitchen.notes` contains the freeform context

#### Scenario: Reading an absent inventory

- **WHEN** `read_user_profile()` is called and the caller has no kitchen equipment rows in D1
- **THEN** `kitchen` is `{ owned: [], notes: {} }` without error

### Requirement: update_kitchen tool

The system SHALL provide an `update_kitchen(operations)` tool that applies add/remove operations to the caller's `owned` list and sets fields in `notes`, writing to the D1 `kitchen_equipment` table and profile notes (agent-editable on user direction, the same posture as `update_pantry`). An `add` whose equipment slug is outside `EQUIPMENT_VOCAB` SHALL surface a structured conflict (and SHALL NOT silently write an off-vocab slug into `owned`), keeping the gate's left operand vocabulary-clean. Removing a slug not present SHALL surface a conflict rather than failing the whole call.

#### Scenario: Adding owned equipment

- **WHEN** `update_kitchen` adds `"pressure-cooker"` to a caller with no prior inventory
- **THEN** the caller's D1 kitchen inventory `owned` contains `"pressure-cooker"` and a later `read_user_profile().kitchen` reflects it

#### Scenario: Off-vocabulary equipment is rejected

- **WHEN** `update_kitchen` attempts to add an equipment slug not in `EQUIPMENT_VOCAB`
- **THEN** the tool returns a structured conflict identifying the unknown slug and does not write it into `owned`

#### Scenario: Setting a free-text note

- **WHEN** `update_kitchen` sets `notes.ovens = 2`
- **THEN** the caller's kitchen `notes` records `ovens = 2` without affecting `owned` or any recipe's gating

