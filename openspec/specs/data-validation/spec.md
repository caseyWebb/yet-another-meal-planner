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
