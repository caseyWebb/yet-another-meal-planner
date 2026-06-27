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

### Requirement: The build validates recipes and projects the recipe index only

`scripts/build-indexes.mjs` SHALL validate recipe markdown and project the recipe index into the D1 `recipes` table, and SHALL NOT validate or parse any other corpus artifact. The store-registry, discovery-inbox, discovery-source, and whole-repo TOML parse-checks SHALL be removed from the build; those validations run at Worker write time in the corresponding tools. With no non-recipe data left in GitHub, the build has nothing else to check, and `smol-toml` is no longer used by the build. The build SHALL NOT publish the index to KV and SHALL NOT commit an `_indexes/recipes.json` index blob — the index is the D1 table, projected on every recipe push (see the `recipe-index` capability for the projection contract).

The system SHALL provide a reusable index-regeneration GitHub workflow (`.github/workflows/data-build-indexes.yml`) that triggers on push to `recipes/**`, runs the recipe validation, and projects the validated set into D1. The reusable workflow SHALL declare `CLOUDFLARE_API_TOKEN` as an optional secret so the thin data-repo caller can pass it via `secrets: inherit`. It SHALL NOT trigger on ready-to-eat changes or regenerate a ready-to-eat index — ready-to-eat is per-tenant state, not an indexed shared catalog.

#### Scenario: Build only touches recipes

- **WHEN** the build runs
- **THEN** it validates `recipes/*.md` and projects the D1 `recipes` table, performing no store/discovery/TOML validation and no KV `index:recipes` write

#### Scenario: Shared-corpus validation is write-time

- **WHEN** a store, discovery source, or inbox candidate is written
- **THEN** it is validated by the Worker write tool at write time (a structured error on failure), not by a later build

#### Scenario: Validation failure fails the Action

- **WHEN** a pushed change fails a hard-fail recipe-validation rule
- **THEN** the Action fails and does not project the D1 table

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

### Requirement: Strict recipe validation gates the data-repo main branch

The data repo's CI SHALL run the strict recipe validator (`build-indexes.mjs --check`,
enforcing the required-field contract) as a **required status check** on `main`, so a
non-compliant recipe that lands on `main` — necessarily a hand-authored (Obsidian /
native-git) commit, since the agent's write path validates before committing — fails CI.
The existing deploy gate (deploy runs only on green CI) SHALL therefore block a deploy
that carries a contract violation until it is fixed. The system SHALL NOT introduce a
required-pull-request branch protection on the data repo's `main`: the agent commits
recipe writes **directly to `main`** through the commit engine, whose shared write-time
validator makes it incapable of producing a violation, so required-PR protection would
only handcuff the agent without adding a guarantee. CI on `main` is the backstop for human
edits.

#### Scenario: A hand-authored violation fails CI and blocks deploy

- **WHEN** an Obsidian commit lands a recipe on `main` missing a required field
- **THEN** the strict validator check fails, the build is red, and the deploy (gated on green CI) does not run until the recipe is brought into compliance

#### Scenario: The agent commits directly to main without a PR

- **WHEN** the agent's `create_recipe` write commits a compliant recipe
- **THEN** it commits directly to `main` (no pull request required), having already passed the shared write-time validator

#### Scenario: No required-PR protection on the data repo

- **WHEN** the data repo's branch protection is configured for this change
- **THEN** `main` requires the strict-validation status check but does NOT require a pull request before merging (preserving the agent's direct-to-main write path)

