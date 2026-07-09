## ADDED Requirements

### Requirement: Capture-first taste-substitution edges

The identity graph SHALL support a `substitution` edge kind, distinct from the factual satisfies kinds (`general` / `containment` / `membership`), born from **deterministic backend observation** rather than model speculation. When a **purchasable swap** replaces a recipe's ingredient X with a product that resolves (through the normalization pipeline) to a canonical id Y, and Y is **not already an identity neighbor** of X (not reachable as a synonym / containment / membership sibling — pure set logic against the existing graph, no classifier), the system SHALL record a candidate `substitution` edge X → Y. The edge SHALL carry a **weight** that accrues on repeated observation (candidate → promoted, following the same conservative confidence-band discipline as the identity capture pass), and MAY carry an optional **qualifier** (a substitution ratio like `1:2`, a leavening or cook-time caveat) authored later — by a model when good enough, or left blank; a bare weighted edge is useful without one. The system SHALL NOT invent substitution edges from a small-model classifier over the corpus; detection is set logic, and any qualifier is annotation of an observed edge.

#### Scenario: A cross-canonical purchasable swap mints a candidate edge

- **WHEN** a member's `place_order` override replaces a recipe's ingredient X with a product resolving to a different canonical id Y that is not an identity neighbor of X
- **THEN** a candidate `substitution` edge X → Y is recorded with initial weight

#### Scenario: A same-identity swap mints no substitution edge

- **WHEN** the override's replacement resolves to the same canonical id as X, or to an existing identity neighbor of X (a synonym/containment/membership relation)
- **THEN** no `substitution` edge is recorded — that is a product/price swap, not a taste substitution

#### Scenario: Repeated observation promotes the edge

- **WHEN** the same cross-canonical swap X → Y is observed again
- **THEN** the edge's weight accrues and it promotes past the candidate threshold, still without a required qualifier

#### Scenario: A qualifier is annotation, not a gate

- **WHEN** a promoted `substitution` edge has no qualifier
- **THEN** it is still surfaced as a suggestion; a qualifier MAY be authored later and never blocks the edge's use

### Requirement: Substitution edges are excluded from satisfies() reachability

A `substitution` edge SHALL NOT participate in `satisfies(have, want)` reachability. It SHALL NOT gate or complete a Kroger match, SHALL NOT cause a purchase, and SHALL NOT be treated as identity — a substitute is a taste judgment ("A can stand in for B, with caveats"), not "having A satisfies a request for B." `substitution` edges SHALL surface only as **labeled read-time suggestions** (the depth-1 walk of the `member-app-differentiators` capability), where the narrower — the member or the LLM — decides fitness. This keeps the substitution *decision* at read-time reasoning and keeps identity separable from substitution, consistent with ADR-0001's open-world-hint stance (a missing or wrong edge degrades to world knowledge).

#### Scenario: satisfies() ignores substitution edges

- **WHEN** `satisfies(have, want)` is evaluated and the only path from `have` to `want` is a `substitution` edge
- **THEN** `satisfies` returns false — the substitution never completes a match or causes a purchase

#### Scenario: A substitution surfaces as a labeled suggestion only

- **WHEN** a resolved ingredient has an outgoing promoted `substitution` edge
- **THEN** the target surfaces as a labeled substitution suggestion for the narrower, not as an automatic swap
