# kitchen-equipment — delta

## ADDED Requirements

### Requirement: Equipment inventory edits ride update_pantry operations

Kitchen-equipment edits SHALL be `update_pantry` operations — `{ op: "equip" | "unequip", slug }` against the caller's `owned` list and `{ op: "set_kitchen_note", key, value }` against the freeform notes — delegating to the same kitchen apply path (D1 `kitchen_equipment` rows + `profile.kitchen_notes`) with its guarantees intact: an `equip` whose slug is outside `EQUIPMENT_VOCAB` SHALL surface a structured per-op conflict (never a silent write into the gate's left operand), an `equip` of an already-owned slug SHALL be idempotent, an `unequip` of an absent slug SHALL surface a conflict rather than failing the whole call, and `set_kitchen_note` fields SHALL inform the cook flow only and never gate a recipe.

#### Scenario: Equipping via update_pantry

- **WHEN** `update_pantry` applies `{ op: "equip", slug: "pressure-cooker" }` for a caller with no prior inventory
- **THEN** the caller's D1 kitchen inventory `owned` contains `pressure-cooker` and a later `read_user_profile().kitchen` reflects it

#### Scenario: Off-vocabulary equipment is rejected

- **WHEN** an `equip` op carries a slug not in `EQUIPMENT_VOCAB`
- **THEN** that operation returns a structured conflict identifying the unknown slug and does not write it into `owned`

#### Scenario: Setting a free-text note

- **WHEN** `update_pantry` applies `{ op: "set_kitchen_note", key: "ovens", value: 2 }`
- **THEN** the caller's kitchen `notes` records `ovens = 2` without affecting `owned` or any recipe's gating

## REMOVED Requirements

### Requirement: update_kitchen tool

**Reason**: Folded into `update_pantry`'s operations in the surface cull — the kitchen is inventory-adjacent state edited in the same conversational moments as the pantry, and a separate tool was one more overlapping verb for a weak model to misfire on.
**Migration**: `update_pantry` `equip`/`unequip`/`set_kitchen_note` ops over the unchanged kitchen apply path (this delta's ADDED requirement). No dispatch alias: `update_kitchen`'s op shapes are not call-compatible with the pantry operations array, and stale calls receive the generic unknown-tool rejection behind the coordinated plugin publish.
