## ADDED Requirements

### Requirement: list_recipes free-text query filter

The system SHALL support an optional `query` string filter on `list_recipes` that matches a recipe when **every** whitespace-separated token in `query` appears, as a case-insensitive substring, in the recipe's `title` or any of its `tags`. The `query` filter SHALL be ANDed with all other filters (`status`, `protein`, `tags`, etc.) and SHALL be a pure function of the index entry (no additional I/O). When `query` is absent or empty, `list_recipes` SHALL behave identically to its prior behavior. The filter SHALL NOT rank, score, or fuzzy-match — it is a deterministic membership test so that a named dish present in the corpus cannot be silently omitted.

#### Scenario: Exact-title named dish is returned

- **WHEN** `list_recipes({ query: "chicken rice" })` is invoked and a recipe titled "Chicken and Rice" exists with `status: active`
- **THEN** that recipe is included in the results (every query token — `chicken`, `rice` — appears in its title)

#### Scenario: All query tokens must be present (AND)

- **WHEN** `list_recipes({ query: "chicken rice" })` is invoked
- **THEN** a recipe titled "Lemon Chicken" (missing the `rice` token in title and tags) is excluded, while a recipe tagged `["chicken", "rice"]` is included

#### Scenario: Tag match counts

- **WHEN** `list_recipes({ query: "comfort" })` is invoked and a recipe has `tags` including `comfort-food`
- **THEN** that recipe is included (the token `comfort` is a substring of the `comfort-food` tag)

#### Scenario: Query composes with other filters

- **WHEN** `list_recipes({ query: "chicken", status: "active", protein: "chicken" })` is invoked
- **THEN** only active chicken-protein recipes whose title or tags contain `chicken` are returned

#### Scenario: Absent query preserves prior behavior

- **WHEN** `list_recipes({ status: "active" })` is invoked with no `query`
- **THEN** the result is identical to the pre-change behavior (every active recipe, unfiltered by text)
