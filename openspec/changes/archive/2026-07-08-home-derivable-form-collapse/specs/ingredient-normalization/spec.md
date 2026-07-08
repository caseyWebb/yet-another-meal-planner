# ingredient-normalization — home-derivable-form-collapse deltas

## MODIFIED Requirements

### Requirement: Conservative collapse and prep-versus-product stripping

The system SHALL NOT collapse two terms into one identity on embedding similarity alone; only the classifier confirm — or the deterministic lexical-identity fast path below — SHALL create an alias-to-existing id. As the one deterministic exception, a term whose lexical form exactly equals that of a surviving node id or a known alias variant SHALL resolve as SAME to that survivor with no model call — a mechanical identity, not a similarity collapse; when two distinct survivors share the lexical form, the fast path SHALL be skipped and the normal confirm flow applies. The lexical form SHALL be punctuation- and plural-insensitive: lowercased, punctuation collapsed to spaces, whitespace normalized, and each letters-only token of at least 4 characters folded by a conservative plural rule (`-ies` → `-y`, `-oes` → `-o`, else one trailing `-s` stripped unless the token ends `-ss`, `-us`, or `-is`) — the same pluralization-is-the-same-product rule the confirm prompt states, applied deterministically; an irregular plural the fold misses falls through to the classifier (fragmentation at worst, never a mis-collapse). Word-order folding SHALL NOT be attempted. The fast path SHALL apply at capture and at the alias re-audit alike. Within a capture tick, a node minted mid-batch SHALL join the batch's live lexical map immediately (its id, and its surface term when the form differs) — exactly as just-minted nodes join the retrieval set in-tick — so the second twin of a same-batch pair resolves through the fast path instead of minting; an appended key that collides with an existing entry for a different survivor SHALL make that key ambiguous (the fast path SHALL NOT fire on it for the rest of the tick), and a key already ambiguous at batch start SHALL stay ambiguous regardless of appends. The confirm SHALL be biased toward **SPECIALIZATION or NOVEL on any doubt**, because a missed alias (fragmentation) is cheap and self-healing on a later tick while a wrong collapse is silent and costly (a wrong purchase). A qualifier SHALL be treated as load-bearing (→ SPECIALIZATION) only when it names a **purchasable distinction** — the qualified form is a DIFFERENT product on the store shelf a shopper would buy (fat ratio, flour type, egg size, a varietal, or a canned/dried/pickled/ground/toasted form sold as its own SKU: pickle chips, canned tuna, dried thyme, cinnamon sticks). The judgment SHALL be per-product purchasability, not a word list: a **preparation or cut form** the shopper derives at home from the purchased base by ordinary kitchen work ("diced", "minced", "shredded", "softened", "wedges", "slices", "quarters", "zest") SHALL strip to the base — such a form is recorded for the recipe's sake, not the store's, and names the same purchase — and the SAME surface word MAY dispose either way by product ("diced tomatoes" names a canned shelf product and specializes; "diced yellow onion" is knife work and strips to the base). A home-derived **extraction that is also a distinct purchasable product in its own right** (lime juice — sold bottled, not reconstitutable into the fruit) SHALL remain a distinct base: it is NEVER SAME to its source product in either direction, and satisfaction between the two is expressible only through explicit satisfies edges or read-time reasoning, never by id equality. The confirm SHALL NOT collapse across a distinct-base boundary even at high similarity (`baking-soda` ≠ `baking-powder`; `chicken-broth` ≠ `vegetable-broth`; `heavy-cream` ≠ `half-and-half`). A **distinct product** SHALL NOT be recorded as a SPECIALIZATION of a superficially-similar candidate — a specialization's detail narrows the SAME product, it never attaches a different product to a lookalike base (dried dates are not a variety of a dried-fruit blend; canned salmon is not a form of fresh skin-on fillets; a loaf of bread is not a type of bread flour; a finishing salt is not a kind of fish sauce) — the confirm prompt SHALL state this rule with counter-examples. The confirm prompt SHALL state the purchasable-distinction test and the home-derivable-form rule with examples (including the extraction carve-out). The confirm prompt SHALL also state that a term differing from a candidate only in punctuation, pluralization, or word order is the SAME product.

#### Scenario: High similarity does not force a collapse

- **WHEN** `"baking powder"` is queued and cosines very near `baking-soda`
- **THEN** the confirm returns NOVEL (distinct base) and no alias between them is written

#### Scenario: Preparation qualifier strips to base

- **WHEN** `"diced yellow onion"` is queued
- **THEN** it resolves to base `yellow-onion` (the dice is a preparation, not a product qualifier) rather than minting `yellow-onion::diced`

#### Scenario: A home-derivable cut form resolves to the base product

- **WHEN** `"lime wedges"` is queued (or re-audited) and `lime` is among the confirm's candidates
- **THEN** the confirm returns SAME on `lime` — wedges are knife work on the purchased lime, not a shelf product — so no `lime::form-wedges` node is minted (or the standing mapping is re-pointed to `lime`)

#### Scenario: The same word disposes by purchasability, not by list

