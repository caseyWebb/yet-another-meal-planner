## MODIFIED Requirements

### Requirement: Repo-data write tools

The system SHALL provide repo-data write tools that persist via the atomic commit engine, **routing each write to the repository that owns the data category** (see "Writes are routed by data category"): `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, `update_stockup`, the user-curated `update_*` tools (preferences, taste, diet principles, substitutions, aliases), overlay and note write tools, and `commit_changes`. `commit_changes` SHALL accept a batch of repo updates and persist them in one commit per target repository with a single summarizing message. No tool in this capability SHALL write a Kroger cart or call an external service.

`update_pantry` and the `pantry_operations` field of `commit_changes` SHALL treat an `add` operation as an **upsert**: if an item with the same name (case-insensitive) already exists in the pantry, the incoming fields SHALL be merged onto the existing entry (preserving the original `added_at`, refreshing `last_verified_at` to today, and overlaying all other supplied fields) rather than appending a duplicate. The `AppliedOp` result for an upserted add SHALL include `merged: true`; a fresh insert omits `merged` (or sets it `false`). If no matching entry exists, the item is appended as before.

Ready-to-eat is **per-tenant personal state**: `add_draft_ready_to_eat` and `update_ready_to_eat` SHALL read and write the caller's `users/<username>/ready_to_eat.toml`, never a shared root catalog. Each ready-to-eat item SHALL be keyed by a generated `slug` (derived from its `name`, unique within the caller's file); `update_ready_to_eat` SHALL address items by `slug`. Items SHALL support an optional `rating` field. `add_draft_ready_to_eat` SHALL accept an optional `status` (default `draft`) so that an item the member explicitly names — e.g. during onboarding — can be added directly as `active` rather than as a draft to be dispositioned.

The bulk-buy watchlist is likewise **per-tenant personal state**: `update_stockup` SHALL add items to the caller's `users/<username>/stockup.toml`, never a shared file. It SHALL be **add-only with dedup by normalized item `name`** (re-adding an existing name merges rather than duplicating, existing entries untouched), mirroring the add-only `update_discovery_sources`. It SHALL accept per item a required `name` and optional `unit`, `typical_purchase`, and `notes`, plus an optional top-level `freezer_capacity_estimate`. The price-threshold fields (`baseline_price`, `buy_at_or_below`) SHALL be **optional** — they are advisory (no Worker logic gates on them) and are not required to seed a watchlist. `update_stockup` SHALL return `{ added, commit_sha }` and SHALL make no commit when nothing new is added.

#### Scenario: Single update persists with confirmation

- **WHEN** `update_recipe(slug, updates)` is called with a valid slug and objective frontmatter fields
- **THEN** the shared recipe content is merged, committed to the shared corpus repo, and the tool returns `{ slug, updated_fields }`

#### Scenario: Subjective edit writes the caller's overlay, not shared content

- **WHEN** a tenant rates a shared recipe or marks it cooked
- **THEN** the change is written to that tenant's overlay in their per-tenant repo, and the shared recipe content is not modified

#### Scenario: Ready-to-eat write targets the caller's per-tenant catalog

- **WHEN** `add_draft_ready_to_eat` or `update_ready_to_eat` is called
- **THEN** the change is written to the caller's `users/<username>/ready_to_eat.toml`, keyed by the item's generated `slug`, and no shared root catalog is touched

#### Scenario: Onboarding adds an active item directly

- **WHEN** `add_draft_ready_to_eat` is called with `status = "active"` for an item the member named
- **THEN** the item is added to the caller's catalog as `active` (not `draft`) with a generated `slug`

#### Scenario: Stockup write targets the caller's watchlist with dedup

- **WHEN** `update_stockup` is called with bulk-buy items (no price thresholds)
- **THEN** the items are added to the caller's `users/<username>/stockup.toml`, deduped by normalized `name`, with `baseline_price`/`buy_at_or_below` absent, and the tool returns `{ added, commit_sha }`

#### Scenario: Unknown target is structured, not thrown

- **WHEN** `update_ready_to_eat` is called with a `slug` that no item in the caller's catalog resolves to
- **THEN** the tool returns a structured error rather than throwing

#### Scenario: Grocery-list ops land in the same commit as the rest of the batch

- **WHEN** `commit_changes` is called with `grocery_list_ops` alongside `meal_plan_ops` and `pantry_operations`
- **THEN** the grocery-list mutations and the other domains' mutations are persisted in a single commit, and the result summary reports what was applied per domain

#### Scenario: A missing-name grocery op is a reported conflict, not an aborted commit

- **WHEN** `grocery_list_ops` contains a `remove` (or `update`) for a name absent from the list
- **THEN** that op is reported as a conflict in the result and the remaining ops (and the rest of the batch) are still committed

#### Scenario: Pantry add for a new item inserts it

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "eggs", quantity: "12", category: "fridge" } }` and no item named "eggs" exists
- **THEN** a new entry is appended to the pantry and the result includes `{ op: "add", name: "eggs" }` without a `merged` flag

#### Scenario: Pantry add for an existing item merges, not duplicates

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "olive oil", quantity: "low" } }` and an item named "olive oil" already exists
- **THEN** the existing entry's `quantity` is updated to "low", `last_verified_at` is refreshed to today, `added_at` is unchanged, no duplicate row is created, and the result includes `{ op: "add", name: "olive oil", merged: true }`

#### Scenario: Pantry upsert is case-insensitive

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "Olive Oil" } }` and an item named "olive oil" already exists
- **THEN** the existing entry is updated (not duplicated) and `merged: true` is returned
