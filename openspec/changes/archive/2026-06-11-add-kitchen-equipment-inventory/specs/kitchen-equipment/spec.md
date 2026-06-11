## ADDED Requirements

### Requirement: Per-tenant kitchen inventory with a gating/non-gating split

The system SHALL store each member's kitchen equipment in `users/<username>/kitchen.toml` with two structurally-separated regions: a top-level `owned` array of controlled-vocabulary equipment slugs (the **only** region that gates recipe makeability) and an open `[notes]` table of free-text equipment context (oven count, pan sizes, sheet trays — read by the `cook` skill for parallelization, **never** by the makeability gate). The gate SHALL read only `owned`; free-text in `[notes]` SHALL NOT be able to gate any recipe. An absent `kitchen.toml` or an empty `owned` SHALL be valid and means the member's owned equipment is unknown.

#### Scenario: Owned slugs gate, notes never do

- **WHEN** a member's `kitchen.toml` has `owned = ["blender"]` and `notes.free_text = "10-inch cast iron"`
- **THEN** the makeability gate considers only `["blender"]` and the free-text never causes any recipe to be gated in or out

#### Scenario: Absent file is valid

- **WHEN** a member has no `kitchen.toml`
- **THEN** the system treats their owned equipment as unknown rather than empty-and-known, and reading their kitchen returns an empty inventory without error

### Requirement: Deterministic makeability rule

The system SHALL define recipe **makeability** for a caller as the subset test `recipe.requires_equipment ⊆ owned`, where `owned` is the caller's `kitchen.toml` `owned` array. A recipe whose `requires_equipment` is empty or absent SHALL be makeable by everyone. When the caller's `owned` is empty or their `kitchen.toml` is absent, **every** recipe SHALL be considered makeable (unknown inventory is a gate no-op — unknown is not the same as not-owned), so a member who has not recorded equipment is never shown a reduced corpus. The rule SHALL be a pure, deterministic function of the recipe's indexed `requires_equipment` and the caller's `owned` — no ranking, scoring, or fuzzy matching.

#### Scenario: Recipe requiring un-owned equipment is unmakeable

- **WHEN** a recipe has `requires_equipment: ["pressure-cooker"]` and the caller's `owned` is `["blender"]`
- **THEN** the recipe is unmakeable for that caller (its requirement is not a subset of `owned`)

#### Scenario: Empty requirement is always makeable

- **WHEN** a recipe has empty or absent `requires_equipment`
- **THEN** it is makeable for every caller regardless of their `owned` list

#### Scenario: Empty inventory makes everything makeable

- **WHEN** the caller's `owned` is empty or their `kitchen.toml` is absent
- **THEN** every recipe is considered makeable for that caller, and the gate suppresses nothing

### Requirement: read_kitchen tool

The system SHALL provide a `read_kitchen()` tool returning the caller's `{ owned: [...], notes: {...} }` from their `users/<username>/kitchen.toml`, returning an empty inventory (`owned: []`, `notes: {}`) rather than an error when the file is absent.

#### Scenario: Reading a populated inventory

- **WHEN** `read_kitchen()` is called and the caller's `kitchen.toml` lists owned equipment and notes
- **THEN** it returns the `owned` slugs and the `notes` table

#### Scenario: Reading an absent inventory

- **WHEN** `read_kitchen()` is called and the caller has no `kitchen.toml`
- **THEN** it returns `{ owned: [], notes: {} }` without error

### Requirement: update_kitchen tool

The system SHALL provide an `update_kitchen(operations)` tool that applies add/remove operations to the caller's `owned` list and sets fields in `[notes]`, writing to the caller's `users/<username>/kitchen.toml` (agent-editable on user direction, the same posture as `update_pantry`). An `add` whose equipment slug is outside `EQUIPMENT_VOCAB` SHALL surface a structured conflict (and SHALL NOT silently write an off-vocab slug into `owned`), keeping the gate's left operand vocabulary-clean. Removing a slug not present SHALL surface a conflict rather than failing the whole call.

#### Scenario: Adding owned equipment

- **WHEN** `update_kitchen` adds `"pressure-cooker"` to a caller with no prior inventory
- **THEN** the caller's `kitchen.toml` `owned` contains `"pressure-cooker"` and a later `read_kitchen()` reflects it

#### Scenario: Off-vocabulary equipment is rejected

- **WHEN** `update_kitchen` attempts to add an equipment slug not in `EQUIPMENT_VOCAB`
- **THEN** the tool returns a structured conflict identifying the unknown slug and does not write it into `owned`

#### Scenario: Setting a free-text note

- **WHEN** `update_kitchen` sets `notes.ovens = 2`
- **THEN** the caller's `kitchen.toml` `[notes]` records `ovens = 2` without affecting `owned` or any recipe's gating
