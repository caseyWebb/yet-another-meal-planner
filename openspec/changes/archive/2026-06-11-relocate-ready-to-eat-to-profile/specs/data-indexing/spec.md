## MODIFIED Requirements

### Requirement: Index build entry point

The system SHALL provide `scripts/build-indexes.mjs`, runnable via an npm script, that reads source data and writes the index artifacts. Its core walk SHALL accept an input directory as a parameter defaulting to `recipes/`, so the same logic can be exercised against a fixtures directory.

#### Scenario: Run against the default corpus

- **WHEN** the build script is run with no input-directory override
- **THEN** it reads from `recipes/` and writes `_indexes/recipes.json` and `_indexes/components.json`

#### Scenario: Run against a fixtures directory

- **WHEN** the core walk is invoked with an input directory of `tests/fixtures/`
- **THEN** it produces indexes derived from the fixture recipes without reading the real `recipes/` directory

## REMOVED Requirements

### Requirement: Ready-to-eat index shape

**Reason**: Ready-to-eat moved from shared root catalogs to a single per-tenant file (`users/<username>/ready_to_eat.toml`). A per-member list is small and is read directly from TOML by the Worker (as pantry/overlay/grocery_list already are), so the aggregate `_indexes/ready_to_eat.json` index serves no purpose.

**Migration**: None required — there is no existing ready-to-eat data. Consumers SHALL read `users/<username>/ready_to_eat.toml` directly instead of `_indexes/ready_to_eat.json`. The index file is no longer emitted.
