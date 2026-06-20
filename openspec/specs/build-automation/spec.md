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

The system SHALL provide `.github/workflows/build-indexes.yml` that triggers on push to `recipes/**`, runs validation, regenerates `_indexes/recipes.json`, commits it back to the branch, and publishes the index to `DATA_KV`. The reusable workflow SHALL declare `CLOUDFLARE_API_TOKEN` as an optional secret so the thin data-repo caller can pass it via `secrets: inherit`. The data-repo thin caller SHALL use `secrets: inherit`. The workflow SHALL request `contents: write` permission. It SHALL NOT trigger on ready-to-eat changes or regenerate a ready-to-eat index — ready-to-eat is per-tenant state read directly from `users/<username>/ready_to_eat.toml`, not an indexed shared catalog.

#### Scenario: Push regenerates, commits, and publishes to KV

- **WHEN** a push modifies a file under `recipes/**`
- **THEN** the Action validates the corpus, regenerates the recipe index file, commits any changes back to the branch, and publishes the index to `DATA_KV`

#### Scenario: Validation failure fails the Action

- **WHEN** a pushed change fails a hard-fail validation rule
- **THEN** the Action fails and does not commit regenerated indexes or publish to KV

#### Scenario: KV publish uses namespace id from wrangler.jsonc

- **WHEN** the build-indexes Action publishes to KV
- **THEN** it reads the `DATA_KV` namespace id from the data repo's `wrangler.jsonc` without requiring any separately-configured input or secret

### Requirement: CI loop guard

The Action's regeneration commit SHALL include `[skip ci]` in its message so that committing regenerated indexes does not re-trigger the workflow.

#### Scenario: Regen commit does not re-trigger

- **WHEN** the Action commits regenerated indexes
- **THEN** the commit message contains `[skip ci]` and the workflow does not run again for that commit

#### Scenario: No-op when indexes are unchanged

- **WHEN** the Action regenerates indexes and the output is byte-identical to what is already committed
- **THEN** no commit is created

### Requirement: Reusable plugin-build workflow produces an operator-baked bundle artifact

The system SHALL provide a reusable (`on: workflow_call`) GitHub workflow that builds the grocery-agent plugin bundle with a **caller-supplied connector URL** and publishes it as a **downloadable artifact**. The workflow SHALL run **without secrets**, SHALL build from a caller-supplied code ref (default `main`), and SHALL NOT modify the committed marketplace bundle. A thin caller in an operator's private data repo SHALL invoke it with the operator's Worker URL.

#### Scenario: Operator builds their bundle from the data repo

- **WHEN** an operator runs their thin `build-plugin` caller with their Worker URL
- **THEN** a plugin bundle with that URL baked into `.mcp.json` is produced and published as a downloadable artifact in the run, with no secrets used and the committed marketplace bundle unchanged

#### Scenario: Bundle is packaged in the accepted upload layout

- **WHEN** the workflow packages the bundle
- **THEN** the archive contains `.claude-plugin/`, `.mcp.json`, and `skills/` at its root — the layout claude.ai accepts for an uploaded plugin file

