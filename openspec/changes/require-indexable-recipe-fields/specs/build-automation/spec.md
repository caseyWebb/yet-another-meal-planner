## ADDED Requirements

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
