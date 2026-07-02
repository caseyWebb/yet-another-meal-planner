## ADDED Requirements

### Requirement: Disjunctive terms resolve to satisfaction concepts

A surface term or canonical id containing the standalone disjunctive token ` or ` (including comma-separated lists ending in ` or `) SHALL never be confirmed or minted as a concrete identity — a disjunction "X or Y" is a satisfaction constraint, not a product. The capture job SHALL dispose a pattern-matching queued term deterministically, with no classifier call, AFTER the lexical fast path and BEFORE the similarity floor: mint an abstract concept node (`concrete=0`) under the cleaned term verbatim, with the node's `search_term` set to the FIRST disjunct (so the matcher's search phrase is always a member phrase, never the disjunctive phrase), the term's embedding stored, and the surface form aliased to it. Disjunct terms SHALL be derived by plain code splitting on the token with head-noun distribution — the final fragment's tokens after its first token are appended to any fragment with fewer tokens than the final fragment. The `and`-compound and slash (`X/Y`) forms SHALL NOT match the pattern (and-compounds are real products; slash forms collide with protected ratio qualifiers). The confirm prompt SHALL state that a disjunctive term or canonical is never a concrete product, and a classifier-proposed NOVEL canonical matching the pattern SHALL be rejected to the verbatim fallback with the rejection recorded in the log detail. The alias re-audit SHALL apply the same deterministic disposal to an eligible pattern-matching variant — re-pointed to its disjunction concept (minted when absent) with no model call, stamped, and logged with the audit marker.

#### Scenario: A disjunctive term captures as an abstract concept with no model call

- **WHEN** the queued term `white or yellow onion` is drained and does not hit the lexical fast path
- **THEN** an abstract node `white or yellow onion` (`concrete=0`, `search_term` `white onion`) is minted with its embedding, the alias is written, no classifier call is spent, and the decision is logged with a disjunction marker and the disjunct list

#### Scenario: Head-noun distribution splits the disjuncts

- **WHEN** the splitter processes `white or yellow onion`, `anaheim or cubanelle peppers`, and `olive oil or butter`
- **THEN** it yields `white onion`/`yellow onion` and `anaheim peppers`/`cubanelle peppers` (the shared head noun distributed onto the shorter fragments), while `olive oil`/`butter` split verbatim (no fragment is shorter than the final one)

#### Scenario: The lexical fast path still wins over the gate

- **WHEN** a punctuation-only variant of an existing disjunction concept is queued
- **THEN** it resolves SAME to that concept through the lexical fast path and no second concept is minted

#### Scenario: And-compounds stay concrete

- **WHEN** `half and half` or `pecans (halved and pieces)` is queued
- **THEN** the disjunction gate does not match and the term proceeds through the normal floor/confirm flow as a buyable product

#### Scenario: A disjunctive classifier canonical is rejected

- **WHEN** the confirm returns NOVEL for a non-disjunctive term with a proposed canonical of the form `X or Y`
- **THEN** the canonical is rejected (reason recorded), the node is minted under the verbatim term, and no disjunctive concrete identity is created

#### Scenario: The alias re-audit disposes a disjunctive variant deterministically

- **WHEN** the re-audit selects an un-audited `source='auto'` alias whose variant matches the disjunctive pattern
- **THEN** the variant is re-pointed to its disjunction concept (minted abstract when absent) with no classifier call, the row is stamped, and the disposal is logged with the audit marker

### Requirement: Disjunction membership reconcile

The capture job SHALL run a deterministic per-tick sub-pass (no model calls, bounded writes, runs even on an empty queue) that, for every surviving abstract node whose id matches the disjunctive pattern, recomputes the disjunct terms from the id and resolves each through the full front door (exact alias lookup plus the representative chain). A disjunct resolving to a surviving id other than the concept SHALL gain a `membership` satisfies-edge from the member to the concept — inserted born-stamped, skipped when any edge already stands between the pair in either direction, and logged. A disjunct that does not resolve SHALL be enqueued to the novel-term queue (insert-or-ignore, best-effort, never failing the tick) on every tick until the capture job places it, so member edges converge organically with no manual backfill. The sub-pass SHALL be idempotent — a converged registry plans no writes.

#### Scenario: A member edge appears once the disjunct is captured

- **WHEN** the disjunct `serrano peppers` resolves through the front door to a surviving node after a capture tick places it
- **THEN** the next reconcile tick inserts `serrano peppers`'s survivor `-[membership]→ serrano or jalapeño peppers` born-stamped, logs the insertion, and a rerun inserts nothing

#### Scenario: Unresolved disjuncts are enqueued until placed

- **WHEN** a disjunction concept's disjunct has no front-door resolution
- **THEN** the term is enqueued insert-or-ignore each tick, and once the capture job resolves it the enqueue stops and the member edge is inserted instead

#### Scenario: Members satisfy the concept line at read time

- **WHEN** a pantry holds a member of a disjunction concept and `satisfiesAmong` is queried over the pantry set plus the concept id
- **THEN** the member → concept membership edge is returned (representative-resolved), so the consumer sees the pantry item fulfilling the disjunctive line

### Requirement: Retroactive disjunction shape sweep

