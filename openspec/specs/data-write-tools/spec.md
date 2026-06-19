# data-write-tools Specification

## Purpose
TBD - created by archiving change git-write-tools. Update Purpose after archive.
## Requirements
### Requirement: Atomic batched commit via the Git Data API

The system SHALL persist all repo writes through a single atomic commit built with GitHub's Git Data API — create blobs/tree, create a commit whose parent is the read base, then update the ref — and SHALL NOT write files through sequential per-file Contents-API commits. All writes target the single data repository; a batch of changes from one tool call SHALL land as one commit there and MAY span both shared root files and the caller's `users/<username>/` subtree. The commit engine SHALL authenticate with a GitHub App installation token scoped to the data repository and SHALL surface failures as structured errors per the `mcp-server` convention.

#### Scenario: Multiple file changes land as one commit

- **WHEN** a write tool stages changes to two or more files in a single call
- **THEN** the engine builds one tree and one commit and updates the data repo's ref once, producing a single commit containing all changed files

#### Scenario: Concurrent second writer is retried

- **WHEN** the data repo's ref has advanced since the read base (e.g. the index-build Action committed, or another member's write landed) and the `update ref` is rejected as non-fast-forward
- **THEN** the engine re-reads the current base, replays the same changeset onto it, and retries the commit rather than failing or force-updating

#### Scenario: Write failure is structured

- **WHEN** the Git Data API is unreachable or rejects the write after retries are exhausted
- **THEN** the tool returns a structured `upstream_unavailable` error and does not throw an unhandled exception

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

### Requirement: meal_plan_ops carries open-world sides

`commit_changes` `meal_plan_ops` SHALL accept an optional `sides` array of free-text open-world side names on an `add` operation, persisting it onto the upserted `[[planned]]` row alongside `recipe` and `planned_for`. An `add` for a recipe already present in the plan SHALL merge `sides` onto the existing row (consistent with the upsert-by-slug semantics for `planned_for`). The `sides` value SHALL be written verbatim (free text, not slug-resolved); a `remove` op SHALL drop the row and its `sides` together. No other domain or external service is touched by this field.

#### Scenario: Add op persists open-world sides on the planned row

- **WHEN** `commit_changes` is called with a `meal_plan_ops` `add` of `{ recipe: "miso-salmon", planned_for: "2026-06-14", sides: ["roasted broccoli"] }`
- **THEN** the written `[[planned]]` row carries `recipe = "miso-salmon"`, `planned_for = "2026-06-14"`, and `sides = ["roasted broccoli"]`, in the same commit as the rest of the batch

#### Scenario: Re-add merges sides onto the existing row

- **WHEN** a `[[planned]]` row for `miso-salmon` already exists and a later `add` supplies `sides`
- **THEN** the `sides` are merged onto that existing row rather than creating a duplicate row

### Requirement: Structural pre-commit validation

The system SHALL validate every staged change structurally before committing — TOML and YAML/frontmatter parse cleanly and enumerated fields (e.g. recipe `status`, pantry `category`) hold legal values — using a Workers-runtime-safe (`workerd`) implementation, since the Node index-build validator cannot run in the Worker. A change that fails structural validation SHALL be rejected with a structured error and SHALL NOT be committed. Cross-reference and index validation remain the responsibility of the post-push build Action.

#### Scenario: Malformed write is rejected before commit

- **WHEN** a write tool is asked to persist content that would not parse as valid TOML/frontmatter or sets an out-of-enum value
- **THEN** the tool returns a structured `validation_failed` error describing the problem and makes no commit

#### Scenario: Valid write passes through

- **WHEN** a staged change parses cleanly and all enumerated fields are legal
- **THEN** validation passes and the change proceeds to the atomic commit

### Requirement: User-curated config writes are content-faithful

The user-curated `update_*` tools (`taste`, `diet_principles`, `preferences`, `aliases`) SHALL write exactly the content supplied by the caller to the corresponding curated file and SHALL NOT infer or merge additional changes. There is no `update_substitutions` tool. The discipline of *when* these may be called (only on explicit user direction) is documented in `AGENT_INSTRUCTIONS.md`; the tools themselves are unconditional writers of provided content.

#### Scenario: Curated write persists provided content verbatim

- **WHEN** `update_preferences(updates)` is called with a directed edit
- **THEN** the tool writes the provided content to `preferences.toml` via the atomic commit and returns confirmation, without adding inferred changes

### Requirement: Writes are routed by data category

The system SHALL route each write to the correct location within the single data repo by data category: objective recipe **content** and shared reference/SKU data SHALL be written at the repo **root** (`recipes/`, reference files, `skus/`); per-tenant **overlay** (`rating`/`status`), **notes**, personal recipes, and personal state (pantry, preferences, taste, diet_principles, grocery_list, stockup, cooking_log) SHALL be written under the caller's **`users/<username>/`** subtree. There is no per-tenant substitution-override file. A subjective-field change to a shared recipe SHALL NOT modify shared content. (`last_cooked` is not written as overlay — it is realized by appending to the caller's `users/<username>/cooking_log.toml`.)

#### Scenario: Content edit targets the shared root

- **WHEN** an objective edit to a shared recipe's content is persisted
- **THEN** it is committed to `recipes/` at the data-repo root

#### Scenario: Overlay, notes, and personal state target the user subtree

- **WHEN** a tenant's rating, note, pantry change, or preference edit is persisted
- **THEN** it is committed under that tenant's `users/<username>/` subtree, never to the shared root or another member's subtree

### Requirement: Note write tool

The system SHALL provide a tool to add a recipe note to the caller's per-tenant repo, accepting the recipe slug, body text, optional tags, and an optional `private` flag, and recording the author (structurally, by the owning repo) and a timestamp. Adding a note SHALL be append-style and SHALL NOT modify shared recipe content or overwrite the tenant's prior notes on that recipe.

#### Scenario: Note added to the caller's repo

- **WHEN** the note tool is called with a slug and body
- **THEN** a new note is written to the caller's per-tenant repo with a timestamp, leaving shared content and the caller's earlier notes intact

#### Scenario: Private flag honored at write

- **WHEN** the note tool is called with `private: true`
- **THEN** the stored note is marked private so later reads surface it only to its author

