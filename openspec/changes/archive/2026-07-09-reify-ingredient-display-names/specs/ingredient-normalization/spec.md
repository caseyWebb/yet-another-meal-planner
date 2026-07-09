## ADDED Requirements

### Requirement: Display name is a first-class node attribute

The system SHALL store a curated **`display_name`** on each `ingredient_identity` node — the human-facing label — as a value distinct from the canonical id and from `search_term`. The `display_name` SHALL be a stored column, not derived from the id at read time; `labelOf(id)` SHALL return the stored `display_name` when present and fall back to the `base (detail)` synthesis (`detail ? "base (detail)" : base`) only when it is null. It SHALL be populated the same way `search_term` is: proposed by the classifier at import, protected on conflict so an existing value is never downgraded by an `auto` write, human-overridable via `update_aliases` with `source='human'` precedence, and backfilled for the existing null-`display_name` backlog by a bounded reconcile pass. Because canonical ids are append-only join keys that are never renamed, the `display_name` SHALL be the renameable label — editing it SHALL NOT touch the id or any row keyed on it. The `display_name` SHALL NOT be a deterministic join key and SHALL NOT be a matcher input.

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

## MODIFIED Requirements

### Requirement: Canonical nodes and the full-id join

The system SHALL model ingredient identity as a graph of canonical **nodes** named `base` or `base::detail` (e.g. `ground-beef`, `ground-beef::fat-80-20`, `cheese::cheddar`, `chicken::thighs`). The id string is a stable machine join key, **not** the human-facing label — the readable name for a node is its curated `display_name` (see «Display name is a first-class node attribute»), and deterministic code renders a node to a human via `labelOf`/`display_name`, never by showing the raw id. A canonical id SHALL contain at most one detail segment: no deterministic path (novel canonical validation, specialization construction, or any reconcile) constructs an id deeper than `base::detail`, and a deeper id observed in the registry is a defect the segment-overflow repair converges. The **deterministic join key** for `sku_cache`, `brand_prefs`, grocery-list dedup, and cross-recipe overlap SHALL be the **full canonical id**, after synonym-merge through the `representative` pointer. Deterministic code SHALL NOT use base equality (the id prefix up to the first `::`) as a blanket join, because same-base nodes may be non-interchangeable varieties. The **base** SHALL serve only as a grouping anchor, the matcher's search-term fallback, and the "-any" anchor (an unqualified request resolves to the bare base node). A detail token's value SHALL NOT be parsed or interpreted by deterministic code — details are opaque discriminators whose human rendering is the node's `display_name`, never a parse of the token; fit judgment is deferred to read-time reasoning over the visible labels and edges.

#### Scenario: Full id is the join; synonyms merge, varieties do not

- **WHEN** `"scallions"` and `"green onions"` both resolve (via `representative`) to `green-onion`, while `"cheddar"` resolves to `cheese::cheddar` and `"mozzarella"` to `cheese::mozzarella`
- **THEN** the two onion forms share one join key (one SKU-cache/brand-pref/overlap entry), while the two cheeses remain distinct join keys and are NOT treated as the same ingredient despite sharing base `cheese`

#### Scenario: Unqualified request resolves to the bare base

- **WHEN** a recipe ingredient is just `"ground beef"` (no product detail)
- **THEN** it resolves to the bare base node `ground-beef` (the "-any" anchor), which the matcher searches as "ground beef" and buys cheapest-acceptable

#### Scenario: Detail values are opaque to deterministic code

- **WHEN** deterministic code compares `ground-beef::fat-80-20` and `ground-beef::fat-90-10`
- **THEN** it reports them as distinct ids without interpreting `80-20` vs `90-10`; whether one satisfies a request for the other is a read-time judgment over the visible labels and any captured edge
