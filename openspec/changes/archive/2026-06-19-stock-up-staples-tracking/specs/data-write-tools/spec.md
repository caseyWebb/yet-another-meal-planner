## MODIFIED Requirements

### Requirement: Repo-data write tools

The system SHALL provide repo-data write tools that persist via the atomic commit engine, **routing each write to the repository that owns the data category** (see "Writes are routed by data category"): `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, `update_stockup`, `update_staples`, the user-curated `update_*` tools (preferences, taste, diet principles, substitutions, aliases), overlay and note write tools, and `commit_changes`. `commit_changes` SHALL accept a batch of repo updates and persist them in one commit per target repository with a single summarizing message. No tool in this capability SHALL write a Kroger cart or call an external service.

Ready-to-eat is **per-tenant personal state**: `add_draft_ready_to_eat` and `update_ready_to_eat` SHALL read and write the caller's `users/<username>/ready_to_eat.toml`, never a shared root catalog. Each ready-to-eat item SHALL be keyed by a generated `slug` (derived from its `name`, unique within the caller's file); `update_ready_to_eat` SHALL address items by `slug`. Items SHALL support an optional `rating` field. `add_draft_ready_to_eat` SHALL accept an optional `status` (default `draft`) so that an item the member explicitly names — e.g. during onboarding — can be added directly as `active` rather than as a draft to be dispositioned.

The bulk-buy watchlist is likewise **per-tenant personal state**: `update_stockup` SHALL add items to the caller's `users/<username>/stockup.toml`, never a shared file. It SHALL be **add-only with dedup by normalized item `name`** (re-adding an existing name merges rather than duplicating, existing entries untouched), mirroring the add-only `update_discovery_sources`. It SHALL accept per item a required `name` and optional `unit`, `typical_purchase`, and `notes`, plus an optional top-level `freezer_capacity_estimate`. The price-threshold fields (`baseline_price`, `buy_at_or_below`) SHALL be **optional** — they are advisory (no Worker logic gates on them) and are not required to seed a watchlist. `update_stockup` SHALL return `{ added, commit_sha }` and SHALL make no commit when nothing new is added.

The staples list is **per-tenant personal state**: `update_staples` SHALL read and write the caller's `users/<username>/staples.toml`. It SHALL accept `add` (array of `{ name, perishable? }`) and `remove` (array of name strings) operations. Adds SHALL be deduped by normalized `name` — re-adding an existing name is a no-op. Removes SHALL match by normalized `name` and silently succeed if the name is not present. `update_staples` SHALL return `{ added, removed, commit_sha }` and SHALL make no commit when nothing changed.

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

#### Scenario: Staples add is deduped

- **WHEN** `update_staples({ add: [{ name: "olive oil" }] })` is called and olive oil is already in the caller's staples
- **THEN** no duplicate is written and `{ added: 0, removed: 0, commit_sha: null }` is returned

#### Scenario: Staples remove by name

- **WHEN** `update_staples({ remove: ["olive oil"] })` is called and olive oil is in the caller's staples
- **THEN** olive oil is removed from `users/<username>/staples.toml` and `{ added: 0, removed: 1, commit_sha: "<sha>" }` is returned

#### Scenario: Staples remove of absent name is silent

- **WHEN** `update_staples({ remove: ["fish sauce"] })` is called and fish sauce is not in the caller's staples
- **THEN** no error is returned and `{ added: 0, removed: 0, commit_sha: null }` is returned
