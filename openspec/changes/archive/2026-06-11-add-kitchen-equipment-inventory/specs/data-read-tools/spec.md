## MODIFIED Requirements

### Requirement: list_recipes reads the index and filters in-worker

The system SHALL provide `list_recipes(filters)` that reads the shared `_indexes/recipes.json` in a single call, **joins each entry with the caller's per-tenant overlay** (`rating`, `status` from `overlay.toml`; effective `status` defaults to `draft` when the caller has no overlay row), **the caller's cooking-log-derived `last_cooked`** (max cook date for the slug from that tenant's `cooking_log.toml`), **and the caller's owned-equipment list** (`owned` from `kitchen.toml`, empty when absent), unions the caller's personal (unshared) recipes, and applies filters in the Worker, returning `{ recipes: [{ slug, title, frontmatter }] }` where `frontmatter` reflects the merged objective content + the caller's subjective fields. If the shared `_indexes/recipes.json` is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: Active recipes returned by default, per caller overlay

- **WHEN** `list_recipes({})` is invoked with no `status` filter
- **THEN** only recipes whose **effective status for the caller** is `active` are returned, each with shared content merged with the caller's `rating`/`last_cooked`

#### Scenario: Status reflects the caller, not the corpus

- **WHEN** two tenants invoke `list_recipes({ status: "active" })` and they have dispositioned a shared recipe differently
- **THEN** each tenant's result reflects their own overlay status for that recipe, not a shared/global status

#### Scenario: Personal recipes included

- **WHEN** the caller has personal (unshared) recipes and invokes `list_recipes({})`
- **THEN** the results include the caller's personal recipes alongside shared corpus recipes

#### Scenario: Index missing or malformed

- **WHEN** the shared `_indexes/recipes.json` cannot be read or parsed
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw

### Requirement: list_recipes filter semantics

The system SHALL apply `list_recipes` filters with these semantics: array filters (`dietary`, `season`) match when the recipe contains **ALL** listed values (AND); `status` defaults to `active` and `status: "all"` disables status filtering; `exclude_cooked_within_days` is a caller-supplied number that excludes recipes cooked within that many days; and `not_cooked_since` (a date) admits recipes whose `last_cooked` is `null`. The system SHALL NOT provide a `tags` array filter — keyword/name matching against tags is handled by the `query` text filter (see "list_recipes free-text query filter").

The system SHALL additionally apply a **makeability gate** by default: a recipe whose `requires_equipment` is not a subset of the caller's `owned` (see the kitchen-equipment "Deterministic makeability rule") SHALL be excluded. When the caller's `owned` is empty (or `kitchen.toml` is absent) the gate SHALL be a no-op (every recipe passes). A `include_unmakeable: true` filter SHALL disable the exclusion and instead return unmakeable recipes annotated with `missing_equipment` (the required slugs not in `owned`), so the named-dish enumeration path can surface a named recipe flagged rather than silently dropped. The gate SHALL be ANDed with the other filters and SHALL be a pure function of the recipe's indexed `requires_equipment` and the caller's `owned`.

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

#### Scenario: Unmakeable recipe is excluded by default

- **WHEN** `list_recipes({})` is invoked, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is excluded from the results

#### Scenario: Empty inventory disables the gate

- **WHEN** `list_recipes({})` is invoked and the caller has no `kitchen.toml` (or empty `owned`)
- **THEN** the makeability gate excludes nothing and recipes are returned as if no equipment filter applied

#### Scenario: include_unmakeable surfaces flagged recipes

- **WHEN** `list_recipes({ include_unmakeable: true })` is invoked, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is returned annotated with `missing_equipment: ["pressure-cooker"]` rather than excluded