The same sub-pass SHALL converge existing wrongly-concrete disjunction nodes with no operator action and no manual data edits: every surviving `source='auto'` `concrete=1` node whose id matches the disjunctive pattern is repaired — a bare node is FLIPPED (`concrete=0`, `search_term` = first disjunct); a `::detail` child of a disjunctive base is FOLDED into the (flipped) base via the representative pointer; a family whose base was merged INTO its own child is RE-ROOTED at the base (clear the base's representative, point the child at it, flip the base) in one atomic batch; a child whose base node is missing has the base MINTED abstract (embedding NULL, backfilled) and the child pointed at it. Every repair SHALL be logged. `source='human'` nodes SHALL never be flipped or folded (skipped and counted). Existing aliases SHALL keep resolving through the resulting chain, and dependent keys (grocery/pantry `normalized_name`, `sku_cache`, stored alias targets) SHALL converge through the existing reconciles. The sweep SHALL be self-quiescing with no new stamp: repaired rows no longer match the selection predicate (`concrete=1` and surviving), so a converged registry selects nothing.

#### Scenario: The production families converge organically

- **WHEN** the sweep first runs over production, which holds `white or yellow onion` and `anaheim or cubanelle peppers` (bare concrete disjunctions) and the serrano family (base merged into its surviving `::form-diced` child)
- **THEN** the two bare nodes flip abstract with member-phrase search terms, the serrano family re-roots at the abstract base with the child folded into it, both serrano aliases resolve to the base, and a second pass plans nothing

#### Scenario: The structural-edge churn loop quiesces after the fold

- **WHEN** the fold makes the disjunction child a non-survivor while its old structural edge to the base still stands
- **THEN** the edge-audit pre-pass sweeps that edge as a representative-resolved self-loop at most once more and the structural guarantee does not re-insert it (the child no longer survives), ending the per-tick delete/re-insert cycle

#### Scenario: Human-pinned disjunctive nodes are immune

- **WHEN** the sweep encounters a pattern-matching node with `source='human'`
- **THEN** it is skipped and counted, never flipped, folded, or re-rooted

#### Scenario: Dependent rows converge through the existing reconciles

- **WHEN** a grocery or pantry row's `normalized_name` is a folded child's id
- **THEN** the existing grocery/pantry re-key reconcile converges it to the surviving abstract base on a later tick, with no writes from the sweep itself

### Requirement: Concept-concrete merge guard

A representative merge SHALL NOT be proposed between a concept node (`concrete=0`) and a concrete node by the merge-proposing passes: the SKU co-resolution pass SHALL skip a candidate pair whose surviving ids differ in `concrete` (a member and its concept legitimately co-resolve to one SKU once a concept-keyed cache row exists — shared SKU is not synonym evidence across the concrete boundary), counted in the job summary with no confirm call spent; and the re-confirm pass SHALL reject a `same` outcome whose survivor is a concept node to a logged no-op (the node stamped, nothing merged). The merge primitive itself SHALL remain general (deterministic shape repairs may merge across the boundary by design).

#### Scenario: A mixed-concreteness co-resolution pair is skipped

- **WHEN** a concept-keyed `sku_cache` row and a member's row resolve to the same SKU and surface as a co-resolution candidate pair
- **THEN** the pass skips the pair before any confirm call, counts the skip, and no merge is proposed

#### Scenario: Re-confirm cannot merge a concrete node into a concept

- **WHEN** the re-confirm's classifier returns `same` for an eligible concrete node against a concept-node candidate
- **THEN** no merge is written — the node is stamped and the rejection is logged with the outcome and candidate

## MODIFIED Requirements

### Requirement: Structural edge guarantee

The edge re-audit job SHALL run a deterministic per-tick pre-pass (no model calls) that (a) deletes any `source='auto'` edge whose endpoints resolve to the same survivor through the representative pointer — regardless of audit stamp — logging each deletion, and (b) ensures every surviving two-segment identity node `X::detail` has an edge of some kind from `X::detail` to its exact base `X`: when none exists, a `general` edge SHALL be inserted born-stamped (never re-entering the audit backlog), minting the base node `X` (embedding NULL, for the backfill) when it is absent, and logging each insertion. The guarantee SHALL NOT insert an edge that would be a representative-resolved self-loop: when the base `X` and the node `X::detail` resolve to the same survivor (the base was merged into its own child), the insertion is skipped — never guaranteeing an edge the self-loop sweep would delete, so an inverted family cannot oscillate between (a) and (b). The pre-pass SHALL run every tick including when the audit backlog is empty, SHALL be write-capped per tick, and SHALL be idempotent — a converged registry plans nothing.

#### Scenario: The wrongly-dropped structural class is restored deterministically

- **WHEN** the pre-pass runs while surviving nodes `rotel (original)::heat-mild`, `snacking pickles::form-chips`, and `serrano or jalapeño peppers::form-diced` have no edge to their bases (the audit dropped them as "distinct products")
- **THEN** a `general` edge from each node to its exact base is inserted born-stamped with no model call, and each insertion is logged

#### Scenario: A missing base node is minted for the guarantee

- **WHEN** a surviving node `X::detail` has no edge to `X` and no node `X` exists
- **THEN** the base node `X` is minted (embedding NULL, embedded later by the backfill) and the structural edge is inserted in the same pass

#### Scenario: A stamped self-loop left behind by a repair is swept

- **WHEN** the segment-overflow repair points the overflow node at its prefix, turning the overflow's born-stamped structural edge into a representative-resolved self-loop
- **THEN** the pre-pass deletes that edge even though it carries an audit stamp, and logs the deletion

#### Scenario: An inverted family is never guaranteed a self-loop edge

- **WHEN** the pre-pass runs over a family whose base's representative chain resolves to its own surviving `::detail` child (the production serrano inversion) while the stamped structural edge `X::detail → X` still stands
- **THEN** step (a) sweeps that edge as a representative-resolved self-loop, step (b) skips the re-insert because `X` and `X::detail` resolve to the same survivor, and the delete/re-insert churn quiesces in one tick — before and independent of the disjunction shape sweep

#### Scenario: A converged registry is a no-op

- **WHEN** the pre-pass runs and every surviving two-segment node already has its base edge and no auto edge self-loops
- **THEN** it plans no writes and spends no model calls
