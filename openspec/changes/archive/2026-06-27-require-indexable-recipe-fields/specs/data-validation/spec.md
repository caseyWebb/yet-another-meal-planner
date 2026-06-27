## MODIFIED Requirements

### Requirement: Required frontmatter fields

The system SHALL require every recipe to define **all** system-consumed frontmatter
fields, present even when empty (the blunt-uniform contract owned by the
`recipe-metadata-contract` capability): `title`, `description`, `ingredients_key`,
`course`, `protein`, `cuisine`, `time_total`, `source`, `dietary`, `season`, `tags`,
`pairs_with`, `perishable_ingredients`, `requires_equipment`, and `side_search_terms`.
A missing required field SHALL be a hard failure at build time (non-zero exit) and at
Worker write time (`validation_failed`, no commit), naming the missing field and recipe.
`title`, `description`, `ingredients_key`, and `course` SHALL additionally be non-empty.
`status` is **not** a required or validated field (the lifecycle is retired); a lingering
value is tolerated and stripped from the index.

#### Scenario: Missing title blocks the build

- **WHEN** a recipe omits `title` or sets it empty
- **THEN** the build exits non-zero and reports the missing required field

#### Scenario: Missing ingredients_key blocks the build

- **WHEN** a recipe omits `ingredients_key` (or sets it to an empty array)
- **THEN** the build exits non-zero and names the missing/empty required field and recipe

#### Scenario: Present-but-empty required arrays are accepted

- **WHEN** a recipe carries every required field with `dietary: []`, `pairs_with: []`, and `perishable_ingredients: []`
- **THEN** the build accepts the recipe (the empty form is present)

#### Scenario: Status is not required

- **WHEN** a recipe omits `status` (or carries any `status` value)
- **THEN** the build validates it fine — `status` is neither required nor enum-checked

### Requirement: Controlled vocabulary for variety dimensions

The system SHALL validate recipe frontmatter `protein` and `cuisine` against controlled
allowed-value sets (coarse buckets — e.g. `fish` rather than `salmon`) so variety
reasoning is reliable. This validation SHALL run in **both** the Node index-build
validator (`scripts/build-indexes.mjs`) and the Worker's write-time structural subset
(`src/validate.ts`), drawing the allowed sets from a single shared definition so the two
cannot drift. `protein` and `cuisine` SHALL each be **present** on every recipe, carrying
either an in-vocabulary value or the explicit literal `null` (the canonical "no value"
form). A value present but outside its allowed set SHALL be a hard failure naming the
offending value, recipe, and field — Node: non-zero exit; Worker: a structured
`validation_failed` error that aborts the commit. The write path SHALL NOT translate a
no-focus dish into an *absent* field and SHALL NOT accept the literal string `"none"`;
"no protein focus" is expressed as `protein: null`. The allowed sets SHALL be documented
in `docs/SCHEMAS.md`.

#### Scenario: Out-of-vocabulary protein blocks the build

- **WHEN** a recipe declares `protein: salmon` and `salmon` is not in the allowed protein set (it collapses to `fish`)
- **THEN** the build exits non-zero and reports the invalid value, recipe, and field

#### Scenario: Out-of-vocabulary protein is rejected at write time

- **WHEN** `create_recipe` or `update_recipe` persists a recipe with `protein: shrimp` (the bucket is `shellfish`)
- **THEN** the Worker returns a structured `validation_failed` error naming the field and value, and makes no commit

#### Scenario: A no-protein dish carries explicit null

- **WHEN** `create_recipe` or `update_recipe` persists a vegetable side or condiment with no protein focus
- **THEN** it is written with `protein: null` (present and explicit), and a `protein: "none"` or omitted `protein` is rejected as non-compliant

#### Scenario: In-vocabulary value passes

- **WHEN** a recipe declares `protein: fish` and `cuisine: filipino`, both in their allowed sets
- **THEN** validation passes for those fields

### Requirement: Course field shape validation

The system SHALL require `course` to be **present** on every recipe as a **non-empty**
array of strings (a lone string is normalized to a one-element array), and SHALL
hard-fail the build (non-zero exit) — and the Worker write at `validation_failed` —
naming the offending value, recipe, and field when it is absent, empty, or not a
string/array-of-strings. The system SHALL NOT validate `course` *values* against any
controlled set (unlike `protein` / `cuisine`): any string value is accepted, so the
facet stays open-vocabulary and expandable without a code change.

#### Scenario: Off-convention course value passes

- **WHEN** a recipe declares `course: [sauce]`, a value outside the documented `main`/`side`/`dessert`/`breakfast` convention
- **THEN** validation passes — no controlled-vocabulary check rejects the value

#### Scenario: Absent or empty course blocks the build

- **WHEN** a recipe omits `course` or sets `course: []`
- **THEN** the build exits non-zero and reports the missing required `course` for that recipe

#### Scenario: Non-string course blocks the build

- **WHEN** a recipe declares `course: 3` (neither a string nor an array of strings)
- **THEN** the build exits non-zero and reports the invalid `course` value, recipe, and field

## REMOVED Requirements

### Requirement: Warn-only soft validation

**Reason**: The fields this requirement made warn-only-when-missing (`protein`,
`time_total`, `ingredients_key`, `pairs_with`, `perishable_ingredients`, `course`) are
now system-consumed required fields under the blunt-uniform contract — their absence is a
hard failure, not a warning. Nothing is left in a "recommended-but-optional, warn-on-miss"
tier: a field is either required-and-present (hard-fail on miss) or free-form `extra`
(no presence expectation, never warned).

**Migration**: Recipes must carry every required field in its explicit empty form
(`null`/`[]`) rather than relying on absence-with-warning. The operator backfill brings
the existing corpus into compliance before the hard-fail is enabled; thereafter a missing
required field fails the build and the write tool instead of printing a warning. Free-form
fields (e.g. `meal_preppable`) pass silently with no warning.
