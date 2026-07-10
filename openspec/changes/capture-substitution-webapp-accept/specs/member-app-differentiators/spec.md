## MODIFIED Requirements

### Requirement: Acting on a suggestion reuses existing writes only

The substitution surface SHALL introduce no new write operation and SHALL never apply a swap implicitly. Accepting a same-identity alternative (in the order dialog) SHALL stage a `place_order` `override` for that line (revalidated before the cart per the existing order contract) and SHALL record no `substitution` edge — a same-identity swap is a product/price pick, not a taste substitution. Accepting a cross-ingredient sibling on an explicit row (inline on the to-buy list) SHALL be the existing `add_to_grocery_list` + `remove_from_grocery_list` writes, and the `add_to_grocery_list` SHALL carry `substitutes_for` set to the replaced line's ingredient so the accepted taste swap is captured through the shared hook (the `ingredient-normalization` capability's capture-first substitution edges); accepting one on a virtual (`origin: "plan"`) row SHALL be the existing materialize add — likewise carrying `substitutes_for` — plus an order-scoped `exclude` of the original. `substitutes_for` is an optional annotation on the existing add, not a new write operation, and its capture is best-effort: a capture failure SHALL NOT fail the accept. Because inline hints appear at list-review (before the flush), a virtual-row swap's materialize add SHALL land immediately while its `exclude` is staged in client order state and applied at the eventual `place_order`; no persisted suppression state SHALL be introduced. Dismissals SHALL be per-session client state, never persisted. The matcher's resolve-only and never-substitutes guarantees SHALL be unmodified.

#### Scenario: Same-identity swap becomes an order override and records no edge

- **WHEN** the member accepts a cheaper same-identity alternative in the order dialog
- **THEN** the swap is staged as an `overrides` entry on the order commit — no server state changes until the order is placed, the override is revalidated before the cart, and no `substitution` edge is recorded

#### Scenario: Cross-ingredient swap on an explicit row captures the substitution

- **WHEN** the member accepts a cross-ingredient sibling inline on an explicit to-buy row
- **THEN** the add carries `substitutes_for` set to the replaced line's ingredient and the remove is unchanged, so the shared capture records or accrues the operator-global `substitution` edge (per `ingredient-normalization`)

#### Scenario: Cross-ingredient swap on a virtual row leaves the plan intact

- **WHEN** the member accepts a plan-derived (virtual) line's sibling swap inline on the list
- **THEN** the sibling is materialized as a grocery row immediately with `substitutes_for` set to the original line's ingredient, the original's order-scoped `exclude` is staged and applied at the flush, the meal plan is untouched, and the original re-derives on later reads

#### Scenario: A capture failure never fails the accept

- **WHEN** the substitution capture fails while a cross-ingredient accept applies its add with `substitutes_for`
- **THEN** the add and remove (or materialize and exclude) still succeed and the failure is swallowed — capture is best-effort, never a gate on the accept

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

#### Scenario: Accepting a surfaced substitution records the edge from either surface

- **WHEN** the narrower accepts a surfaced substitution (or any other taste swap) and adds the replacement via `add_to_grocery_list(item, substitutes_for: <replaced ingredient>)` — whether the agent issues that call or the member web app's one-tap inline accept posts the same `substitutes_for` on its add
- **THEN** the write path records the `substitution` edge through the shared capture (the `ingredient-normalization` capability) — the accept feeds the same operator-global graph that surfaced it, identically from either surface
