# ingredient-normalization — delta

## MODIFIED Requirements

### Requirement: Auto-derived, human-overridable, fully audited

The normalization layer SHALL grow with **no required user or operator action**. Every capture decision SHALL be appended to a normalization log (the term, the outcome, the candidate ids, their cosine scores, the model) serving as the audit trail and the evaluated-set. Each alias/identity row SHALL carry a `source` of `auto` or `human`; a `human` write SHALL take precedence over and SHALL NOT be overwritten by an `auto` decision. Human overrides SHALL be written from the **operator admin surface** through the shared human-precedence write operation (variant → canonical-id upserts keyed by lowercased variant) — there is no member `update_aliases` MCP tool. An operator SHALL be able to correct or reverse an auto decision, and the correction SHALL be group-wide (the store is shared corpus).

#### Scenario: Layer grows with no human in the loop

- **WHEN** members shop and cook without anyone editing aliases
- **THEN** the alias + identity store still grows as the capture job resolves novel terms, and every resolution is recorded in the normalization log

#### Scenario: Human override beats auto

- **WHEN** an operator sets a `human`-sourced alias (from the admin surface) for a term the job had auto-resolved differently
- **THEN** the human mapping wins and a later `auto` pass does not overwrite it

#### Scenario: Alias curation has no member chat tool

- **WHEN** the member MCP tool surface is enumerated
- **THEN** no alias-writing tool appears; the shared human-precedence write operation is reachable from the operator admin surface only

### Requirement: Display name is a first-class node attribute

The system SHALL store a curated **`display_name`** on each `ingredient_identity` node — the human-facing label — as a value distinct from the canonical id and from `search_term`. The `display_name` SHALL be a stored column, not derived from the id at read time; `labelOf(id)` SHALL return the stored `display_name` when present and fall back to the `base (detail)` synthesis (`detail ? "base (detail)" : base`) only when it is null. It SHALL be populated the same way `search_term` is: proposed by the classifier at import, protected on conflict so an existing value is never downgraded by an `auto` write, human-overridable from the operator admin surface with `source='human'` precedence (the same shared write operation as alias overrides), and backfilled for the existing null-`display_name` backlog by a bounded reconcile pass. Because canonical ids are append-only join keys that are never renamed, the `display_name` SHALL be the renameable label — editing it SHALL NOT touch the id or any row keyed on it. The `display_name` SHALL NOT be a deterministic join key and SHALL NOT be a matcher input.

#### Scenario: The classifier proposes a display name at import

- **WHEN** the capture job confirms a novel term and commits its node
- **THEN** the node's `display_name` is set from the classifier's proposed label and persisted alongside `base`/`detail`/`search_term`

#### Scenario: A human display name wins and is not downgraded

- **WHEN** a `source='human'` `display_name` exists for a node and a later `auto` pass commits the same id
- **THEN** the human `display_name` is preserved (never overwritten by the auto value), mirroring the `search_term` "human wins" precedence

#### Scenario: The reconcile backfills a null display name

- **WHEN** the reconcile runs and a node has a null `display_name`
- **THEN** a bounded per-tick pass derives and stores a `display_name` for it (as `backfillEmbeddings` does for embedding-less rows), converging the backlog without hand-edits

#### Scenario: labelOf prefers the stored display name

- **WHEN** `labelOf(id)` is called for a node that has a stored `display_name`
- **THEN** it returns the stored `display_name`; and for a node whose `display_name` is null it returns the `base (detail)` synthesis unchanged

#### Scenario: Renaming a display name touches no join key

- **WHEN** a node's `display_name` is changed
- **THEN** the node's `id`, and every `sku_cache` / `brand_prefs` / grocery-list / recipe-overlap row keyed on that id, are unchanged, and no match result changes
