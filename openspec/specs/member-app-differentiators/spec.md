# member-app-differentiators Specification

## Purpose
TBD - created by archiving change member-app-differentiators. Update Purpose after archive.
## Requirements
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

### Requirement: Grocery page aisle grouping with honest unknowns

The grocery page SHALL offer aisle grouping over the enriched to-buy read: groups ordered by
numeric aisle for lines with placements; lines without aisle data SHALL collect in an
explicitly labeled "Aisle unknown" bucket sub-grouped by department — never a fabricated aisle
number. With no resolvable store location, grouping SHALL fall back to department groups, then
to the existing `kind` buckets. The page SHALL NOT present a multi-store picker: placements
are for the profile's primary Kroger store only, and non-Kroger stores have no deterministic
placement source. Check-off and in-cart behavior SHALL be unchanged from the shipped grocery
page.

#### Scenario: Unknown placements are labeled, not faked

- **WHEN** the list is aisle-grouped and some lines have no captured aisle
- **THEN** those lines render under "Aisle unknown" (sub-grouped by department when known)
  and no invented aisle number appears

#### Scenario: No linked store degrades to category grouping

- **WHEN** the tenant has no resolvable store location
- **THEN** the page groups by department where derivable and by `kind` otherwise, with no
  error and no store picker

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

### Requirement: Group-wide trending row with a minimum-signal guard

The system SHALL provide `GET /api/cookbook/trending` (session-gated, ETagged): a group-wide
`cooking_log` aggregation over a trailing window (default 60 days) — deliberately cross-tenant,
exposing per-recipe counts only (`cooks`, distinct-cook count, last cooked date) and never
which member cooked what. A recipe SHALL qualify only with at least 2 cooks or at least 2
distinct cooking tenants in the window; below the guard the trending set SHALL be empty rather
than ranking single cooks. Results SHALL be joined to the projected recipe index (unprojected
slugs dropped), filtered by the caller's overlay rejects, restricted to **meal candidates** —
recipes whose effective `course` includes `main` or is empty (fail-open for a not-yet-classified
recipe; trending is a meal-suggestion surface, and a component/sub-recipe the group cooked twice
is real history but not a meal to suggest) — and deterministically ordered
(cooks, then distinct cooks, then recency, then slug). The browse page SHALL consume this
read through the promoted "Recommended for you" panel (the "Trending" reason and the
per-row honest counts chip) — with no trending badge or chip fabricated when the trending
set is empty.

#### Scenario: Sparse production history yields an empty trending set

- **WHEN** the log holds only single-cook entries (e.g. two recipes, one cook each — the
  production state at design time)
- **THEN** the trending set is empty and the browse page renders no "Trending" promotion
  and no counts chip

#### Scenario: A repeat-cooked recipe trends with counts only

- **WHEN** a recipe logs 3 cooks across 2 tenants within the window
- **THEN** it appears in the trending set with `cooks: 3` and a distinct-cook count of 2, with
  no member identities exposed

#### Scenario: A rejected recipe never trends for that member

- **WHEN** a recipe qualifies group-wide but the caller has marked it rejected
- **THEN** it is absent from that caller's trending response

#### Scenario: A repeat-cooked non-main never trends

- **WHEN** a recipe whose effective `course` does not contain `main` and is non-empty (e.g. a
  fresh pasta dough classified `["side"]` or `["component"]`) logs 2+ cooks within the window
- **THEN** it is absent from the trending set, while a recipe with an empty (not-yet-classified)
  `course` that clears the signal guard still qualifies

### Requirement: Picked-for-you is a deterministic favorites-centroid ranking with zero AI calls