- **WHEN** `"diced tomatoes"` and `"diced yellow onion"` are each confirmed against their bases
- **THEN** `"diced tomatoes"` keeps a specialization (canned diced tomatoes are a distinct shelf SKU) while `"diced yellow onion"` strips to `yellow-onion` — the word "diced" decides nothing by itself

#### Scenario: A purchasable extraction stays a distinct base

- **WHEN** `"lime juice"` is queued (or re-audited) and cosines near `lime`
- **THEN** the confirm returns NOVEL (a distinct purchasable product — bottled or fresh-squeezed), never SAME on `lime` in either direction, so a pantry `lime juice` can never equal-match a request for `lime` or any of its forms

#### Scenario: Doubt defaults to preserving the distinction

- **WHEN** the classifier is uncertain whether a qualified term is an alias of or a specialization of a candidate
- **THEN** it specializes (preserving the qualifier) rather than collapsing, so no distinction is destroyed

#### Scenario: A distinct product is not a lookalike's specialization

- **WHEN** `"dried medjool dates"` is queued and its nearest candidate is `dried fruit blend`
- **THEN** the confirm returns NOVEL (a distinct product), not a SPECIALIZATION like `dried fruit blend::type-medjool-dates`

#### Scenario: A punctuation-only variant resolves deterministically

- **WHEN** `"salmon fillets skin-on"` is queued (or re-audited) while the node `salmon fillets, skin-on` survives, and no other survivor shares its lexical form
- **THEN** it resolves SAME to `salmon fillets, skin-on` with no embedding comparison and no classifier call, and the fast-path resolution is logged

#### Scenario: A plural variant resolves deterministically

- **WHEN** `"onions"` is queued while the node `onion` survives, and no other survivor shares its lexical form
- **THEN** it resolves SAME to `onion` through the fast path with no classifier call

#### Scenario: A same-batch twin hits the fast path against a mid-batch mint

- **WHEN** `"onion"` and `"onions"` are drained in the same capture tick with neither in the registry, and `"onion"` mints first
- **THEN** `"onions"` resolves SAME to the just-minted `onion` through the in-tick lexical append and no second node is minted

#### Scenario: An in-tick lexical collision makes the key ambiguous

- **WHEN** a mid-batch mint's lexical form collides with an existing map entry for a different survivor
- **THEN** the key becomes ambiguous, later same-form terms this tick skip the fast path and take the normal confirm flow, and no deterministic alias is written on the collided key

### Requirement: Structural edge guarantee

The edge re-audit job SHALL run a deterministic per-tick pre-pass (no model calls) that (a) deletes any `source='auto'` edge whose endpoints resolve to the same survivor through the representative pointer — regardless of audit stamp — logging each deletion, and (b) ensures every surviving two-segment identity node `X::detail` has an edge of some kind from `X::detail` to its exact base `X`: when none exists, a `general` edge SHALL be inserted born-stamped (never re-entering the audit backlog), minting the base node `X` (embedding NULL, for the backfill) when it is absent, and logging each insertion. The guarantee SHALL NOT insert an edge that would be a representative-resolved self-loop: when the base `X` and the node `X::detail` resolve to the same survivor (the base was merged into its own child), the insertion is skipped — never guaranteeing an edge the self-loop sweep would delete, so an inverted family cannot oscillate between (a) and (b). The guarantee SHALL be **survival-agnostic**: it asserts the base edge for WHATEVER two-segment nodes survive and takes no position on whether a detail node ought to exist — which specializations are minted, kept, or collapsed is owned by the capture confirm and the alias re-audit under the purchasable-distinction test. When a home-derivable detail node is collapsed (merged into its base via the representative pointer), it no longer survives: step (a) sweeps its standing structural edge as a representative-resolved self-loop and step (b) SHALL NOT re-insert an edge for it. The pre-pass SHALL run every tick including when the audit backlog is empty, SHALL be write-capped per tick, and SHALL be idempotent — a converged registry plans nothing.

#### Scenario: The wrongly-dropped structural class is restored deterministically

- **WHEN** the pre-pass runs while surviving nodes `rotel (original)::heat-mild`, `snacking pickles::form-chips`, and `tomatoes::form-diced` (purchasable forms that survive the purchasable-distinction test) have no edge to their bases (the audit dropped them as "distinct products")
- **THEN** a `general` edge from each node to its exact base is inserted born-stamped with no model call, and each insertion is logged

#### Scenario: A missing base node is minted for the guarantee

- **WHEN** a surviving node `X::detail` has no edge to `X` and no node `X` exists
- **THEN** the base node `X` is minted (embedding NULL, embedded later by the backfill) and the structural edge is inserted in the same pass

#### Scenario: A stamped self-loop left behind by a repair is swept

- **WHEN** the segment-overflow repair points the overflow node at its prefix, turning the overflow's born-stamped structural edge into a representative-resolved self-loop
- **THEN** the pre-pass deletes that edge even though it carries an audit stamp, and logs the deletion

#### Scenario: A collapsed home-derivable node's edge is swept, never re-guaranteed

