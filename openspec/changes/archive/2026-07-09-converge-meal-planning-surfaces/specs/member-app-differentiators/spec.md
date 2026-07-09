## ADDED Requirements

### Requirement: The depth-1 walk surfaces captured substitution edges as a labeled relation

The shared depth-1 substitution annotator (`annotateSubstitutes`) SHALL surface promoted `substitution`-kind edges (the `ingredient-normalization` capability) as an additional **labeled relation** for a resolved line id `x` — the `substitution` targets of `x`'s outgoing promoted `substitution` edges, each carrying its weight and optional qualifier. This relation SHALL be emitted after the existing factual relations (satisfies → `general` siblings → generalizations → `containment` siblings → `membership` siblings) in the fixed precedence, so factual identity always ranks ahead of a taste substitution. No transitive walk SHALL occur — substitution targets are depth-1 only, `concrete = 1` nodes only. The relation label SHALL name it a substitution (distinct from the identity relations) and carry the qualifier when present, so the narrower can weigh fitness; the walk proposes and names, it does not decide. Because `substitution` edges are excluded from `satisfies()`, surfacing them here SHALL NOT change any match or purchase — they are suggestions only.

#### Scenario: A promoted substitution edge appears as a labeled suggestion

- **WHEN** a resolved line id `x` has an outgoing promoted `substitution` edge to a concrete node `y`
- **THEN** the walk emits `y` as a labeled substitution relation (with `y`'s weight and any qualifier), after all factual identity relations in the precedence

#### Scenario: Substitution suggestions do not affect matching

- **WHEN** the walk surfaces a substitution suggestion for a line
- **THEN** the line's Kroger match and to-buy resolution are unchanged — the suggestion is read-time material for the narrower, not a swap

#### Scenario: No transitive substitution walk

- **WHEN** `y` itself has outgoing substitution edges
- **THEN** they are not followed — only `x`'s depth-1 substitution targets are surfaced

#### Scenario: Accepting a surfaced substitution records the edge

- **WHEN** the narrower accepts a surfaced substitution (or any other taste swap) and adds the replacement via `add_to_grocery_list(item, substitutes_for: <replaced ingredient>)`
- **THEN** the agent-side write path records the `substitution` edge through the shared capture (the `ingredient-normalization` capability) — the accept feeds the same graph that surfaced it; the member web app's one-tap accept is a future trigger onto that same `substitutes_for` path

