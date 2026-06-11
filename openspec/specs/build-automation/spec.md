# build-automation Specification

## Purpose

Defines where and when validation and index regeneration run: the local validation-only pre-commit hook and the GitHub Action that regenerates indexes on push, including the CI-loop guard that prevents the regeneration commit from re-triggering the workflow.
## Requirements
### Requirement: Pre-commit validation hook

The system SHALL provide a `pre-commit` hook that runs validation only and never regenerates or stages index files. A failing validation SHALL abort the commit. The hook SHALL be installed on a fresh clone via an npm `prepare` script that points `core.hooksPath` at the committed hooks directory.

#### Scenario: Malformed commit is blocked locally

- **WHEN** a developer commits a recipe whose frontmatter fails validation
- **THEN** the pre-commit hook exits non-zero and the commit is aborted before reaching the remote

#### Scenario: Hook does not mutate the working tree

- **WHEN** the pre-commit hook runs during a commit
- **THEN** it performs validation only and leaves `_indexes/` and all other files unmodified and unstaged

#### Scenario: Hook installed via npm prepare

- **WHEN** `npm install` runs on a fresh clone
- **THEN** the `prepare` script configures `core.hooksPath` to the committed hooks directory so the pre-commit hook is active

### Requirement: Index regeneration GitHub Action

The system SHALL provide `.github/workflows/build-indexes.yml` that triggers on push to `recipes/**`, runs validation, regenerates the indexes (`_indexes/recipes.json` and `_indexes/components.json`), and commits them back to the branch. The workflow SHALL request `contents: write` permission. It SHALL NOT trigger on ready-to-eat changes or regenerate a ready-to-eat index — ready-to-eat is per-tenant state read directly from `users/<username>/ready_to_eat.toml`, not an indexed shared catalog.

#### Scenario: Push regenerates and commits indexes

- **WHEN** a push modifies a file under `recipes/**`
- **THEN** the Action validates the corpus, regenerates the recipe and components index files, and commits any changes back to the branch

#### Scenario: Validation failure fails the Action

- **WHEN** a pushed change fails a hard-fail validation rule
- **THEN** the Action fails and does not commit regenerated indexes

### Requirement: CI loop guard

The Action's regeneration commit SHALL include `[skip ci]` in its message so that committing regenerated indexes does not re-trigger the workflow.

#### Scenario: Regen commit does not re-trigger

- **WHEN** the Action commits regenerated indexes
- **THEN** the commit message contains `[skip ci]` and the workflow does not run again for that commit

#### Scenario: No-op when indexes are unchanged

- **WHEN** the Action regenerates indexes and the output is byte-identical to what is already committed
- **THEN** no commit is created

