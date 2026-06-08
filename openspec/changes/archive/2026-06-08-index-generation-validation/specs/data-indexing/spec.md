## ADDED Requirements

### Requirement: Index build entry point

The system SHALL provide `scripts/build-indexes.mjs`, runnable via an npm script, that reads source data and writes the index artifacts. Its core walk SHALL accept an input directory as a parameter defaulting to `recipes/`, so the same logic can be exercised against a fixtures directory.

#### Scenario: Run against the default corpus

- **WHEN** the build script is run with no input-directory override
- **THEN** it reads from `recipes/` and `ready_to_eat/` and writes `_indexes/recipes.json`, `_indexes/components.json`, and `_indexes/ready_to_eat.json`

#### Scenario: Run against a fixtures directory

- **WHEN** the core walk is invoked with an input directory of `tests/fixtures/`
- **THEN** it produces indexes derived from the fixture recipes without reading the real `recipes/` directory

### Requirement: Recipe index shape

The system SHALL emit `_indexes/recipes.json` as a JSON object keyed by recipe slug, where each value is that recipe's parsed frontmatter plus an injected `slug` field. The slug SHALL be derived from the recipe filename with the `.md` extension removed.

#### Scenario: Recipe aggregated by slug

- **WHEN** `recipes/lemon-garlic-chicken.md` is indexed
- **THEN** `recipes.json` contains a key `"lemon-garlic-chicken"` whose value includes that file's frontmatter fields and `"slug": "lemon-garlic-chicken"`

#### Scenario: All statuses included

- **WHEN** a recipe has `status: draft` or `status: rejected`
- **THEN** it still appears in `recipes.json` with its `status` field preserved, so consumers can filter per query

### Requirement: Components index shape

The system SHALL emit `_indexes/components.json` as a JSON object keyed by component slug, where each value lists `produced_by` (recipe slugs whose `produces_components` include that component) and `used_by` (recipe slugs whose `uses_components` include it).

#### Scenario: Adjacency built from component references

- **WHEN** recipe `salmon-with-rice` declares `produces_components: [cooked-rice]` and recipe `kimchi-fried-rice` declares `uses_components: [cooked-rice]`
- **THEN** `components.json` contains `"cooked-rice": { "produced_by": ["salmon-with-rice"], "used_by": ["kimchi-fried-rice"] }`

### Requirement: Ready-to-eat index shape

The system SHALL emit `_indexes/ready_to_eat.json` as a JSON object keyed by meal (`breakfast`, `lunch`, `dinner`), each carrying the meal's `items` array and its `variety_rules`. All item statuses SHALL be preserved.

#### Scenario: Catalogs aggregated by meal

- **WHEN** `ready_to_eat/dinner.toml` defines items and `variety_rules`
- **THEN** `ready_to_eat.json` contains a `"dinner"` key with both the `items` array and the `variety_rules` object

### Requirement: Deterministic output

The system SHALL produce byte-identical index files for unchanged source data across runs and runner environments. Object keys SHALL be sorted, and date-typed frontmatter values (e.g. `last_cooked`, `discovered_at`) SHALL be normalized to `YYYY-MM-DD` strings rather than serialized as datetimes.

#### Scenario: Unchanged corpus produces no diff

- **WHEN** the build script runs twice with no source changes between runs
- **THEN** the second run's output is byte-identical to the first and produces no git diff

#### Scenario: Date fields normalized

- **WHEN** a recipe declares `last_cooked: 2025-04-15`
- **THEN** the indexed value is the string `"2025-04-15"`, not a timezone-shifted datetime

### Requirement: Empty corpus handling

The system SHALL handle an empty `recipes/` directory without error, emitting empty index objects.

#### Scenario: Empty recipes directory

- **WHEN** the build script runs and `recipes/` contains no `.md` files
- **THEN** `recipes.json` and `components.json` are written as `{}` and the script exits successfully
