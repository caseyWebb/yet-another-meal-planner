# member-app-differentiators — spec delta (inline-substitution-hints)

## ADDED Requirements

### Requirement: Enriched to-buy read carries aisle placement and substitute hints

`read_to_buy` SHALL accept an optional `enrich` flag (`?enrich=1` on `GET /api/grocery/to-buy`);
when absent the read SHALL be byte-identical to the default view, preserving its zero-Kroger,
zero-AI guarantee. When set, the read SHALL cost at most **one** Kroger Locations resolve
(label → locationId, live only for a whitespace label; a bare id short-circuits with no HTTP) and
**zero** product searches, and each to-buy line SHALL gain both enrichments under that single
resolve: a `placement` (aisle fields from the `sku_cache` row at the caller's location plus the
identity-graph `department` fallback, unchanged from the shipped aisle enrichment) and a
`substitutes[]` array (the shared substitute annotator's output — relation-labeled cross-ingredient
siblings each annotated `in_pantry` and, where matched, `on_sale_hint`). The view SHALL also return
`flyer_as_of`. With no resolvable Kroger location the enriched read SHALL still serve `substitutes[]`
with `in_pantry` and label-keyed flyer hints and **zero** Kroger calls, with placements carrying
`department` only. The enriched read's ETag SHALL incorporate the pantry rowset, `flyer_as_of`, and
the identity edge-set marker so a warmed flyer or a pantry edit invalidates cached hints.

#### Scenario: The default read is byte-identical

- **WHEN** `read_to_buy` is called without `enrich`
- **THEN** the result is exactly the pre-existing view shape with no `substitutes`/`flyer_as_of`
  keys and no Kroger call of any kind

#### Scenario: One resolve serves both aisle placement and substitute hints

- **WHEN** the enriched read is requested for a Kroger-primary tenant
- **THEN** at most one Locations resolve occurs, zero product searches occur, and each line carries
  its `placement` and its `substitutes[]` together, with `flyer_as_of` on the view

#### Scenario: A walk-store tenant still gets the graph half

- **WHEN** a tenant with no resolvable Kroger location requests the enriched read
- **THEN** each line's `substitutes[]` carries `in_pantry` siblings and label-keyed flyer hints
  computed from D1 and the warmed rollup, with `location: null` and no Kroger product call issued

#### Scenario: A warmed flyer invalidates cached hints

- **WHEN** the primary store's flyer rollup is re-warmed (new `flyer_as_of`) after a prior enriched
  read
- **THEN** the enriched read's ETag changes and the next read reflects the fresh `on_sale_hint`
  set rather than serving the cached one

### Requirement: Inline substitute hints on the to-buy list

The grocery page SHALL render each to-buy line's `substitutes[]` inline on its row, fetching the
enriched read so hints show under both the aisle and category grouping modes. Each rendered
substitute SHALL show its relation label and its `in_pantry` and/or `on_sale_hint` annotation with
the real sale price (for `on_sale_hint`), a per-row **accept** mapping to the existing write
semantics by line origin, and a per-session **dismiss** that is never persisted. A row with no
substitute SHALL render unchanged — no empty container and no fabricated hint. The page SHALL NOT
present a separate substitutions panel or a "Propose substitutions" trigger.

#### Scenario: An on-hand substitute offers the swap inline

- **WHEN** a to-buy line carries a `substitutes[]` entry flagged `in_pantry`
- **THEN** the row shows the relation-labeled substitute ("in your pantry") with an accept action,
  inline on the list, with no panel opened

#### Scenario: An on-sale substitute shows the real price

- **WHEN** a line carries a substitute with an `on_sale_hint`
- **THEN** the row shows the substitute's promo price ("on sale — $X at your store"), not a bare
  claim

#### Scenario: A line with no substitute renders clean

- **WHEN** a line's `substitutes[]` is empty (the common case in a sparse graph)
- **THEN** the row renders exactly as before with no hint affordance and no empty container

#### Scenario: Dismiss is per-session only

- **WHEN** a member dismisses an inline hint and reloads the page
- **THEN** the hint reappears — dismissals are client per-session state, never persisted

### Requirement: Same-identity alternatives surface in the order dialog

The order dialog SHALL render the slim substitution op's `alternatives` per line at preview time,
fetched online-only (never offline-queued or replayed): the current pick and each fulfillable
same-identity alternative with its deterministic reason and real prices (both unit prices for a
`cheaper` claim), and a per-row accept that stages a `place_order` `override` for that line
(revalidated before the cart per the existing order contract). No same-identity alternative SHALL
be applied implicitly, and an undispositioned alternative SHALL simply not be carted.

