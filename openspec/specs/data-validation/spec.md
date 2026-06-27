# data-validation Specification

## Purpose

Defines the validation rule set applied during the index build: which problems hard-fail the build versus warn, the required recipe frontmatter fields, and the parse-check-only scope for non-index data TOMLs.
## Requirements
### Requirement: Hard-fail validation rules

The system SHALL fail the build (non-zero exit) when any of the following structural problems is detected: a recipe's YAML frontmatter does not parse, any `.toml` file does not parse, two recipes resolve to the same slug, a `pairs_with` entry names a slug that does not resolve to a recipe in the corpus, or a `perishable_ingredients` value is present but is not an array of strings. A recipe `status` is **no longer validated** — the per-tenant `status` lifecycle is retired, so any lingering frontmatter `status` is tolerated and ignored (stripped from the index, never enforced). (`course` shape validation is defined in "Course field shape validation"; `standalone` is no longer a recognized field and is neither validated nor projected.)

#### Scenario: Malformed frontmatter blocks the build

- **WHEN** a recipe file contains YAML frontmatter that fails to parse
- **THEN** the build exits non-zero and reports the offending file

#### Scenario: A lingering frontmatter status does not block the build

- **WHEN** an old recipe file still carries `status: draft` (or any value)
- **THEN** the build does not validate or fail on it; the field is stripped from the index and ignored

#### Scenario: Duplicate slug blocks the build

- **WHEN** two recipe files derive the same slug
- **THEN** the build exits non-zero and names the conflicting files

#### Scenario: Unresolved pairs_with reference blocks the build

- **WHEN** a recipe declares `pairs_with: [garlic-bread]` and no recipe in the corpus resolves to the slug `garlic-bread`
- **THEN** the build exits non-zero and reports the unresolved `pairs_with` reference and the offending recipe

#### Scenario: Non-array perishable_ingredients blocks the build

- **WHEN** a recipe declares `perishable_ingredients: cilantro` (a bare string, not an array of strings)
- **THEN** the build exits non-zero and reports the invalid `perishable_ingredients` value and file

#### Scenario: Unparseable TOML blocks the build

- **WHEN** any tracked `.toml` file fails to parse
- **THEN** the build exits non-zero and reports the offending file

#### Scenario: A lingering standalone value is ignored, not failed

- **WHEN** a recipe still declares `standalone: yes-please` (a now-retired field, any value)
- **THEN** the build does not fail on it — `standalone` is no longer recognized, validated, or projected into the index

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

### Requirement: Parse-check scope for data TOMLs

