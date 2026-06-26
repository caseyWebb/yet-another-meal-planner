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

The system SHALL require every recipe to define a non-empty `title` (string). `status` is **not** a required or validated field. Absence of `title` SHALL be a hard failure.

#### Scenario: Missing title blocks the build

- **WHEN** a recipe omits `title` or sets it empty
- **THEN** the build exits non-zero and reports the missing required field

#### Scenario: Status is not required

- **WHEN** a recipe omits `status` (or carries any `status` value)
- **THEN** the build validates it fine — `status` is neither required nor enum-checked

### Requirement: Warn-only soft validation

The system SHALL emit warnings, without failing the build, when recommended-but-optional frontmatter fields (e.g. `protein`, `time_total`, `ingredients_key`) are missing or null. Optional arrays such as `pairs_with` / `perishable_ingredients` / `course` SHALL default to empty without warning.

#### Scenario: Missing optional field warns but passes

- **WHEN** a recipe omits `protein` and `time_total` but has a valid `title`
- **THEN** the build prints a warning naming the missing fields and still exits successfully

#### Scenario: Absent pairing and course fields do not warn

- **WHEN** a recipe omits `pairs_with` and `course`
- **THEN** the build treats both as empty, prints no warning for either, and exits successfully

#### Scenario: Absent perishable_ingredients does not warn

- **WHEN** a recipe omits `perishable_ingredients`
- **THEN** the build treats it as empty, prints no warning, and exits successfully

### Requirement: Parse-check scope for data TOMLs

Per-tenant and shared-corpus data (pantry, preferences, aliases, stockup, feeds, SKU cache, etc.) is now stored in D1 and is no longer present as `.toml` files in the data repo. The system SHALL parse-check any remaining tracked `.toml` files in the data repo for validity. The `storage_guidance/*.md` files are prose and are not parse-checked as data (they are validated only for existence, like other curated markdown).

#### Scenario: Valid-but-sparse data TOML passes

- **WHEN** any remaining tracked `.toml` file in the data repo parses as valid TOML but omits optional fields
- **THEN** the build does not fail on that file

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

The system SHALL validate recipe frontmatter `protein` and `cuisine` against controlled allowed-value sets (coarse buckets — e.g. `fish` rather than `salmon`) so variety reasoning is reliable. This validation SHALL run in **both** the Node index-build validator (`scripts/build-indexes.mjs`) and the Worker's write-time structural subset (`src/validate.ts`), drawing the allowed sets from a single shared definition so the two cannot drift. A `protein` or `cuisine` value **present** but outside its allowed set SHALL be a hard failure naming the offending value, recipe, and field — Node: non-zero exit; Worker: a structured `validation_failed` error that aborts the commit. The Worker recipe write path SHALL normalize a `protein`/`cuisine` whose value is the literal string `none` (or the empty string) to **absent** before persisting, since "no protein focus" is a legitimate state and absence is warn-only — such a value is therefore written as absent rather than rejected. Absence of `protein` or `cuisine` SHALL retain the existing warn-only treatment, not a hard failure. The allowed sets SHALL be documented in `docs/SCHEMAS.md`.

#### Scenario: Out-of-vocabulary protein blocks the build

- **WHEN** a recipe declares `protein: salmon` and `salmon` is not in the allowed protein set (e.g. it collapses to `fish`)
- **THEN** the build exits non-zero and reports the invalid value, recipe, and field

#### Scenario: Out-of-vocabulary protein is rejected at write time

- **WHEN** `create_recipe` or `update_recipe` persists a recipe with `protein: shrimp` (not in the allowed set; the bucket is `shellfish`)
- **THEN** the Worker returns a structured `validation_failed` error naming the field and value, and makes no commit

#### Scenario: A `none` protein is normalized to absent at write time

- **WHEN** `create_recipe` or `update_recipe` persists a recipe with `protein: none` (or an empty string)
- **THEN** the recipe is written with `protein` absent (not rejected), and the build later treats it as the warn-only missing-field case

#### Scenario: In-vocabulary value passes

- **WHEN** a recipe declares `protein: fish` and `cuisine: filipino`, both in their allowed sets
- **THEN** validation passes for those fields

#### Scenario: Absent dimension warns but does not fail

- **WHEN** a recipe omits `protein`
- **THEN** the build warns (per the existing soft rule) and still exits successfully

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

The system SHALL validate the shape of a recipe's `course` frontmatter — when present, it MUST be a string or an array of strings — and SHALL hard-fail the build (non-zero exit) naming the offending value, recipe, and field when it is not. The system SHALL NOT validate `course` *values* against any controlled set (unlike `protein` / `cuisine`): any string value is accepted, so the facet stays open-vocabulary and expandable without a code change. The Worker's structural pre-commit subset SHALL apply the same shape-only check (parallel to `pairs_with` / `domain`).

#### Scenario: Off-convention course value passes

- **WHEN** a recipe declares `course: [sauce]`, a value outside the documented `main`/`side`/`dessert`/`breakfast` convention
- **THEN** validation passes — no controlled-vocabulary check rejects the value

#### Scenario: Non-string course blocks the build

- **WHEN** a recipe declares `course: 3` (a number, neither a string nor an array of strings)
- **THEN** the build exits non-zero and reports the invalid `course` value, recipe, and field

#### Scenario: Array-of-strings course passes

- **WHEN** a recipe declares `course: [main, side]`
- **THEN** validation passes

### Requirement: Single source of truth for controlled vocabularies

The controlled vocabularies for recipe variety and makeability dimensions — `PROTEIN_VOCAB`, `CUISINE_VOCAB`, and `EQUIPMENT_VOCAB` — SHALL be defined exactly once, in a shared module imported by both the Worker write-time validator (`src/validate.ts`, and the kitchen check) and the Node index-build validator (`scripts/build-indexes.mjs`). Neither validator SHALL define its own copy of any of these sets. This guarantees the write-time gate and the build-time gate can never disagree about what a legal value is. If a platform constraint makes a shared import infeasible and a copy is unavoidable, an automated test SHALL assert the copies are byte-for-byte equal, failing CI on any drift.

#### Scenario: One definition feeds both validators

- **WHEN** a value is added to or removed from a controlled vocabulary
- **THEN** the change is made in the single shared module and both the Worker validator and the Node build validator observe it without any second edit

#### Scenario: Drift is impossible (or caught)

- **WHEN** the Worker and build validators are exercised against the same off-vocabulary recipe value
- **THEN** both reject it identically — because they resolve the same shared set (or, if a copy exists, the parity test fails CI before they can disagree)