#### Scenario: The dialog substantiates "cheaper" with numbers

- **WHEN** an alternative's reason is `cheaper`
- **THEN** the row shows both unit prices (proposed vs current), not a bare claim

#### Scenario: Accepting an alternative stages an order override

- **WHEN** a member accepts a cheaper same-identity alternative in the order dialog
- **THEN** the swap is staged as an `overrides` entry on the order commit — no server state
  changes until the order is placed, and the override is revalidated before the cart

#### Scenario: No alternatives renders nothing

- **WHEN** the slim op returns no alternatives for a line
- **THEN** the dialog shows the line without an alternatives affordance rather than an empty
  container

## MODIFIED Requirements

### Requirement: Deterministic substitution suggestions behind one shared read

The system SHALL expose **same-identity substitution alternatives** through one shared operation
called by both `suggest_substitutions` and `POST /api/grocery/substitutions` (session-gated). For
each requested to-buy line (caller-supplied `names` resolved through the ingredient funnel, or —
when absent — the caller's current derived to-buy set), the read SHALL return: the line's current
pick (the location-preferred cached SKU mapping, revalidated for fresh price/fulfillment/aisle) with
a `status` of `ok` | `current_unavailable` | `no_cached_pick`; and same-identity alternatives from
exactly one term search, filtered to fulfillable products, ranked by the existing `compareUnitPrice`
core (promo price when on sale), capped. Each alternative SHALL carry a closed, deterministic reason
vocabulary — `cheaper` (strictly lower unit price than the current pick, only when both ranked
comparable in one dimension), `on_sale` (promo price below regular), `in_stock` (fulfillable while
the current pick is unavailable) — and no other reason values. The read SHALL be read-only.
Cross-ingredient sibling suggestions and their pantry/sale annotations SHALL NOT be part of this
read — they are computed by the shared substitute annotator and returned on the enriched to-buy read.

#### Scenario: A cheaper comparable alternative is flagged with real numbers

- **WHEN** a line's current pick unit-prices at $0.42/oz and a fulfillable search candidate of the
  same dimension unit-prices at $0.31/oz
- **THEN** the candidate is returned as an alternative with `reasons` containing `cheaper` and both
  items' `unit_price`/`base_unit` present, ranked by the `compareUnitPrice` core

#### Scenario: An out-of-stock current pick yields in-stock alternatives

- **WHEN** the cached SKU revalidates as unavailable at the caller's location
- **THEN** the line returns `status: "current_unavailable"` and its fulfillable alternatives carry
  the `in_stock` reason

#### Scenario: The read no longer returns siblings

- **WHEN** a tenant calls `suggest_substitutions` or `POST /api/grocery/substitutions`
- **THEN** the result carries only current-pick status and same-identity `alternatives`; sibling
  suggestions are absent from this surface (served instead on the enriched to-buy read)

### Requirement: Sibling suggestions are a labeled depth-1 walk over the persisted identity graph

Sibling suggestions SHALL be computed by a shared annotator (`annotateSubstitutes`) over the
persisted schema — `ingredient_edge(from_id, to_id, kind ∈ {general, containment, membership})`
with every endpoint first resolved through the `ingredient_identity.representative` union-find
pointer — and SHALL comprise exactly three depth-1 relations for a resolved line id `x`: **satisfies**
(`from_id`s of edges into `x`, any kind), **generalization** (`to_id`s of `x`'s outgoing `general`
or `containment` edges; `membership` targets excluded), and **sibling** (co-children sharing one
parent with `x` through edges of the same kind, labeled with the shared parent as `via`). No
transitive walk SHALL occur. Suggestion targets SHALL be `concrete = 1` nodes only, excluding the
line itself and ids already in the caller's to-buy set. Results SHALL be emitted in the fixed
precedence satisfies → `general`-kind siblings → generalizations → `containment`-kind siblings →
`membership`-kind siblings, lexicographic within each tier, deduplicated first-relation-wins, and
capped per line. Every suggestion SHALL carry its relation label (`role`, `kind`, and `via`). Each
sibling SHALL be annotated `in_pantry` (a pantry row exists for its resolved id) and, when the
caller's primary store has a warmed flyer rollup containing a matching item at the flyer reads'
default sale floor, an `on_sale_hint` with that item's price and savings; sibling annotation SHALL
issue no per-sibling Kroger search. The annotator SHALL be called by the **enriched to-buy read**
and its output returned as each to-buy line's `substitutes[]`, run over the **whole** to-buy set
with no per-line term-search budget and no Kroger product call.

#### Scenario: A specialization family surfaces as labeled general-kind siblings

- **WHEN** the graph holds `cabbage::color-green → cabbage`, `cabbage::type-napa → cabbage`, and
  `cabbage::color-red → cabbage` (kind `general`) and the line resolves to `cabbage::type-napa`
- **THEN** `cabbage::color-green` and `cabbage::color-red` are returned in that line's `substitutes[]`
  labeled `kind: "general"`, `via: "cabbage"`, and `cabbage` itself as a generalization when its
  node is concrete

#### Scenario: Broad membership families rank last and stay capped

- **WHEN** a line's only relations are membership co-children under a broad class parent
- **THEN** those siblings appear only within the per-line cap, after any higher-precedence tiers,
  each labeled with `via` naming the class parent

#### Scenario: Merged nodes are resolved before walking

- **WHEN** an edge endpoint's identity row carries a non-null `representative`
- **THEN** the annotator operates on the surviving id and never suggests a merged-away id

#### Scenario: A line with no graph neighbors fabricates nothing

- **WHEN** a line's resolved id has no edges (the common case in a sparse graph)
- **THEN** its `substitutes[]` is empty — no suggestion is invented outside the graph

### Requirement: Acting on a suggestion reuses existing writes only

The substitution surface SHALL introduce no new write operation and SHALL never apply a swap
implicitly. Accepting a same-identity alternative (in the order dialog) SHALL stage a `place_order`
`override` for that line (revalidated before the cart per the existing order contract); accepting a
cross-ingredient sibling on an explicit row (inline on the to-buy list) SHALL be the existing
`add_to_grocery_list` + `remove_from_grocery_list` writes; accepting one on a virtual
(`origin: "plan"`) row SHALL be the existing materialize add plus an order-scoped `exclude` of the
original. Because inline hints appear at list-review (before the flush), a virtual-row swap's
materialize add SHALL land immediately while its `exclude` is staged in client order state and
applied at the eventual `place_order`; no persisted suppression state SHALL be introduced.
Dismissals SHALL be per-session client state, never persisted. The matcher's resolve-only and
never-substitutes guarantees SHALL be unmodified.

#### Scenario: Same-identity swap becomes an order override

- **WHEN** the member accepts a cheaper same-identity alternative in the order dialog
- **THEN** the swap is staged as an `overrides` entry on the order commit — no server state changes
  until the order is placed, and the override is revalidated before the cart

#### Scenario: Cross-ingredient swap on a virtual row leaves the plan intact

- **WHEN** the member accepts a plan-derived (virtual) line's sibling swap inline on the list
- **THEN** the sibling is materialized as a grocery row immediately, the original's order-scoped
  `exclude` is staged and applied at the flush, the meal plan is untouched, and the original
  re-derives on later reads

### Requirement: Bounded upstream budget with honest pagination

The alternatives read SHALL issue at most one product revalidation plus one term search per
processed line, SHALL process at most a fixed per-call line budget (12), and SHALL return unprocessed
names in `remaining` so callers continue explicitly. When the caller has no resolvable Kroger
location, the alternatives read SHALL degrade rather than error: `location: null`, empty
alternatives. The substitute annotator (siblings + `in_pantry` + `on_sale_hint`) SHALL carry no such
budget — it is pure D1 plus a warmed-rollup KV read over the **whole** to-buy set, issuing zero
Kroger product calls, and SHALL NOT be paginated.

#### Scenario: Over-budget alternatives input is paginated, not truncated silently

- **WHEN** the caller requests alternatives for 20 lines
- **THEN** 12 are processed and the other 8 names are returned in `remaining`

#### Scenario: The annotator runs whole-list with no Kroger call

- **WHEN** the enriched to-buy read annotates a 30-line to-buy set
- **THEN** every line is annotated (no 12-line cap) from the identity graph, pantry, and warmed
  flyer rollup, with no Kroger product call issued

## REMOVED Requirements

### Requirement: Aisle-enriched to-buy read is opt-in and the default stays pure

**Reason**: Replaced by "Enriched to-buy read carries aisle placement and substitute hints", which
generalizes the opt-in enrichment (renaming `with_aisles`/`?aisles=1` to `enrich`/`?enrich=1`) to
carry substitute hints alongside aisle placement under the same single Locations resolve. The
default read stays byte-identical and zero-Kroger, unchanged.

### Requirement: Substitutions panel over the real read

**Reason**: The toolbar-triggered, online-only substitutions panel is dropped. Its cheap
sibling/pantry/sale half moves to inline hints on the to-buy list ("Inline substitute hints on the
to-buy list"), and its same-identity price alternatives move to the order dialog at preview time
("Same-identity alternatives surface in the order dialog").
