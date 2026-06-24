# data-indexing Specification

> **⚠️ SUPERSEDED by `recipe-index` (the `d1-recipe-index` change).** The recipe index
> is now projected into the **D1 `recipes` table**, not written to `_indexes/recipes.json`
> and not published to `DATA_KV` (`index:recipes` is retired, the JSON file deleted). The
> requirements below describing the `_indexes/recipes.json` write and the DATA_KV publish are
> stale and pending a rewrite; the *projection* (objective-only fields, subjective stripped,
> open-vocab `course` normalization, empty-corpus handling) carries over to the D1 rows. See
> `openspec/specs/recipe-index/spec.md`.

## Purpose

Defines the deterministic generation of the `_indexes/*.json` artifacts from `recipes/` and `ready_to_eat/`: the build entry point, the shape of each index, slug derivation, date normalization, and the stability guarantees the Worker and other consumers rely on.
## Requirements
### Requirement: Index build entry point

The system SHALL provide `scripts/build-indexes.mjs`, runnable via an npm script, that reads source data and writes the index artifacts. Its core walk SHALL accept an input directory as a parameter defaulting to `recipes/`, so the same logic can be exercised against a fixtures directory.

#### Scenario: Run against the default corpus

- **WHEN** the build script is run with no input-directory override
- **THEN** it reads from `recipes/` and writes `_indexes/recipes.json`

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

### Requirement: Course field normalization in the index

The index build SHALL normalize a recipe's `course` frontmatter into `_indexes/recipes.json` as a **lowercased, trimmed array of strings**, regardless of whether the source frontmatter declared it as a bare string or as an array. A recipe with no `course` SHALL be projected with an empty `course` array (`[]`), the same default treatment as `pairs_with` / `perishable_ingredients`. The build SHALL NOT validate `course` *values* against any controlled set — it normalizes shape and casing only — so the facet stays open-vocabulary and consistent across recipes that differ only in casing or whitespace.

#### Scenario: Scalar course normalized to an array

- **WHEN** a recipe declares `course: Main`
- **THEN** the indexed value is `course: ["main"]` (lowercased, wrapped in an array)

#### Scenario: Array course is lowercased and trimmed

- **WHEN** a recipe declares `course: ["Main", " Side "]`
- **THEN** the indexed value is `course: ["main", "side"]`

#### Scenario: Absent course defaults to empty array

- **WHEN** a recipe omits `course`
- **THEN** the indexed value carries `course: []` and the build prints no warning and exits successfully

### Requirement: Deterministic output

The system SHALL produce byte-identical index files for unchanged source data across runs and runner environments. Object keys SHALL be sorted, and date-typed frontmatter values (e.g. `last_cooked`, `discovered_at`) SHALL be normalized to `YYYY-MM-DD` strings rather than serialized as datetimes.

#### Scenario: Unchanged corpus produces no diff

- **WHEN** the build script runs twice with no source changes between runs
- **THEN** the second run's output is byte-identical to the first and produces no git diff

#### Scenario: Date fields normalized

- **WHEN** a recipe declares `last_cooked: 2025-04-15`
- **THEN** the indexed value is the string `"2025-04-15"`, not a timezone-shifted datetime

### Requirement: Empty corpus handling

The system SHALL handle an empty `recipes/` directory without error, emitting an empty index object.

#### Scenario: Empty recipes directory

- **WHEN** the build script runs and `recipes/` contains no `.md` files
- **THEN** `recipes.json` is written as `{}` and the script exits successfully

### Requirement: Index build publishes to DATA_KV

After writing `_indexes/recipes.json`, the build script SHALL publish the recipe index to `DATA_KV` under the key `"index:recipes"` when a Cloudflare API token and the `DATA_KV` namespace id are available. The namespace id SHALL be read from the data repo's `wrangler.jsonc` (the `DATA_KV` binding's `id` field) so no additional operator input is required. If the namespace id is absent (e.g. before first deploy has pinned it back), the publish step SHALL warn and skip rather than fail the build.

#### Scenario: Successful publish after index write

- **WHEN** `build-indexes.mjs` runs with `CLOUDFLARE_API_TOKEN` available and `DATA_KV` id present in `wrangler.jsonc`
- **THEN** `DATA_KV["index:recipes"]` is set to the JSON string of the recipe index immediately after `_indexes/recipes.json` is written

#### Scenario: Publish skipped when namespace id absent

- **WHEN** `build-indexes.mjs` runs but `DATA_KV` has no `id` in `wrangler.jsonc` (pre-first-deploy)
- **THEN** the script prints a warning, skips the KV publish, writes `_indexes/recipes.json` as normal, and exits 0

#### Scenario: KV publish is a no-op in check mode

- **WHEN** `build-indexes.mjs` is run with `--check`
- **THEN** no KV write occurs (validation only, no side effects)

