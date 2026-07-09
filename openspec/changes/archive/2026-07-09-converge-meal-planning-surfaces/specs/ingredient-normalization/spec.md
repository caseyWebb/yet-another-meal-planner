## ADDED Requirements

### Requirement: Capture-first taste-substitution edges

The identity graph SHALL support a `substitution` edge kind, distinct from the factual satisfies kinds (`general` / `containment` / `membership`), born from **deterministic backend observation** rather than model speculation. The concrete capture trigger is **agent-side, at the moment the member accepts the swap**: an `add_to_grocery_list` annotated with `substitutes_for` (the recipe ingredient X the added item stands in for). The write path SHALL resolve the added item to a canonical id Y and `substitutes_for` to X through the existing normalization pipeline, and — when Y ≠ X **and** Y is **not already an identity neighbor** of X (not reachable as a synonym / containment / membership sibling — pure set logic against the existing graph, no classifier) — record a candidate `substitution` edge X → Y. Detection SHALL be set logic only; the system SHALL NOT invent substitution edges from a small-model classifier over the corpus. The edge is **operator-global** (observations from different members accrue to one edge) and SHALL carry a **weight** that accrues on repeated observation (candidate → promoted, following the same conservative confidence-band discipline as the identity capture pass), and MAY carry an optional **qualifier** (a substitution ratio like `1:2`, a leavening or cook-time caveat) authored later — by a model when good enough, or left blank; a bare weighted edge is useful without one. Capture SHALL be **best-effort**: any resolution, read, or write failure SHALL be swallowed and SHALL NOT fail the grocery add it rides alongside.

#### Scenario: A cross-canonical accepted swap mints a candidate edge

- **WHEN** a member accepts a swap via `add_to_grocery_list(item, substitutes_for: X)` where the added item resolves to a canonical id Y that differs from X and is not an identity neighbor of X
- **THEN** a candidate `substitution` edge X → Y is recorded with initial weight

#### Scenario: A same-identity swap mints no substitution edge

- **WHEN** the `substitutes_for` add's item resolves to the same canonical id as X, or to an existing identity neighbor of X (a synonym/containment/membership relation)
- **THEN** no `substitution` edge is recorded — that is a product/price swap, not a taste substitution

#### Scenario: Repeated observation promotes the edge

- **WHEN** the same cross-canonical swap X → Y is accepted again
- **THEN** the edge's weight accrues and it promotes past the candidate threshold, still without a required qualifier

#### Scenario: A qualifier is annotation, not a gate

- **WHEN** a promoted `substitution` edge has no qualifier
- **THEN** it is still surfaced as a suggestion; a qualifier MAY be authored later and never blocks the edge's use

#### Scenario: A capture failure never fails the grocery add

- **WHEN** the substitution capture fails (a resolution error, an identity-graph read error, or the edge write fails) while an item is being added with `substitutes_for`
- **THEN** the grocery add still succeeds and the failure is swallowed — the capture is best-effort, never a gate on the primary operation

### Requirement: Substitution edges are excluded from satisfies() reachability

A `substitution` edge SHALL NOT participate in `satisfies(have, want)` reachability. It SHALL NOT gate or complete a Kroger match, SHALL NOT cause a purchase, and SHALL NOT be treated as identity — a substitute is a taste judgment ("A can stand in for B, with caveats"), not "having A satisfies a request for B." `substitution` edges SHALL surface only as **labeled read-time suggestions** (the depth-1 walk of the `member-app-differentiators` capability), where the narrower — the member or the LLM — decides fitness. This keeps the substitution *decision* at read-time reasoning and keeps identity separable from substitution, consistent with ADR-0001's open-world-hint stance (a missing or wrong edge degrades to world knowledge).

#### Scenario: satisfies() ignores substitution edges

- **WHEN** `satisfies(have, want)` is evaluated and the only path from `have` to `want` is a `substitution` edge
- **THEN** `satisfies` returns false — the substitution never completes a match or causes a purchase

#### Scenario: A substitution surfaces as a labeled suggestion only

- **WHEN** a resolved ingredient has an outgoing promoted `substitution` edge
- **THEN** the target surfaces as a labeled substitution suggestion for the narrower, not as an automatic swap

### Requirement: Substitution edges are excluded from the identity edge audit

Because captured `substitution` edges are written into the same `ingredient_edge` table as the factual satisfies edges, the rolling edge-audit passes SHALL exclude them **by kind**. A `substitution` edge SHALL NOT be selected by the edge re-audit batch, SHALL NOT appear in the audit's reverse-pair lookup set, SHALL NOT trip the commit-time reverse-exists 2-cycle guard against a factual edge, SHALL NOT count a concrete node as connected for the re-confirm edgeless probe, and SHALL NOT be counted in the un-audited edge backlog. The operator Nodes/Normalization admin lenses SHALL likewise exclude `substitution` edges from their satisfies-adjacency, orphan detection, and `satisfies` edge count. This keeps the satisfies-edge audit — whose direction check can DELETE an edge — from ever selecting or deleting a captured substitution edge, keeps the orphan audit from masking a below-floor concrete node behind a substitution edge, and keeps the audit backlog converging (a substitution edge is never audited, so it never carries an `audited_at` stamp).

#### Scenario: The edge re-audit never selects a substitution edge

- **WHEN** the edge-audit batch is read for auto, un-audited edges and a `substitution` edge is auto and un-audited
- **THEN** the substitution edge is not in the batch — the satisfies-direction re-audit can never select or delete it

#### Scenario: The orphan audit is not masked by a substitution edge

- **WHEN** a concrete node has no factual satisfies edge but is the endpoint of a `substitution` edge
- **THEN** the Nodes lens still reports it as an orphan and the un-audited edge backlog count omits the substitution edge