- **WHEN** the purchasability re-audit merges `lime::form-wedges` into `lime` while the structural edge `lime::form-wedges -[general]→ lime` still stands
- **THEN** step (a) deletes that edge as a representative-resolved self-loop (its audit stamp notwithstanding) and step (b) does not re-insert it, because the from-node no longer survives

#### Scenario: An inverted family is never guaranteed a self-loop edge

- **WHEN** the pre-pass runs over a family whose base's representative chain resolves to its own surviving `::detail` child (the production serrano inversion) while the stamped structural edge `X::detail → X` still stands
- **THEN** step (a) sweeps that edge as a representative-resolved self-loop, step (b) skips the re-insert because `X` and `X::detail` resolve to the same survivor, and the delete/re-insert churn quiesces in one tick — before and independent of the disjunction shape sweep

#### Scenario: A converged registry is a no-op

- **WHEN** the pre-pass runs and every surviving two-segment node already has its base edge and no auto edge self-loops
- **THEN** it plans no writes and spends no model calls

## ADDED Requirements

### Requirement: Purchasability re-audit re-opening for standing detail-node aliases

The system SHALL re-open the rolling alias re-audit for the pre-hardening detail-node backlog with a one-time D1 migration that clears `audited_at` on every `source='auto'` `ingredient_alias` row whose stored target id contains a detail segment, so the EXISTING re-audit pass re-decides each such mapping under the hardened purchasable-distinction confirm — no new pass, no new stamp, and no manual data edits. `source='human'` rows SHALL NOT be re-opened. Convergence SHALL ride existing machinery only: a home-derivable mapping is re-pointed to its base (fresh auto `decided_at`, re-stamped, logged with the audit marker), a re-point that strands an auto node with no remaining aliases merges it into the re-decision's resolved node via the representative pointer, the merged node's structural edge is swept as a representative-resolved self-loop by the edge-audit pre-pass, and dependent keys (recipe-index facets, `sku_cache`, grocery/pantry `normalized_name`, stored alias targets) converge through the standing reconciles — including a stale resolved-id facet snapshot (a stored id that stops resolving after the merge), which the projection capture funnel re-enqueues and the hardened capture confirm re-disposes onto the surviving base. A purchasable detail mapping re-decided by the re-opened audit SHALL re-derive its standing mapping and be applied as a keep (re-committed and re-stamped), so the re-opening produces no churn on legitimate specializations, and the pass SHALL re-quiesce once the re-opened backlog drains (capture and re-audit writes remain born-stamped). Satisfaction between a pantry item and a recipe ingredient whose home-derivable form has collapsed SHALL be plain resolved-id equality — this change SHALL introduce no new edge kinds, no reverse traversal, and no `satisfies()` closure in tools — and a distinct-base extraction (`lime juice`) SHALL never auto-satisfy its source product (`lime`) by equality or by any mechanism this change adds; it MAY surface only as an explicit suggestion (the depth-1 substitution walk or read-time reasoning).

#### Scenario: The issue-215 defect converges organically and is the acceptance fixture

- **WHEN** the migration ships and the re-opened audit re-decides `'lime wedges'` → `lime::form-wedges` while the production pantry holds `lime` and the recipes `chicken-and-black-bean-stew` and `crispy-tofu-with-peanut-sauce` carry `lime::form-wedges` in `perishable_ingredients`
- **THEN** the alias re-points to `lime`, the stranded `lime::form-wedges` merges into `lime` via the representative pointer, its structural edge is swept as a self-loop, the recipe facets re-converge to `lime` through the projection funnel and capture, and the pantry `lime` row satisfies those recipe lines by plain resolved-id equality — verified against production after deploy as this change's acceptance fixture

#### Scenario: A purchasable detail mapping is kept without churn

- **WHEN** the re-opened audit re-decides `'pickle chips'` → `pickles::form-chips` or `'canned tuna'` → `tuna::form-canned`
- **THEN** the hardened confirm re-derives the standing mapping (a SAME on the survivor, a re-derived specialization, or a NOVEL canonical resolving to it), the mapping is kept and re-stamped, and no node is minted or merged

#### Scenario: Pantry lime juice never auto-satisfies a lime request

- **WHEN** a pantry holds `lime juice` and a recipe line resolves to `lime` (or a formerly-collapsed form such as `lime::form-wedges`)
- **THEN** no equality match occurs and no matching code performs an edge traversal — `lime juice` remains a distinct surviving base with no auto-created edge or merge to `lime`, and it can reach the member only as an explicit suggestion, never as automatic satisfaction

#### Scenario: Human detail aliases are not re-opened

- **WHEN** the migration runs over a registry containing `'calamansi'` → `lime::calamansi` (`source='human'`)
- **THEN** that row keeps its audit stamp, is never selected by the re-opened pass, and its node is never re-decided, re-pointed, or merged

#### Scenario: The re-opened backlog drains and the pass re-quiesces

- **WHEN** every re-opened detail-target row has been re-decided and re-stamped
- **THEN** the alias re-audit selects nothing and spends no model calls on later ticks, and rows written by capture and the re-audit remain born-stamped
