## MODIFIED Requirements

### Requirement: Sibling suggestions are a labeled depth-1 walk over the persisted identity graph

Sibling suggestions SHALL be computed by a shared annotator (`annotateSubstitutes`) over the
persisted schema — `ingredient_edge(from_id, to_id, kind ∈ {general, containment, membership})`
with every endpoint first resolved through the `ingredient_identity.representative` union-find
pointer — and SHALL comprise exactly three depth-1 relations for a resolved line id `x`: **satisfies**
(`from_id`s of edges into `x`, any kind), **generalization** (`to_id`s of `x`'s outgoing `general`
or `containment` edges; `membership` targets excluded), and **sibling** (co-children sharing one
parent with `x` through edges of the same kind, labeled with the shared parent as `via`). No
transitive walk SHALL occur. Suggestion targets SHALL be `concrete = 1` nodes only, excluding the
line itself. Results SHALL be emitted in the fixed precedence satisfies → `general`-kind siblings →
generalizations → `containment`-kind siblings → `membership`-kind siblings, lexicographic within
each tier, deduplicated first-relation-wins, and capped per line. Every suggestion SHALL carry its
relation label (`role`, `kind`, and `via`).

The walk's targets SHALL then be filtered to **actionable** substitutes only: a walked target
SHALL be returned in a line's `substitutes[]` if and only if its resolved id is (a) in the member's
pantry (a pantry row exists), (b) in the member's cart (an `in_cart` grocery row), (c) an active
grocery-list line, or (d) on sale at the member's primary store (the warmed flyer rollup carries a
matching item at the flyer reads' default sale floor). On-sale SHALL be an **independent** surfacing
reason — an on-sale target SHALL surface even when the member does not already have it — while
reasons (a)–(c) require member possession. A walked target satisfying none of (a)–(d) SHALL NOT be
returned. The filter SHALL never introduce a target outside the depth-1 walk. Because active-list
membership is now a surfacing reason (c), a target that is itself an active grocery-list line SHALL
surface (a consolidation nudge) rather than being excluded; a purely plan-derived (virtual) to-buy
line that the member neither has, is carting, nor can deal on SHALL NOT surface.

Each returned substitute SHALL carry the reason(s) it surfaced — one or more of `in_pantry` (a
pantry row exists for its resolved id), `in_cart` (an `in_cart` grocery row exists for it), `on_list`
(an active grocery-list line exists for it), and `on_sale_hint` (the matching flyer item's price and
savings). Sibling annotation SHALL issue no per-sibling Kroger search. The annotator SHALL be called
by the **enriched to-buy read** and its output returned as each to-buy line's `substitutes[]`, run
over the **whole** to-buy set with no per-line term-search budget and no Kroger product call.

#### Scenario: An on-hand family member surfaces; the rest are dropped

- **WHEN** the graph holds `cabbage::color-green → cabbage`, `cabbage::type-napa → cabbage`, and
  `cabbage::color-red → cabbage` (kind `general`), the line resolves to `cabbage::type-napa`, and
  the member has `cabbage::color-red` in the pantry
- **THEN** `cabbage::color-red` is returned in that line's `substitutes[]` (labeled `kind: "general"`,
  `via: "cabbage"`, `in_pantry: true`) and `cabbage::color-green` — which the member neither has, is
  carting, has on the list, nor can deal on — is NOT returned

#### Scenario: An on-sale neighbor surfaces even when not on hand

- **WHEN** a walked neighbor `y` of a to-buy line is absent from the pantry, cart, and active list,
  but the primary store's warmed flyer rollup carries a matching item at or above the sale floor
- **THEN** `y` is returned in `substitutes[]` with an `on_sale_hint` (the flyer item's price and
  savings) and no possession reason, surfaced solely because it is on sale

#### Scenario: A non-actionable neighbor is dropped

- **WHEN** a to-buy line's only walked neighbor is neither in the pantry, cart, nor active list, and
  is not on sale at the primary store
- **THEN** that neighbor is NOT returned and the line's `substitutes[]` is empty for it — no
  suggestion the member cannot act on

#### Scenario: An active-list substitute surfaces as a consolidation nudge

- **WHEN** both a to-buy line `x` and one of its walked substitutes `y` are active grocery-list lines
- **THEN** `y` is returned in `x`'s `substitutes[]` flagged `on_list: true` — the prior rule that
  excluded any id already in the caller's to-buy set no longer suppresses it

#### Scenario: Merged nodes are resolved before walking

- **WHEN** an edge endpoint's identity row carries a non-null `representative`
- **THEN** the annotator operates on the surviving id and never suggests a merged-away id

#### Scenario: A line with no actionable substitute fabricates nothing

- **WHEN** a line's resolved id has no walked neighbor that is actionable (the common case in a
  sparse graph with a sparse pantry)
- **THEN** its `substitutes[]` is empty — no suggestion is invented outside the graph and none the
  member cannot act on is surfaced

### Requirement: Inline substitute hints on the to-buy list

The grocery page SHALL render each to-buy line's `substitutes[]` inline on its row, fetching the
enriched read so hints show under both the aisle and category grouping modes. Each rendered
substitute SHALL show its relation label and its **surfacing justification** — one or more of "in
your pantry" (`in_pantry`), "in your cart" (`in_cart`), "already on your list" (`on_list`), and "on
sale — $X" (`on_sale_hint`, with the real promo price) — a per-row **accept** mapping to the existing
write semantics by line origin, and a per-session **dismiss** that is never persisted. A row with no
substitute SHALL render unchanged — no empty container and no fabricated hint. The page SHALL NOT
present a separate substitutions panel or a "Propose substitutions" trigger.

#### Scenario: An on-hand substitute offers the swap inline

- **WHEN** a to-buy line carries a `substitutes[]` entry flagged `in_pantry`
- **THEN** the row shows the relation-labeled substitute ("in your pantry") with an accept action,
  inline on the list, with no panel opened

#### Scenario: A cart or list substitute shows why it surfaced

- **WHEN** a to-buy line carries a `substitutes[]` entry flagged `in_cart` or `on_list`
- **THEN** the row shows the relation-labeled substitute with its justification ("in your cart" or
  "already on your list") and an accept action, inline on the list

#### Scenario: An on-sale substitute shows the real price

- **WHEN** a line carries a substitute with an `on_sale_hint`
- **THEN** the row shows the substitute's promo price ("on sale — $X at your store"), not a bare
  claim

#### Scenario: A line with no substitute renders clean

- **WHEN** a line's `substitutes[]` is empty (the common case once non-actionable neighbors are
  filtered)
- **THEN** the row renders exactly as before with no hint affordance and no empty container

#### Scenario: Dismiss is per-session only

- **WHEN** a member dismisses an inline hint and reloads the page
- **THEN** the hint reappears — dismissals are client per-session state, never persisted
