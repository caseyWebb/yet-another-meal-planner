## MODIFIED Requirements

### Requirement: Repo-data write tools

The system SHALL provide repo-data write tools that persist via the atomic commit engine, **routing each write to the repository that owns the data category** (see "Writes are routed by data category"): `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, the user-curated `update_*` tools (preferences, taste, diet principles, substitutions, aliases), overlay and note write tools, and `commit_changes`. `commit_changes` SHALL accept a batch of repo updates and persist them in one commit per target repository with a single summarizing message. No tool in this capability SHALL write a Kroger cart or call an external service.

Ready-to-eat is **per-tenant personal state**: `add_draft_ready_to_eat` and `update_ready_to_eat` SHALL read and write the caller's `users/<username>/ready_to_eat.toml`, never a shared root catalog. Each ready-to-eat item SHALL be keyed by a generated `slug` (derived from its `name`, unique within the caller's file); `update_ready_to_eat` SHALL address items by `slug`. Items SHALL support an optional `rating` field. `add_draft_ready_to_eat` SHALL accept an optional `status` (default `draft`) so that an item the member explicitly names — e.g. during onboarding — can be added directly as `active` rather than as a draft to be dispositioned.

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

#### Scenario: Unknown target is structured, not thrown

- **WHEN** `update_ready_to_eat` is called with a `slug` that no item in the caller's catalog resolves to
- **THEN** the tool returns a structured error rather than throwing
