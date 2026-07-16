## MODIFIED Requirements

### Requirement: Note write tool

The system SHALL provide a tool (`add_recipe_note`) to add a recipe note as a row in the D1 `recipe_notes` table, accepting the recipe slug, body text, optional tags, and an optional visibility **`tier`** (`public | friends | private`, defaulting to `friends`), and recording the `author` (the authenticated caller's member id, not a spoofable input) and a `created_at` timestamp. The legacy `private` boolean SHALL remain accepted as a deprecated alias (`true` → `tier = 'private'`, `false` → `tier = 'friends'`; `tier` wins when both are passed) so pre-tier plugin bundles keep working. Note **creation** SHALL be gated on the caller's visibility lens: a slug outside the caller's lens SHALL return the same structured `not_found` a nonexistent slug returns (a member only annotates recipes they can see; no existence disclosure, no orphan rows). Adding a note SHALL be append-style and SHALL NOT modify shared recipe content or overwrite the caller's prior notes on that recipe. It returns without a `commit_sha`.

#### Scenario: Note added to D1

- **WHEN** `add_recipe_note` is called with a slug and body
- **THEN** a new `recipe_notes` row is written with the caller's member id as `author`, `tier = 'friends'`, and a `created_at`, leaving shared content and the caller's earlier notes intact, returning `{ slug, author, created_at, tier }`

#### Scenario: Tier honored at write

- **WHEN** the note tool is called with `tier: "private"`
- **THEN** the stored row carries `tier = 'private'` so later reads surface it only to its authoring member

#### Scenario: Legacy private alias still works

- **WHEN** a stale plugin calls the tool with `private: true` and no `tier`
- **THEN** the note is stored at `tier = 'private'`, exactly as the pre-tier contract behaved

#### Scenario: Note creation is lens-gated without an oracle

- **WHEN** `add_recipe_note` is called for a slug outside the caller's visibility lens
- **THEN** the tool returns the identical structured `not_found` a nonexistent slug produces, and no `recipe_notes` row is written
