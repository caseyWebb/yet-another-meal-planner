# data-write-tools Specification

## Purpose
TBD - created by archiving change git-write-tools. Update Purpose after archive.
## Requirements
### Requirement: Atomic batched commit via the Git Data API

The system SHALL persist all repo writes through a single atomic commit built with GitHub's Git Data API — create blobs/tree, create a commit whose parent is the read base, then update the ref — and SHALL NOT write files through sequential per-file Contents-API commits. A batch of changes from one tool call SHALL land as exactly one commit. The commit engine SHALL extend the existing authenticated GitHub client (reusing the `contents:read+write` PAT) and SHALL surface failures as structured errors per the `mcp-server` convention.

#### Scenario: Multiple file changes land as one commit

- **WHEN** a write tool stages changes to two or more files in a single call
- **THEN** the engine builds one tree and one commit and updates the ref once, producing a single commit containing all changed files

#### Scenario: Concurrent second writer is retried

- **WHEN** the ref has advanced since the read base (e.g. the index-build Action committed) and the `update ref` is rejected as non-fast-forward
- **THEN** the engine re-reads the current base, replays the same changeset onto it, and retries the commit rather than failing or force-updating

#### Scenario: Write failure is structured

- **WHEN** the Git Data API is unreachable or rejects the write after retries are exhausted
- **THEN** the tool returns a structured `upstream_unavailable` error and does not throw an unhandled exception

### Requirement: Repo-data write tools

The system SHALL provide repo-data write tools that persist via the atomic commit engine: `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, the user-curated `update_*` tools (preferences, taste, diet principles, substitutions, aliases), and `commit_changes`. `commit_changes` SHALL accept a batch of repo updates (recipe, pantry, ready-to-eat, and directed config edits) and persist them in one commit with a single summarizing message. No tool in this capability SHALL write a Kroger cart or call an external service.

#### Scenario: Single update persists with confirmation

- **WHEN** `update_recipe(slug, updates)` is called with a valid slug and frontmatter fields
- **THEN** the recipe frontmatter is merged, committed, and the tool returns `{ slug, updated_fields }`

#### Scenario: Batched session persists as one commit

- **WHEN** `commit_changes` is called with several recipe, pantry, and ready-to-eat updates and a commit message
- **THEN** all updates are applied in one commit and the tool returns the commit sha and a summary

#### Scenario: Unknown target is structured, not thrown

- **WHEN** a write tool targets a slug or item that does not exist
- **THEN** it returns a structured `not_found` error naming the target, and no commit is made

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

