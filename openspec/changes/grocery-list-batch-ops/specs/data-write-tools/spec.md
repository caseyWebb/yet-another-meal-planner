## MODIFIED Requirements

### Requirement: Repo-data write tools

The system SHALL provide repo-data write tools that persist via the atomic commit engine, **routing each write to the repository that owns the data category** (see "Writes are routed by data category"): `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, the user-curated `update_*` tools (preferences, taste, diet principles, substitutions, aliases), overlay and note write tools, and `commit_changes`. `commit_changes` SHALL accept a batch of repo updates and persist them in one commit per target repository with a single summarizing message. `commit_changes` SHALL accept a `grocery_list_ops` field — an array of `{ op: "add" | "update" | "remove", item?, name? }` operations against the caller's grocery list — applied as part of the same atomic commit as the batch's other domains. No tool in this capability SHALL write a Kroger cart or call an external service.

Ready-to-eat is **per-tenant personal state**: `add_draft_ready_to_eat` and `update_ready_to_eat` SHALL read and write the caller's `users/<username>/ready_to_eat.toml`, never a shared root catalog. Each ready-to-eat item SHALL be keyed by a generated `slug` (derived from its `name`, unique within the caller's file); `update_ready_to_eat` SHALL address items by `slug`. Items SHALL support an optional `rating` field. `add_draft_ready_to_eat` SHALL accept an optional `status` (default `draft`) so that an item the member explicitly names — e.g. during onboarding — can be added directly as `active` rather than as a draft to be dispositioned.

`grocery_list_ops` SHALL reuse the grocery-list merge semantics: an `add` for a name already present (including one added earlier in the same batch) MERGES rather than duplicating. An `update` or `remove` for a name not present SHALL be reported as a conflict in the tool result rather than aborting the commit (partial-apply), consistent with the other `*_ops` fields.

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

#### Scenario: Grocery-list ops land in the same commit as the rest of the batch

- **WHEN** `commit_changes` is called with `grocery_list_ops` alongside `meal_plan_ops` and `pantry_operations`
- **THEN** the grocery-list mutations and the other domains' mutations are persisted in a single commit, and the result summary reports what was applied per domain

#### Scenario: A missing-name grocery op is a reported conflict, not an aborted commit

- **WHEN** `grocery_list_ops` contains a `remove` (or `update`) for a name absent from the list
- **THEN** that op is reported as a conflict in the result and the remaining ops (and the rest of the batch) are still committed
