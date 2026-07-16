# r2-corpus-store Specification

## Purpose
TBD - created by archiving change r2-recipe-corpus. Update Purpose after archive.
## Requirements
### Requirement: The authored corpus is stored in and served from R2

The Worker SHALL store and serve the authored corpus — `recipes/*.md` and `guidance/**/*.md` — from a bound R2 bucket, through a corpus-store interface offering read, list, and write of markdown objects by path. Recipe and guidance read tools SHALL resolve their content from R2. The corpus-store interface SHALL be the single data-access path for authored content, so the rest of the Worker is agnostic to the backing store (the same role the prior `GitHubClient` interface played). No GitHub App, installation token, or GitHub API call SHALL be on the corpus data path.

#### Scenario: A recipe body resolves from R2

- **WHEN** `read_recipe` is called for a known slug
- **THEN** the Worker reads `recipes/<slug>.md` from R2 and returns its content, with no GitHub request

#### Scenario: Guidance lists and reads from R2

- **WHEN** `list_guidance` / `read_guidance` is called
- **THEN** the Worker lists/reads the `guidance/**` objects from R2

#### Scenario: A corpus write persists to R2

- **WHEN** `create_recipe` / `update_recipe` / `save_guidance` writes content
- **THEN** the validated markdown is persisted as an R2 object, and a single-file write is atomic at the object level

### Requirement: The Worker reconcile projects the index and validates the whole corpus

The recipe index (the D1 `recipes` table) SHALL be projected by the Worker's scheduled reconcile from the R2 corpus, replacing the retired CI build. Each pass SHALL validate every recipe against the shared required-field + vocabulary contract **and** perform the cross-corpus checks (e.g. `pairs_with` slug resolution) that require the whole corpus. A recipe that fails validation SHALL NOT be projected, and the failure SHALL be recorded so it is observable. Projection SHALL be eventual (cron-driven), consistent with the system's accepted eventual-consistency model.

#### Scenario: A valid corpus is projected

- **WHEN** the reconcile runs over a corpus of well-formed recipes
- **THEN** the D1 `recipes` index reflects the corpus, including resolved `pairs_with` references

#### Scenario: An invalid recipe is skipped and recorded

- **WHEN** a recipe in R2 fails the required-field/vocabulary contract (e.g. an off-vocabulary `protein`)
- **THEN** the reconcile does not project that recipe, and records the failure to an observable sink (a `reconcile_errors` record + `/health`), leaving the rest of the index intact

#### Scenario: A dangling pairs_with is caught corpus-wide

- **WHEN** a recipe references a `pairs_with` slug that no longer exists in the corpus
- **THEN** the reconcile's cross-corpus validation flags it (the check the retired CI build performed), since the reconcile holds the whole corpus

### Requirement: Human-direct edits get eventual, surfaced feedback

A corpus edit made outside the Worker (e.g. an S3-compatible client such as `rclone` writing to R2) SHALL be validated by the reconcile, not by CI. When such an edit is invalid, the system SHALL surface the failure through an agent-readable record and operator-visible health/notification, rather than silently dropping it. The system SHALL NOT require a GitHub CI run to validate corpus content.

#### Scenario: A bad direct edit is surfaced, not silent

- **WHEN** an author writes a malformed recipe to R2 with an S3-compatible client
- **THEN** the reconcile skips indexing it and the failure becomes visible (agent-surfaced message + `/health` + optional ntfy), with no reliance on GitHub CI

#### Scenario: A valid direct edit indexes without CI

- **WHEN** an author writes a well-formed recipe edit to R2
- **THEN** the next reconcile projects it into the index, with no GitHub push or CI run involved

