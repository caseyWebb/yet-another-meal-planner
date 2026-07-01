# ingredient-normalization delta — ingredient-classifier-hardening

## ADDED Requirements

### Requirement: Confirm-distance guard on collapse decisions

The capture job SHALL reject a classifier SAME or SPECIALIZATION decision when the chosen candidate's own cosine similarity to the queued term is below a confirm minimum (a constant calibrated above the worst observed wrong collapse and below the correct-decision band), and SHALL fall back to the NOVEL mint path for that term, recording the guard rejection — the rejected outcome, the chosen candidate, and its cosine — in the normalization log detail. The confirm prompt SHALL present each candidate together with its cosine similarity, with guidance that low similarity raises the bar for SAME/SPECIALIZATION. The guard SHALL NOT apply to the SKU co-resolution pass (its merge signal is deliberately non-embedding evidence).

#### Scenario: A distant pick is rejected and falls back to novel

- **WHEN** the classifier returns SPECIALIZATION against a candidate whose cosine to the queued term is below the confirm minimum (e.g. "flaky sea salt" specialized under "fish sauce" at 0.598)
- **THEN** the pick is rejected, the term is minted as a NOVEL base (verbatim), and the log detail records the guard rejection with the rejected outcome, candidate, and score

#### Scenario: A near pick is applied unchanged

- **WHEN** the classifier returns SAME or SPECIALIZATION against a candidate whose cosine is at or above the confirm minimum
- **THEN** the decision is committed exactly as before the guard existed

### Requirement: Canonical id synthesis for confirmed-novel mints

For a confirmed NOVEL outcome the classifier SHALL additionally propose a `canonical` id — the clean lowercase product name with packaging, quantity, and storage-condition noise stripped, in `base` or `base::detail` form. The job SHALL validate the proposal (non-empty after trimming; all-lowercase; no parentheses, commas, or newlines; bounded length; at most one `::` separator, each segment non-empty with no other colon use) and, when valid and not equal to an existing node id or alias variant, mint the node under the canonical id with `base`/`detail` derived from it and the search term flattened from it. The surface term SHALL always be written as an alias to the final node id, whichever id is chosen. An invalid or missing canonical, or one that collides with an existing node id or alias variant, SHALL fall back to the verbatim-term mint (a collision must never silently alias the term onto the existing node, and a standing alias variant must never shadow a freshly minted node of the same name). A malformed canonical SHALL never fail the mint or consume the corrective-retry budget. Below-floor mints (no classifier call) SHALL keep verbatim behavior.

#### Scenario: A valid canonical cleans a free-text mint

- **WHEN** "quick cooking oats (flavored)" is confirmed NOVEL with canonical "quick cooking oats"
- **THEN** the node is minted with id/base "quick cooking oats" and the alias "quick cooking oats (flavored)" → "quick cooking oats" is written

#### Scenario: An invalid canonical falls back to the verbatim term

- **WHEN** the classifier proposes a canonical that fails validation (e.g. contains parentheses or uppercase) or proposes none
- **THEN** the node is minted under the verbatim queued term (pre-change behavior) and the fallback reason is recorded in the log detail

#### Scenario: A colliding canonical falls back to the verbatim term

- **WHEN** the proposed canonical equals an existing node id (including a merged-away or not-yet-embedded node)
- **THEN** the node is minted under the verbatim queued term and no alias is written onto the colliding node

#### Scenario: Below-floor mints are untouched

- **WHEN** a queued term's nearest identity is below the similarity floor (no classifier call is spent)
- **THEN** the node is minted under the verbatim term exactly as before

### Requirement: Edge commit contradiction validation

Edge commits (the capture resolution commit and the re-confirm enrich commit) SHALL skip, rather than insert, any proposed edge whose reverse pair (to → from, regardless of kind) already exists in the edge table or earlier in the same commit, and any edge that resolves to a self-loop after following each endpoint's representative pointer. Skipped edges SHALL be recorded, with a reason, in the committed decision's normalization-log detail. Kept edges SHALL insert with their original (pre-resolution) endpoints.

