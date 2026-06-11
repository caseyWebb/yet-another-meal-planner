## MODIFIED Requirements

### Requirement: Index regeneration GitHub Action

The system SHALL provide `.github/workflows/build-indexes.yml` that triggers on push to `recipes/**`, runs validation, regenerates the indexes (`_indexes/recipes.json` and `_indexes/components.json`), and commits them back to the branch. The workflow SHALL request `contents: write` permission. It SHALL NOT trigger on ready-to-eat changes or regenerate a ready-to-eat index — ready-to-eat is per-tenant state read directly from `users/<username>/ready_to_eat.toml`, not an indexed shared catalog.

#### Scenario: Push regenerates and commits indexes

- **WHEN** a push modifies a file under `recipes/**`
- **THEN** the Action validates the corpus, regenerates the recipe and components index files, and commits any changes back to the branch

#### Scenario: Validation failure fails the Action

- **WHEN** a pushed change fails a hard-fail validation rule
- **THEN** the Action fails and does not commit regenerated indexes