The system SHALL provide `GET /api/cookbook/picked-for-you` (session-gated, ETagged): a thin
wrap of the existing `rankCandidates` ranking using the normalized centroid of the caller's
stored favorite embeddings as the query vector — stored cron-captured vectors only, no
Workers AI or frontier-model call at request time. Candidates SHALL exclude the caller's
favorites, rejects, recipes conflicting with the profile's dietary avoids (the same gate
the propose pool applies), and recipes that are not **meal candidates** — those whose effective
`course` is non-empty and does not include `main` (fail-open for an empty, not-yet-classified
`course`; picked-for-you suggests meals, never a component/sub-recipe). With no favorites the
result SHALL be empty — no backfill from the general index — and the promoted panel SHALL
simply omit the "Picked for You" reason rather than inventing generic picks. The optional
nudge parameters `rankCandidates` carries for the propose flow SHALL be absent on this
call path.

#### Scenario: No favorites means no picked promotion

- **WHEN** the caller has no favorite recipes
- **THEN** the endpoint returns an empty list and the promoted panel renders without a
  "Picked for You" row — never generic picks

#### Scenario: Ranking touches no model at request time

- **WHEN** picked-for-you is computed
- **THEN** no `env.AI` call occurs — the query vector is a centroid of stored favorite
  embeddings and ranking runs over stored recipe vectors

#### Scenario: Favorites and rejects never appear as picks

- **WHEN** the caller favorites one recipe and rejects another
- **THEN** neither appears in the picked-for-you response

#### Scenario: A non-main never appears as a pick

- **WHEN** the embedded index contains a recipe whose effective `course` is non-empty and does
  not contain `main` (e.g. a pasta dough near the caller's favorites in embedding space)
- **THEN** it is absent from the picked-for-you response, while a recipe whose `course` is
  empty (not yet classified) remains eligible

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

### Requirement: The promoted panel repackages the differentiator signals as reason badges

The browse page SHALL render one visually distinct promoted panel captioned
"Recommended for you", each row an ordinary recipe row plus an uppercase **reason
badge** naming why it is promoted. The badge vocabulary SHALL be exactly: **"Just
Added"** (the new-for-me watermark read — discovery-attribution-based, unchanged),
**"Trending"** (the group-wide trending read with its minimum-signal guard verbatim),
and **"Picked for You"** (the favorites-centroid read). **"Popular with Friends" SHALL
NOT be rendered** — that reason requires the friend visibility lens and ships with the
change that lands it, not before.

Panel composition SHALL be a pure per-render derivation over those three session reads —
no new endpoint, no persistence, no pinning, and no dismissal state: at most **one row
per signal** — each signal's **top-ranked** row — in the fixed precedence Just Added →
Trending → Picked for You. A top row already promoted by a higher-precedence signal
contributes nothing (deduplicated, not re-badged), and a top row failing the active
global filters is dropped, never replaced by a deeper-ranked candidate — the panel
never misrepresents a signal's actual top recommendation. An empty signal likewise
contributes nothing — partial panels
are fine and no reason is ever backfilled from another signal or the general index.
Displayed promoted slugs SHALL be deduplicated out of the organic list below. The panel
SHALL hide entirely in search mode, in the favorites view mode, and when zero promoted
rows survive the filters.

Honest trend chips SHALL be preserved: a listed row (promoted or organic) that appears
in the guarded trending read carries the existing counts chip with its existing copy;
no trending badge or chip is fabricated when the trending set is empty.

#### Scenario: Reason badges ride real signals only

- **WHEN** the trending read returns a qualifying recipe and the caller has favorites
  (a non-empty picked-for-you) but nothing is new-for-me
- **THEN** the panel renders a "Trending" row and a "Picked for You" row, no "Just
  Added" row, and no "Popular with Friends" badge anywhere

#### Scenario: Promoted rows dedupe out of the organic list

- **WHEN** a recipe is displayed in the promoted panel
- **THEN** it does not appear again in the organic list below, and a slug qualifying for
  two signals appears once, badged with the higher-precedence reason

#### Scenario: The panel respects filters and hides when empty

- **WHEN** the active filters exclude every promoted candidate, or the page is in search
  mode or the favorites view
- **THEN** the promoted panel is absent entirely — no empty panel shell

#### Scenario: Sparse history yields no trending promotion

- **WHEN** the group cooking history is below the minimum-signal guard
- **THEN** no "Trending" row and no counts chip render anywhere on the page, and the
  panel shows only the other signals' rows (or hides if none survive)

