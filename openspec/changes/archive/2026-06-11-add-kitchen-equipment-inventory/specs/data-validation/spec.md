## MODIFIED Requirements

### Requirement: Warn-only soft validation

The system SHALL emit warnings, without failing the build, when recommended-but-optional frontmatter fields (e.g. `protein`, `time_total`, `rating`, `ingredients_key`) are missing or null. Optional arrays such as `uses_components` / `produces_components` / `pairs_with` / `requires_equipment` SHALL default to empty without warning, and the optional boolean `standalone` SHALL default to unset without warning.

#### Scenario: Missing optional field warns but passes

- **WHEN** a recipe omits `protein` and `time_total` but has a valid `title` and `status`
- **THEN** the build prints a warning naming the missing fields and still exits successfully

#### Scenario: Absent pairing fields do not warn

- **WHEN** a recipe omits `pairs_with` and `standalone`
- **THEN** the build defaults them (empty / unset) and exits successfully without warning

#### Scenario: Absent required-equipment field does not warn

- **WHEN** a recipe omits `requires_equipment`
- **THEN** the build defaults it to empty (the recipe is makeable by everyone) and exits successfully without warning

## ADDED Requirements

### Requirement: Controlled vocabulary for required equipment

The system SHALL validate recipe frontmatter `requires_equipment` against a controlled allowed-value set (`EQUIPMENT_VOCAB`) of slugs naming gear a dish is genuinely impossible without (the "no recipe-preserving workaround exists" test — deliberately small). A `requires_equipment` entry **present** but outside the allowed set SHALL be a hard build failure naming the offending value, recipe, and field. Absence of `requires_equipment` (or an empty array) SHALL NOT be a failure or a warning. The allowed set SHALL be defined in the validator (alongside the `protein`/`cuisine`/`status` sets) and documented in `docs/SCHEMAS.md`. The Worker write path for recipes SHALL accept `requires_equipment` as a loose array (no Worker-side vocabulary enforcement), because the makeability gate reads only `_indexes/recipes.json`, which only the build regenerates — so an off-vocabulary slug cannot reach the gate without the build, which fails first.

#### Scenario: Out-of-vocabulary equipment blocks the build

- **WHEN** a recipe declares `requires_equipment: ["panini-press"]` and `panini-press` is not in `EQUIPMENT_VOCAB`
- **THEN** the build exits non-zero and names the offending value, recipe, and field

#### Scenario: In-vocabulary equipment passes

- **WHEN** a recipe declares `requires_equipment: ["pressure-cooker", "blender"]`, both in `EQUIPMENT_VOCAB`
- **THEN** the build accepts the recipe and carries the array into the index

#### Scenario: Absent equipment requirement passes silently

- **WHEN** a recipe omits `requires_equipment`
- **THEN** the build neither fails nor warns and treats the recipe as makeable by everyone

### Requirement: Kitchen inventory structural validation

The system SHALL structurally validate a member's `users/<username>/kitchen.toml` — both in the Node validator (`scripts/build-indexes.mjs`, when run over a data checkout) and in the Worker's write-time structural subset (`src/validate.ts`). Validation SHALL hard-fail (Node: non-zero exit; Worker: structured error, no commit) when: the file does not parse as TOML; `owned` is present but not an array of strings; or an `owned` entry is a slug outside `EQUIPMENT_VOCAB`. The `[notes]` table SHALL be freeform and SHALL NOT be schema-validated beyond parsing. An absent `kitchen.toml` SHALL be valid.

#### Scenario: Off-vocabulary owned slug fails

- **WHEN** a `kitchen.toml` lists `owned = ["air-fryer"]` and `air-fryer` is not in `EQUIPMENT_VOCAB`
- **THEN** validation hard-fails and names the offending slug

#### Scenario: Freeform notes pass

- **WHEN** a `kitchen.toml` has valid `owned` slugs and an arbitrary `[notes]` table
- **THEN** validation passes, parse-checking but not schema-validating `[notes]`

#### Scenario: Absent kitchen file passes

- **WHEN** a member has no `kitchen.toml`
- **THEN** validation passes (an unknown inventory is valid)