The system SHALL parse-check every tracked `.toml` file for validity, but SHALL NOT enforce deep schema validation on non-index data files (`pantry.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `stockup.toml`, `feeds.toml`, `skus/kroger.toml`) beyond their being parseable. The `guidance/**/*.md` files (across all domain subtrees — `guidance/ingredient_storage/`, `guidance/cooking_techniques/`, and `guidance/purchasing/`) are prose and are not parse-checked as data (they are validated only for existence, like other curated markdown).

#### Scenario: Valid-but-sparse data TOML passes

- **WHEN** `pantry.toml` parses as valid TOML but omits fields the Worker would later expect
- **THEN** the build validation passes it (deep schema validation is not enforced on non-index data files)

#### Scenario: Guidance prose is existence-checked, not parsed as data

- **WHEN** a `guidance/purchasing/*.md` file (or any `guidance/<domain>/*.md`) is present
- **THEN** validation treats it as curated prose (existence only) and does not parse-check its body as structured data

### Requirement: Required recipe body sections

The system SHALL fail the build (non-zero exit) when a recipe body does not contain both an `## Ingredients` H2 section and an `## Instructions` H2 section. Additional H2 sections (e.g. `## Notes`) SHALL be permitted and SHALL NOT cause failure. This guarantees the structural contract that downstream site generation relies on to locate the ingredient and step lists.

#### Scenario: Missing Ingredients section blocks the build

- **WHEN** a recipe body omits the `## Ingredients` section
- **THEN** the build exits non-zero and reports the offending file and missing section

#### Scenario: Missing Instructions section blocks the build

- **WHEN** a recipe body omits the `## Instructions` section
- **THEN** the build exits non-zero and reports the offending file and missing section

#### Scenario: Extra sections are allowed

- **WHEN** a recipe body contains `## Ingredients`, `## Instructions`, and an additional `## Notes` section
- **THEN** validation passes for that recipe

### Requirement: Cooking-log and meal-plan structural validation

The cooking log and meal plan SHALL be validated at write time by the Worker's `log_cooked` and `update_meal_plan` tools (D1 storage — not `.toml` files). The Worker SHALL enforce: a `cooking_log` entry requires `date` and `type` (∈ `recipe`/`ready_to_eat`/`ad_hoc`); a `type = recipe` entry requires `recipe` resolved against the D1 `recipes` table; a non-`recipe` entry requires `name`; a `meal_plan` row requires `recipe` resolved against `recipes`; a `sides` value when present MUST be an array of strings (free-text, not slug-resolved); and all `date`/`planned_for` values MUST be valid ISO dates. The index build SHALL NOT parse-check these data sources (they are D1, not files in the repo).

#### Scenario: Unknown cooking-log type is rejected at write

- **WHEN** `log_cooked` is called with `type: "snack"`
- **THEN** the Worker returns a structured `validation_failed` error and nothing is written

#### Scenario: Recipe entry with unresolved slug is rejected at write

- **WHEN** `log_cooked` is called with `type: "recipe"` and a slug not in the D1 `recipes` table
- **THEN** the Worker returns a structured `not_found` error and nothing is written

#### Scenario: Free-text sides on a planned row are not slug-resolved

- **WHEN** `update_meal_plan` adds a row with `sides: ["roasted broccoli"]` and "roasted broccoli" resolves to no recipe slug
- **THEN** the write succeeds — `sides` is free-text, validated as an array of strings only

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

### Requirement: Ready-to-eat catalog structural validation

The system SHALL validate the per-tenant ready-to-eat catalog's structural shape, requiring each item's `meal` to be one of `breakfast`/`lunch`/`dinner` and `name` to be a non-empty string. It SHALL NOT validate a `status` or `rating` on ready-to-eat items (those are retired in favor of the favorite/reject disposition); a lingering `status`/`rating` is tolerated and ignored.

#### Scenario: Ready-to-eat status/rating are not validated

- **WHEN** a ready-to-eat item carries a stale `status` or `rating`
- **THEN** validation ignores both and checks only `meal` and `name`

### Requirement: Controlled vocabulary for required equipment

The system SHALL validate recipe frontmatter `requires_equipment` against a controlled allowed-value set (`EQUIPMENT_VOCAB`) of slugs naming gear a dish is genuinely impossible without (the "no recipe-preserving workaround exists" test — deliberately small). A `requires_equipment` entry **present** but outside the allowed set SHALL be a hard failure naming the offending value, recipe, and field. Absence of `requires_equipment` (or an empty array) SHALL NOT be a failure or a warning. This validation SHALL run in **both** the Node index-build validator (`scripts/build-indexes.mjs`) and the Worker's write-time structural subset (`src/validate.ts`), drawing `EQUIPMENT_VOCAB` from the same shared definition as the kitchen-inventory check — so an off-vocabulary slug on a recipe write is rejected at the write boundary (structured error, no commit) rather than only post-push at build time. Cross-reference and index-level checks (which need the whole corpus) remain the build's job; only the vocabulary subset is enforced in the Worker.

#### Scenario: Out-of-vocabulary equipment blocks the build

- **WHEN** a recipe declares `requires_equipment: ["panini-press"]` and `panini-press` is not in `EQUIPMENT_VOCAB`
- **THEN** the build exits non-zero and names the offending value, recipe, and field

#### Scenario: Out-of-vocabulary equipment is rejected at write time

- **WHEN** `create_recipe` or `update_recipe` persists a recipe with `requires_equipment: ["air-fryer"]` and `air-fryer` is not in `EQUIPMENT_VOCAB`
- **THEN** the Worker returns a structured `validation_failed` error naming the offending slug, and makes no commit

#### Scenario: In-vocabulary equipment passes

- **WHEN** a recipe declares `requires_equipment: ["pressure-cooker", "blender"]`, both in `EQUIPMENT_VOCAB`
- **THEN** the build accepts the recipe and carries the array into the index

#### Scenario: Absent equipment requirement passes silently

- **WHEN** a recipe omits `requires_equipment`
- **THEN** the build neither fails nor warns and treats the recipe as makeable by everyone

### Requirement: Kitchen inventory structural validation

Kitchen inventory is stored in D1 (`kitchen_equipment` table) and validated at write time by the Worker's `update_kitchen` tool. The Worker's write-time structural subset (`src/validate.ts`) SHALL hard-fail with a structured error when an `owned` entry is a slug outside `EQUIPMENT_VOCAB`. A member with no kitchen rows on record is valid (unknown inventory). The Node index-build validator does not have access to per-tenant D1 state and does not validate kitchen inventory.

#### Scenario: Off-vocabulary owned slug fails at write

- **WHEN** `update_kitchen` is called with an `owned` entry not in `EQUIPMENT_VOCAB`
- **THEN** the Worker returns a structured error and makes no write

#### Scenario: Absent kitchen inventory is valid

- **WHEN** a member has no kitchen equipment rows in D1
- **THEN** the system treats it as an unknown inventory (no validation failure)

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

### Requirement: Single source of truth for controlled vocabularies

The controlled vocabularies for recipe variety and makeability dimensions — `PROTEIN_VOCAB`, `CUISINE_VOCAB`, and `EQUIPMENT_VOCAB` — SHALL be defined exactly once, in a shared module imported by both the Worker write-time validator (`src/validate.ts`, and the kitchen check) and the Node index-build validator (`scripts/build-indexes.mjs`). Neither validator SHALL define its own copy of any of these sets. This guarantees the write-time gate and the build-time gate can never disagree about what a legal value is. If a platform constraint makes a shared import infeasible and a copy is unavoidable, an automated test SHALL assert the copies are byte-for-byte equal, failing CI on any drift.

#### Scenario: One definition feeds both validators

- **WHEN** a value is added to or removed from a controlled vocabulary
- **THEN** the change is made in the single shared module and both the Worker validator and the Node build validator observe it without any second edit

#### Scenario: Drift is impossible (or caught)

- **WHEN** the Worker and build validators are exercised against the same off-vocabulary recipe value
- **THEN** both reject it identically — because they resolve the same shared set (or, if a copy exists, the parity test fails CI before they can disagree)

