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

The system SHALL provide `scripts/build-indexes.mjs`, runnable via an npm script, that reads `recipes/` source data and **projects** the recipe index into the D1 `recipes` table (replacing it wholesale in one transaction — `DELETE` + batched `INSERT`). Its core walk SHALL accept an input directory as a parameter defaulting to `recipes/`, so the same logic can be exercised against a fixtures directory. The build also writes `_indexes/components.json` for the static recipe site only (`scripts/build-site.mjs`); it does NOT write a standalone `_indexes/recipes.json` for Worker consumption.

#### Scenario: Run against the default corpus

- **WHEN** the build script is run with no input-directory override
- **THEN** it reads from `recipes/` and projects the recipe index into the D1 `recipes` table

#### Scenario: Run against a fixtures directory

- **WHEN** the core walk is invoked with an input directory of `tests/fixtures/`
- **THEN** it produces indexes derived from the fixture recipes without reading the real `recipes/` directory

### Requirement: Recipe index shape

The system SHALL project each recipe into a row in the D1 `recipes` table, where each row carries that recipe's **objective** frontmatter plus a `slug` column. The shared index SHALL NOT contain the per-tenant subjective fields `favorite`, `reject`, or `last_cooked` — those live in each tenant's D1 `overlay` and `cooking_log` and are merged at read time. The slug SHALL be derived from the recipe filename with the `.md` extension removed.

#### Scenario: Recipe projected into D1 by slug

- **WHEN** `recipes/lemon-garlic-chicken.md` is indexed
- **THEN** the D1 `recipes` table contains a row with `slug = "lemon-garlic-chicken"` carrying that file's objective frontmatter fields

#### Scenario: Subjective fields excluded from the shared index

- **WHEN** a shared recipe is indexed
- **THEN** the D1 row carries no `favorite`, `reject`, or `last_cooked` field, because those are per-tenant and merged at read time

#### Scenario: All recipes included regardless of any tenant's disposition

- **WHEN** the shared corpus is indexed
- **THEN** every recipe in the shared corpus appears in the D1 `recipes` table; per-tenant disposition is not part of the shared index

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

The system SHALL produce idempotent D1 projections for unchanged source data across runs — the same set of rows inserted in the same transaction. Date-typed frontmatter values (e.g. `discovered_at`) SHALL be normalized to `YYYY-MM-DD` strings before insertion.

#### Scenario: Unchanged corpus produces an idempotent projection

- **WHEN** the build script runs twice with no source changes between runs
- **THEN** the resulting D1 `recipes` table rows are identical and the second run writes the same data as the first

#### Scenario: Date fields normalized

- **WHEN** a recipe declares `discovered_at: 2025-04-15`
- **THEN** the projected value is the string `"2025-04-15"`, not a timezone-shifted datetime

### Requirement: Empty corpus handling

The system SHALL handle an empty `recipes/` directory without error, projecting zero rows into D1.

#### Scenario: Empty recipes directory

- **WHEN** the build script runs and `recipes/` contains no `.md` files
- **THEN** the D1 `recipes` table is left empty (or cleared) and the script exits successfully

### Requirement: Index build projects into D1

After validating recipes, the build script SHALL project the recipe index into the D1 `recipes` table via the Cloudflare D1 REST API when `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and a `DB` `database_id` are available. The projection is a wholesale replace: `DELETE FROM recipes` + batched `INSERT` in one transaction, so the table always reflects the current corpus. The `database_id` SHALL be read from the data repo's `wrangler.jsonc` (the `DB` binding's `database_id` field). If the `database_id` is absent (e.g. before the first deploy has pinned it back), the projection step SHALL warn and skip rather than fail the build. `DATA_KV` and `index:recipes` are retired; the Worker reads the recipe index from D1 only.

#### Scenario: Successful projection into D1

- **WHEN** `build-indexes.mjs` runs with `CLOUDFLARE_API_TOKEN` available and `DB database_id` present in `wrangler.jsonc`
- **THEN** the D1 `recipes` table is replaced with the current corpus's objective rows in one transaction

#### Scenario: Projection skipped when database_id absent

- **WHEN** `build-indexes.mjs` runs but `DB` has no `database_id` in `wrangler.jsonc` (pre-first-deploy)
- **THEN** the script prints a warning, skips the D1 projection, validates recipes as normal, and exits 0

#### Scenario: D1 projection is a no-op in check mode

- **WHEN** `build-indexes.mjs` is run with `--check`
- **THEN** no D1 write occurs (validation only, no side effects)

