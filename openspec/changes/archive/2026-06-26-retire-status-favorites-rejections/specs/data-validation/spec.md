## MODIFIED Requirements

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

The system SHALL emit warnings, without failing the build, when recommended-but-optional frontmatter fields (e.g. `protein`, `time_total`, `ingredients_key`) are missing or null. Optional arrays such as `pairs_with` / `perishable_ingredients` / `course` SHALL default to empty without warning. The retired `rating` is not a recommended field.

#### Scenario: Missing optional field warns but passes

- **WHEN** a recipe omits `protein` and `time_total` but has a valid `title`
- **THEN** the build prints a warning naming the missing fields and still exits successfully

### Requirement: Ready-to-eat catalog structural validation

The system SHALL validate the per-tenant ready-to-eat catalog's structural shape, requiring each item's `meal` to be one of `breakfast`/`lunch`/`dinner` and `name` to be a non-empty string. It SHALL NOT validate a `status` or `rating` on ready-to-eat items (those are retired in favor of the favorite/reject disposition); a lingering `status`/`rating` is tolerated and ignored.

#### Scenario: Ready-to-eat status/rating are not validated

- **WHEN** a ready-to-eat item carries a stale `status` or `rating`
- **THEN** validation ignores both and checks only `meal` and `name`
