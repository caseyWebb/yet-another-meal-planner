## ADDED Requirements

### Requirement: log_cooked appends a cooking event to D1

The system SHALL provide a `log_cooked` tool that appends one cooking event to the caller's `cooking_log` in D1 and returns without a `commit_sha`. It SHALL validate the entry (ISO `date` defaulting to today; `type` ∈ {`recipe`, `ready_to_eat`, `ad_hoc`}; a `recipe` entry's slug resolved against the `recipes` table; a non-recipe entry requires `name`). For a recipe entry it SHALL also remove that recipe from the caller's meal plan, preserving the side effect previously performed by `commit_changes`. It SHALL NOT write a recipe's `last_cooked` (that value is derived by query).

#### Scenario: Cooking event is appended without a commit

- **WHEN** `log_cooked` is called with a valid entry
- **THEN** a `cooking_log` row is inserted in D1, the tool returns `{ logged }` with no `commit_sha`, and (for a recipe entry) the recipe is cleared from the meal plan

## MODIFIED Requirements

### Requirement: commit_changes drops cooking_log_entries

`commit_changes` SHALL NOT accept a `cooking_log_entries` field — the cooking log no longer lives in GitHub, and cooking events are appended via `log_cooked`. (The broader retirement of `commit_changes` is a separate change; this one removes only the orphaned field whose backing file is gone.)

#### Scenario: commit_changes rejects cooking_log_entries

- **WHEN** `commit_changes` is called with a `cooking_log_entries` field
- **THEN** the field is not part of the tool's input schema, and the caller is expected to use `log_cooked` instead
