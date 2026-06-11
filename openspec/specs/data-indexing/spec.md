# data-indexing Specification

## Purpose

Defines the deterministic generation of the `_indexes/*.json` artifacts from `recipes/` and `ready_to_eat/`: the build entry point, the shape of each index, slug derivation, date normalization, and the stability guarantees the Worker and other consumers rely on.
## Requirements
### Requirement: Index build entry point

The system SHALL provide `scripts/build-indexes.mjs`, runnable via an npm script, that reads source data and writes the index artifacts. Its core walk SHALL accept an input directory as a parameter defaulting to `recipes/`, so the same logic can be exercised against a fixtures directory.

#### Scenario: Run against the default corpus

- **WHEN** the build script is run with no input-directory override
- **THEN** it reads from `recipes/` and writes `_indexes/recipes.json` and `_indexes/components.json`

#### Scenario: Run against a fixtures directory

- **WHEN** the core walk is invoked with an input directory of `tests/fixtures/`
- **THEN** it produces indexes derived from the fixture recipes without reading the real `recipes/` directory

### Requirement: Recipe index shape

The system SHALL emit `_indexes/recipes.json` (in the shared corpus repository) as a JSON object keyed by recipe slug, where each value is that recipe's **objective** frontmatter plus an injected `slug` field. The shared index SHALL NOT contain the per-tenant subjective fields `rating`, `last_cooked`, or `status` — those live in each tenant's overlay and are merged at read time, not baked into the shared index. The slug SHALL be derived from the recipe filename with the `.md` extension removed.

#### Scenario: Recipe aggregated by slug

- **WHEN** `recipes/lemon-garlic-chicken.md` is indexed
- **THEN** `recipes.json` contains a key `"lemon-garlic-chicken"` whose value includes that file's objective frontmatter fields and `"slug": "lemon-garlic-chicken"`

#### Scenario: Subjective fields excluded from the shared index

- **WHEN** a shared recipe is indexed
- **THEN** the indexed value carries no `rating`, `last_cooked`, or `status` field, because those are per-tenant overlay merged at read time

#### Scenario: All recipes included regardless of any tenant's disposition

- **WHEN** the shared corpus is indexed
- **THEN** every recipe in the shared corpus appears in `recipes.json`, since per-tenant disposition (status) is not part of the shared index

### Requirement: Components index shape

The system SHALL emit `_indexes/components.json` as a JSON object keyed by component slug, where each value lists `produced_by` (recipe slugs whose `produces_components` include that component) and `used_by` (recipe slugs whose `uses_components` include it).

#### Scenario: Adjacency built from component references

- **WHEN** recipe `salmon-with-rice` declares `produces_components: [cooked-rice]` and recipe `kimchi-fried-rice` declares `uses_components: [cooked-rice]`
- **THEN** `components.json` contains `"cooked-rice": { "produced_by": ["salmon-with-rice"], "used_by": ["kimchi-fried-rice"] }`

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

