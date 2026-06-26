## MODIFIED Requirements

### Requirement: read_pantry with partial filter support

The system SHALL provide `read_pantry(filter)` returning `{ items: [...] }`, supporting the `category` and `prepared_only` filters deterministically. The `stale_only` filter SHALL return a structured `unsupported` error, because freshness is an LLM-judged, prompt-resolved concern (it depends on storage, whether a package was opened, and visual inspection — none of which is in the repo) rather than a function the tool can compute. There is no shelf-life table backing it: the previously-reserved `ingredients.toml` has been removed, superseded by the curated `guidance/ingredient_storage/` tree, which informs put-away advice rather than gating staleness.

#### Scenario: Filter by category

- **WHEN** `read_pantry({ category: "freezer" })` is invoked
- **THEN** only pantry items in the `freezer` category are returned

#### Scenario: Prepared-only filter

- **WHEN** `read_pantry({ prepared_only: true })` is invoked
- **THEN** only items with a non-null `prepared_from` are returned

#### Scenario: Staleness not supported by the tool

- **WHEN** `read_pantry({ stale_only: true })` is invoked
- **THEN** the tool returns a structured `unsupported` error explaining that freshness is judged conversationally, not computed by the tool
