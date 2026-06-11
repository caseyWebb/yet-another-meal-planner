# data-validation Specification

## Purpose

Defines the validation rule set applied during the index build: which problems hard-fail the build versus warn, the required recipe frontmatter fields, and the parse-check-only scope for non-index data TOMLs.
## Requirements
### Requirement: Hard-fail validation rules

The system SHALL fail the build (non-zero exit) when any of the following structural problems is detected: a recipe's YAML frontmatter does not parse, any `.toml` file does not parse, a recipe `status` value is outside the allowed enum (`active`, `draft`, `rejected`, `archived`), two recipes resolve to the same slug, or a `uses_components` / `produces_components` reference points at a component no recipe produces or uses such that the reference cannot resolve.

#### Scenario: Malformed frontmatter blocks the build

- **WHEN** a recipe file contains YAML frontmatter that fails to parse
- **THEN** the build exits non-zero and reports the offending file

#### Scenario: Invalid status enum blocks the build

- **WHEN** a recipe declares `status: in-progress`
- **THEN** the build exits non-zero and reports the invalid status value and file

#### Scenario: Duplicate slug blocks the build

- **WHEN** two recipe files derive the same slug
- **THEN** the build exits non-zero and names the conflicting files

#### Scenario: Unresolved component reference blocks the build

- **WHEN** a recipe declares `uses_components: [cooked-rice]` and no recipe declares `produces_components: [cooked-rice]`
- **THEN** the build exits non-zero and reports the unresolved component reference

#### Scenario: Unparseable TOML blocks the build

- **WHEN** any tracked `.toml` file fails to parse
- **THEN** the build exits non-zero and reports the offending file

### Requirement: Required frontmatter fields

The system SHALL require every recipe to define a non-empty `title` (string) and a `status` within the allowed enum. Absence of either SHALL be a hard failure.

#### Scenario: Missing title blocks the build

- **WHEN** a recipe omits `title` or sets it empty
- **THEN** the build exits non-zero and reports the missing required field

### Requirement: Warn-only soft validation

The system SHALL emit warnings, without failing the build, when recommended-but-optional frontmatter fields (e.g. `protein`, `time_total`, `rating`, `ingredients_key`) are missing or null. Optional arrays such as `uses_components` / `produces_components` SHALL default to empty without warning.

#### Scenario: Missing optional field warns but passes

- **WHEN** a recipe omits `protein` and `time_total` but has a valid `title` and `status`
- **THEN** the build prints a warning naming the missing fields and still exits successfully

### Requirement: Parse-check scope for data TOMLs

The system SHALL parse-check every tracked `.toml` file for validity, but SHALL NOT enforce deep schema validation on non-index data files (`pantry.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `stockup.toml`, `feeds.toml`, `ingredients.toml`, `skus/kroger.toml`) beyond their being parseable.

#### Scenario: Valid-but-sparse data TOML passes

- **WHEN** `pantry.toml` parses as valid TOML but omits fields the Worker would later expect
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

The system SHALL parse-check `cooking_log.toml` and `meal_plan.toml` during the index build and SHALL hard-fail (non-zero exit) when: either file does not parse as TOML; a `cooking_log` entry omits `date` or `type`, or has a `type` outside the allowed enum (`recipe`, `ready_to_eat`, `ad_hoc`); a `cooking_log` entry with `type = recipe` omits `recipe` or references a slug no recipe resolves to; a non-`recipe` entry omits `name`; a `meal_plan` `[[planned]]` entry omits `recipe` or references an unresolved slug; or any `date` / `planned_for` value is not a valid ISO date.

#### Scenario: Unknown cooking-log type blocks the build

- **WHEN** a `cooking_log.toml` entry declares `type = "snack"`
- **THEN** the build exits non-zero and reports the invalid `type` and entry

#### Scenario: Recipe entry with unresolved slug blocks the build

- **WHEN** a `type = recipe` entry references a slug no recipe file produces
- **THEN** the build exits non-zero and names the unresolved slug

#### Scenario: Planned entry with unresolved slug blocks the build

- **WHEN** a `meal_plan.toml` `[[planned]]` entry references a slug no recipe produces
- **THEN** the build exits non-zero and names the unresolved slug

#### Scenario: Malformed date blocks the build

- **WHEN** a `cooking_log` `date` or `meal_plan` `planned_for` is not a valid ISO date
- **THEN** the build exits non-zero and reports the offending value

### Requirement: last_cooked consistency soft-check

The system SHALL emit a warning, without failing the build, when a recipe's frontmatter `last_cooked` does not equal the maximum `cooking_log.toml` `date` among `type = recipe` entries for that slug. A recipe with no cooking-log entries SHALL NOT warn regardless of its `last_cooked` value, so an empty or partial log does not flag the existing corpus.

#### Scenario: Drift between last_cooked and the log warns

- **WHEN** a recipe's `last_cooked` is earlier than its newest `cooking_log` entry
- **THEN** the build prints a warning naming the recipe and both dates, and still exits successfully

#### Scenario: Recipe absent from the log does not warn

- **WHEN** a recipe has a non-null `last_cooked` but no `cooking_log` entries
- **THEN** the build does not warn about that recipe

### Requirement: Controlled vocabulary for variety dimensions

The system SHALL validate recipe frontmatter `protein` and `cuisine` against controlled allowed-value sets (coarse buckets — e.g. `fish` rather than `salmon`) so variety reasoning is reliable. A `protein` or `cuisine` value **present** but outside its allowed set SHALL be a hard build failure naming the offending value, recipe, and field. Absence of `protein` or `cuisine` SHALL retain the existing warn-only treatment, not a hard failure. The allowed sets SHALL be defined in the validator (alongside the `status` enum) and documented in `docs/SCHEMAS.md`.

#### Scenario: Out-of-vocabulary protein blocks the build

- **WHEN** a recipe declares `protein: salmon` and `salmon` is not in the allowed protein set (e.g. it collapses to `fish`)
- **THEN** the build exits non-zero and reports the invalid value, recipe, and field

#### Scenario: In-vocabulary value passes

- **WHEN** a recipe declares `protein: fish` and `cuisine: filipino`, both in their allowed sets
- **THEN** validation passes for those fields

#### Scenario: Absent dimension warns but does not fail

- **WHEN** a recipe omits `protein`
- **THEN** the build warns (per the existing soft rule) and still exits successfully

### Requirement: Ready-to-eat catalog structural validation

The system SHALL structurally validate a member's `users/<username>/ready_to_eat.toml` — both in the Node validator (`scripts/build-indexes.mjs`, when run over a data checkout) and in the Worker's write-time structural subset (`src/validate.ts`). Validation SHALL hard-fail (Node: non-zero exit; Worker: structured error, no commit) when: the file does not parse as TOML; an item omits `name` or `slug`; an item's `meal` is outside the enum (`breakfast`, `lunch`, `dinner`); an item's `status` is outside the enum (`active`, `draft`, `rejected`); an item's `rating` is present but not an integer in the rating range; or two items in the file share the same `slug`.

#### Scenario: Unknown meal blocks the write

- **WHEN** a `ready_to_eat.toml` item declares `meal = "brunch"`
- **THEN** validation hard-fails and reports the invalid `meal` and the offending item

#### Scenario: Duplicate slug blocks the write

- **WHEN** two items in a member's `ready_to_eat.toml` share the same `slug`
- **THEN** validation hard-fails and names the duplicated `slug`

#### Scenario: Well-formed catalog passes

- **WHEN** every item carries a `name`, a unique `slug`, a valid `meal`, a valid `status`, and any `rating` is an integer in range
- **THEN** validation passes for the catalog

