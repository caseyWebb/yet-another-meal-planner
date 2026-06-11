## MODIFIED Requirements

### Requirement: Hard-fail validation rules

The system SHALL fail the build (non-zero exit) when any of the following structural problems is detected: a recipe's YAML frontmatter does not parse, any `.toml` file does not parse, a recipe `status` value is outside the allowed enum (`active`, `draft`, `rejected`, `archived`), two recipes resolve to the same slug, a `uses_components` / `produces_components` reference points at a component no recipe produces or uses such that the reference cannot resolve, a `pairs_with` entry names a slug that does not resolve to a recipe in the corpus, or a `standalone` value is present but is not a boolean.

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

#### Scenario: Unresolved pairs_with reference blocks the build

- **WHEN** a recipe declares `pairs_with: [garlic-bread]` and no recipe in the corpus resolves to the slug `garlic-bread`
- **THEN** the build exits non-zero and reports the unresolved `pairs_with` reference and the offending recipe

#### Scenario: Non-boolean standalone blocks the build

- **WHEN** a recipe declares `standalone: yes-please` (a non-boolean value)
- **THEN** the build exits non-zero and reports the invalid `standalone` value and file

#### Scenario: Unparseable TOML blocks the build

- **WHEN** any tracked `.toml` file fails to parse
- **THEN** the build exits non-zero and reports the offending file

### Requirement: Warn-only soft validation

The system SHALL emit warnings, without failing the build, when recommended-but-optional frontmatter fields (e.g. `protein`, `time_total`, `rating`, `ingredients_key`) are missing or null. Optional arrays such as `uses_components` / `produces_components` / `pairs_with` SHALL default to empty without warning, and the optional boolean `standalone` SHALL default to unset without warning.

#### Scenario: Missing optional field warns but passes

- **WHEN** a recipe omits `protein` and `time_total` but has a valid `title` and `status`
- **THEN** the build prints a warning naming the missing fields and still exits successfully

#### Scenario: Absent pairing fields do not warn

- **WHEN** a recipe omits `pairs_with` and `standalone`
- **THEN** the build treats `pairs_with` as empty and `standalone` as unset, prints no warning for either, and exits successfully