#### Scenario: A reverse pair is skipped, not inserted

- **WHEN** the edge "whole cardamom pods" -[containment]→ "ground cardamom" exists and a commit proposes "ground cardamom" -[general]→ "whole cardamom pods"
- **THEN** the proposed edge is skipped and recorded in the log detail, while the commit's other writes proceed unchanged

#### Scenario: A post-merge self-loop is skipped

- **WHEN** a commit proposes an edge from A to B and B's representative chain resolves to A
- **THEN** the edge is skipped as a self-loop and recorded in the log detail

### Requirement: Embedding backfill for retrieval completeness

The capture job SHALL, each tick before draining the novel-term queue, embed a bounded batch of surviving identity nodes whose embedding is missing (e.g. nodes minted by a human `update_aliases` write) and store the vectors, so those nodes join the cosine retrieval set — including for terms drained later in the same tick. A backfill failure SHALL be logged and skipped without failing the tick (the rows stay unembedded and retry on a later tick), and the backfilled count SHALL be reported in the job summary.

#### Scenario: A human-minted node becomes retrievable

- **WHEN** a node inserted by `update_aliases` has a NULL embedding
- **THEN** a capture tick embeds it, and a related term queued afterwards retrieves it as a cosine candidate instead of re-minting the concept

#### Scenario: Backfill is bounded and non-fatal

- **WHEN** the embedding call fails transiently during the backfill
- **THEN** the queue drain still runs that tick, and the unembedded nodes remain eligible for backfill on a later tick

## MODIFIED Requirements

### Requirement: Conservative collapse and prep-versus-product stripping

The system SHALL NOT collapse two terms into one identity on embedding similarity alone; only the classifier confirm SHALL create an alias-to-existing id. The confirm SHALL be biased toward **SPECIALIZATION or NOVEL on any doubt**, because a missed alias (fragmentation) is cheap and self-healing on a later tick while a wrong collapse is silent and costly (a wrong purchase). A qualifier SHALL be treated as load-bearing (→ SPECIALIZATION) only when it changes *which product a shopper would buy* (fat ratio, flour type, egg size, cut); a **preparation** qualifier that does not change the SKU ("diced", "minced", "shredded", "softened") SHALL strip to the base. The confirm SHALL NOT collapse across a distinct-base boundary even at high similarity (`baking-soda` ≠ `baking-powder`; `chicken-broth` ≠ `vegetable-broth`; `heavy-cream` ≠ `half-and-half`). A **distinct product** SHALL NOT be recorded as a SPECIALIZATION of a superficially-similar candidate — a specialization's detail narrows the SAME product, it never attaches a different product to a lookalike base (dried dates are not a variety of a dried-fruit blend; canned salmon is not a form of fresh skin-on fillets; a loaf of bread is not a type of bread flour; a finishing salt is not a kind of fish sauce) — the confirm prompt SHALL state this rule with counter-examples.

#### Scenario: High similarity does not force a collapse

- **WHEN** `"baking powder"` is queued and cosines very near `baking-soda`
- **THEN** the confirm returns NOVEL (distinct base) and no alias between them is written

#### Scenario: Preparation qualifier strips to base

- **WHEN** `"diced yellow onion"` is queued
- **THEN** it resolves to base `yellow-onion` (the dice is a preparation, not a product qualifier) rather than minting `yellow-onion::diced`

#### Scenario: Doubt defaults to preserving the distinction

- **WHEN** the classifier is uncertain whether a qualified term is an alias of or a specialization of a candidate
- **THEN** it specializes (preserving the qualifier) rather than collapsing, so no distinction is destroyed

#### Scenario: A distinct product is not a lookalike's specialization

- **WHEN** `"dried medjool dates"` is queued and its nearest candidate is `dried fruit blend`
- **THEN** the confirm returns NOVEL (a distinct product), not a SPECIALIZATION like `dried fruit blend::type-medjool-dates`
