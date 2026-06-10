## MODIFIED Requirements

### Requirement: list_recipes filter semantics

The system SHALL apply `list_recipes` filters with these semantics: array filters (`dietary`, `season`) match when the recipe contains **ALL** listed values (AND); `status` defaults to `active` and `status: "all"` disables status filtering; `exclude_cooked_within_days` is a caller-supplied number that excludes recipes cooked within that many days; and `not_cooked_since` (a date) admits recipes whose `last_cooked` is `null`. The system SHALL NOT provide a `tags` array filter — keyword/name matching against tags is handled by the `query` text filter (see "list_recipes free-text query filter").

#### Scenario: Array filter matches all values

- **WHEN** `list_recipes({ dietary: ["gluten-free", "dairy-free"] })` is invoked
- **THEN** only recipes whose `dietary` includes both `gluten-free` AND `dairy-free` are returned

#### Scenario: Status opt-out returns every status

- **WHEN** `list_recipes({ status: "all" })` is invoked
- **THEN** recipes of every status (`active`, `draft`, `rejected`, `archived`) are returned

#### Scenario: Never-cooked recipe passes not_cooked_since

- **WHEN** `list_recipes({ not_cooked_since: "2026-01-01" })` is invoked and a recipe has `last_cooked: null`
- **THEN** that recipe is included in the results

#### Scenario: Recently cooked recipe excluded by window

- **WHEN** `list_recipes({ exclude_cooked_within_days: 14 })` is invoked and a recipe was cooked 3 days ago
- **THEN** that recipe is excluded from the results

#### Scenario: A tags filter is not honored

- **WHEN** `list_recipes({ tags: ["chicken"] })` is invoked (an unknown filter)
- **THEN** the `tags` key is ignored (no tag-based narrowing) and the result is the same as if no `tags` were supplied

### Requirement: list_recipes free-text query filter

The system SHALL support an optional `query` string filter on `list_recipes` that is the single text-search path over a recipe's `title` and `tags`. The query SHALL be tokenized on whitespace and a fixed set of stopwords (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`) SHALL be removed before matching. A recipe matches when **every** remaining token appears, as a case-insensitive substring, in the recipe's `title` or any of its `tags` (token-AND). The `query` filter SHALL be ANDed with the other filters and SHALL be a pure function of the index entry (no I/O). When `query` is absent, empty, or reduces to zero tokens after stopword removal, `list_recipes` SHALL apply no text narrowing. The filter SHALL NOT rank, score, or fuzzy-match — it is a deterministic membership test so that a named dish present in the corpus (in title or tags) cannot be silently omitted.

#### Scenario: Natural phrase returns all genuine matches via title or tags

- **WHEN** `list_recipes({ query: "chicken and rice" })` is invoked and the corpus contains "Chicken and Rice" (tag "rice" absent — "rice" only in the title), plus "Arroz Caldo" and "Galinhada Mineira" (both tagged `chicken` and `rice`)
- **THEN** all three are returned: the connective `and` is dropped as a stopword (so `{chicken, rice}` remain), "Chicken and Rice" matches via its title, and the other two match via tags

#### Scenario: Stopword-only query applies no narrowing

- **WHEN** `list_recipes({ query: "and the" })` is invoked
- **THEN** the query reduces to zero tokens and no text narrowing is applied (same as an absent `query`)

#### Scenario: All content tokens must be present (AND)

- **WHEN** `list_recipes({ query: "chicken rice" })` is invoked
- **THEN** a recipe with neither `chicken` nor `rice` in its title or tags is excluded, and a recipe whose title or tags contain both is included

#### Scenario: Title-only keyword is findable

- **WHEN** `list_recipes({ query: "rice" })` is invoked and a recipe titled "Chicken and Rice" has no `rice` tag
- **THEN** that recipe is included because `query` searches the title, not only tags

#### Scenario: Query composes with structured filters

- **WHEN** `list_recipes({ query: "chicken", status: "active", protein: "chicken" })` is invoked
- **THEN** only active chicken-protein recipes whose title or tags contain `chicken` are returned
