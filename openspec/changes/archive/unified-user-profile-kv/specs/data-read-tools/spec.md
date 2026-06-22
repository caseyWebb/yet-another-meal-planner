## REMOVED Requirements

### Requirement: read_preferences returns the user's preferences

**Reason**: Subsumed by `read_user_profile()`. Preferences are now part of the KV profile bundle and returned in one call alongside all other profile sections.
**Migration**: Use `read_user_profile()` and access the `preferences` field of the response.

### Requirement: read_taste returns the taste narrative

**Reason**: Subsumed by `read_user_profile()`. Taste is now a field in the KV profile bundle.
**Migration**: Use `read_user_profile()` and access the `taste` field of the response.

### Requirement: read_diet_principles returns the diet narrative

**Reason**: Subsumed by `read_user_profile()`. Diet principles are now a field in the KV profile bundle.
**Migration**: Use `read_user_profile()` and access the `diet_principles` field of the response.

### Requirement: read_kitchen returns the equipment inventory

**Reason**: Subsumed by `read_user_profile()`. Kitchen inventory is now a field in the KV profile bundle.
**Migration**: Use `read_user_profile()` and access the `kitchen` field of the response.

### Requirement: read_staples returns the staples list

**Reason**: Subsumed by `read_user_profile()`. Staples are now a field in the KV profile bundle.
**Migration**: Use `read_user_profile()` and access the `staples` field of the response.

## MODIFIED Requirements

### Requirement: list_recipes reads the index and filters in-worker

The system SHALL provide `list_recipes(filters)` that reads the shared `_indexes/recipes.json` in a single KV call, **joins each entry with the caller's per-tenant overlay** (`rating`, `status` from the `overlay` field of `profile:<username>` in DATA_KV; effective `status` defaults to `draft` when the caller has no overlay row for a slug), **the caller's cooking-log-derived `last_cooked`** (max cook date for the slug from that tenant's `cooking_log.toml` in GitHub), **and the caller's owned-equipment list** (`owned` from the `kitchen` field of `profile:<username>` in DATA_KV, empty when absent), unions the caller's personal (unshared) recipes, and applies filters in the Worker, returning `{ recipes: [{ slug, title, frontmatter }] }` where `frontmatter` reflects the merged objective content + the caller's subjective fields. If the shared `_indexes/recipes.json` is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: Active recipes returned by default, per caller overlay from KV

- **WHEN** `list_recipes({})` is invoked with no `status` filter
- **THEN** only recipes whose **effective status for the caller** is `active` are returned, with overlay read from the caller's KV profile bundle (no GitHub call for overlay)

#### Scenario: Status reflects the caller, not the corpus

- **WHEN** two tenants invoke `list_recipes({ status: "active" })` and they have dispositioned a shared recipe differently
- **THEN** each tenant's result reflects their own overlay status for that recipe (read from their respective KV profile bundles), not a shared/global status

#### Scenario: Personal recipes included

- **WHEN** the caller has personal (unshared) recipes and invokes `list_recipes({})`
- **THEN** the results include the caller's personal recipes alongside shared corpus recipes

#### Scenario: Index missing or malformed

- **WHEN** the shared `_indexes/recipes.json` cannot be read or parsed
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw
