## ADDED Requirements

### Requirement: list_recipes reads the index and filters in-worker

The system SHALL provide `list_recipes(filters)` that reads `_indexes/recipes.json` in a single call and applies filters in the Worker, returning `{ recipes: [{ slug, title, frontmatter }] }`. If `_indexes/recipes.json` is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: Active recipes returned by default

- **WHEN** `list_recipes({})` is invoked with no `status` filter
- **THEN** only recipes with `status: active` are returned, each with its slug, title, and frontmatter

#### Scenario: Index missing or malformed

- **WHEN** `_indexes/recipes.json` cannot be read or parsed
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw

### Requirement: list_recipes filter semantics

The system SHALL apply `list_recipes` filters with these semantics: array filters (`tags`, `dietary`, `season`) match when the recipe contains **ALL** listed values (AND); `status` defaults to `active` and `status: "all"` disables status filtering; `exclude_cooked_within_days` is a caller-supplied number that excludes recipes cooked within that many days; and `not_cooked_since` (a date) admits recipes whose `last_cooked` is `null`.

#### Scenario: Array filter matches all values

- **WHEN** `list_recipes({ tags: ["weeknight", "beef"] })` is invoked
- **THEN** only recipes whose `tags` include both `weeknight` AND `beef` are returned

#### Scenario: Status opt-out returns every status

- **WHEN** `list_recipes({ status: "all" })` is invoked
- **THEN** recipes of every status (`active`, `draft`, `rejected`, `archived`) are returned

#### Scenario: Never-cooked recipe passes not_cooked_since

- **WHEN** `list_recipes({ not_cooked_since: "2026-01-01" })` is invoked and a recipe has `last_cooked: null`
- **THEN** that recipe is included in the results

#### Scenario: Recently cooked recipe excluded by window

- **WHEN** `list_recipes({ exclude_cooked_within_days: 14 })` is invoked and a recipe was cooked 3 days ago
- **THEN** that recipe is excluded from the results

### Requirement: read_recipe returns frontmatter and body

The system SHALL provide `read_recipe(slug)` returning `{ slug, frontmatter, body }`, where frontmatter is the parsed YAML and body is the markdown after the frontmatter fence. The return SHALL NOT include a `last_modified` field. An unknown slug SHALL return a structured `not_found` error.

#### Scenario: Existing recipe read in full

- **WHEN** `read_recipe("american-chop-suey")` is invoked
- **THEN** it returns the slug, the parsed frontmatter object, and the markdown body, with no `last_modified` field

#### Scenario: Unknown slug

- **WHEN** `read_recipe("does-not-exist")` is invoked
- **THEN** it returns a structured `not_found` error naming the slug

### Requirement: read_pantry with partial filter support

The system SHALL provide `read_pantry(filter)` returning `{ items: [...] }`, supporting the `category` and `prepared_only` filters deterministically. The `stale_only` filter SHALL return a structured `unsupported` error until shelf-life data (`ingredients.toml`) exists, rather than approximating staleness.

#### Scenario: Filter by category

- **WHEN** `read_pantry({ category: "freezer" })` is invoked
- **THEN** only pantry items in the `freezer` category are returned

#### Scenario: Prepared-only filter

- **WHEN** `read_pantry({ prepared_only: true })` is invoked
- **THEN** only items with a non-null `prepared_from` are returned

#### Scenario: Staleness not yet supported

- **WHEN** `read_pantry({ stale_only: true })` is invoked
- **THEN** the tool returns a structured `unsupported` error explaining that staleness requires `ingredients.toml` (a later change)

### Requirement: Config and narrative read tools

The system SHALL provide `read_preferences()` returning the parsed contents of `preferences.toml`, `read_taste()` returning the raw markdown of `taste.md`, and `read_diet_principles()` returning the raw markdown of `diet_principles.md`.

#### Scenario: Preferences returned parsed

- **WHEN** `read_preferences()` is invoked
- **THEN** it returns `preferences.toml` parsed into a structured object

#### Scenario: Narrative files returned raw

- **WHEN** `read_taste()` or `read_diet_principles()` is invoked
- **THEN** it returns the file's markdown content as text

### Requirement: Empty-data resilience

Read tools SHALL return clean empty results for sources that currently hold no data (files that are entirely comments, empty catalogs, or absent optional sections) rather than erroring. A TOML file with no `items` SHALL yield `{ items: [] }`.

#### Scenario: Empty pantry yields empty items

- **WHEN** `read_pantry({})` is invoked against a `pantry.toml` that contains only comments
- **THEN** it returns `{ items: [] }` without error
