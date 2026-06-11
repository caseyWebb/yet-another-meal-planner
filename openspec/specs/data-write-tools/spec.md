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

### Requirement: Structural pre-commit validation

The system SHALL validate every staged change structurally before committing — TOML and YAML/frontmatter parse cleanly and enumerated fields (e.g. recipe `status`, pantry `category`) hold legal values — using a Workers-runtime-safe (`workerd`) implementation, since the Node index-build validator cannot run in the Worker. A change that fails structural validation SHALL be rejected with a structured error and SHALL NOT be committed. Cross-reference and index validation remain the responsibility of the post-push build Action.

#### Scenario: Malformed write is rejected before commit

- **WHEN** a write tool is asked to persist content that would not parse as valid TOML/frontmatter or sets an out-of-enum value
- **THEN** the tool returns a structured `validation_failed` error describing the problem and makes no commit

#### Scenario: Valid write passes through

- **WHEN** a staged change parses cleanly and all enumerated fields are legal
- **THEN** validation passes and the change proceeds to the atomic commit

### Requirement: User-curated config writes are content-faithful

The user-curated `update_*` tools (`taste`, `diet_principles`, `preferences`, `substitutions`, `aliases`) SHALL write exactly the content supplied by the caller to the corresponding curated file and SHALL NOT infer or merge additional changes. The discipline of *when* these may be called (only on explicit user direction) is documented in `AGENT_INSTRUCTIONS.md`; the tools themselves are unconditional writers of provided content.

#### Scenario: Curated write persists provided content verbatim

- **WHEN** `update_preferences(updates)` is called with a directed edit
- **THEN** the tool writes the provided content to `preferences.toml` via the atomic commit and returns confirmation, without adding inferred changes

### Requirement: Writes are routed by data category

The system SHALL route each write to the correct location within the single data repo by data category: objective recipe **content** and shared reference/SKU data SHALL be written at the repo **root** (`recipes/`, reference files, `skus/`); per-tenant **overlay** (`rating`/`status`), **notes**, personal recipes, and personal state (pantry, preferences, taste, diet_principles, grocery_list, stockup, cooking_log, per-tenant substitution overrides) SHALL be written under the caller's **`users/<username>/`** subtree. A subjective-field change to a shared recipe SHALL NOT modify shared content. (`last_cooked` is not written as overlay — it is realized by appending to the caller's `users/<username>/cooking_log.toml`.)

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

