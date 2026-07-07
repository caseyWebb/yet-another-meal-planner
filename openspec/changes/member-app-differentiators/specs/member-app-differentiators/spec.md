## ADDED Requirements

### Requirement: Deterministic substitution suggestions behind one shared read

The system SHALL expose substitution suggestions through one shared operation called by both a
new coarse MCP tool `suggest_substitutions` and `POST /api/grocery/substitutions`
(session-gated). For each requested to-buy line (caller-supplied `names` resolved through the
ingredient funnel, or — when absent — the caller's current derived to-buy set), the read SHALL
return: the line's current pick (the location-preferred cached SKU mapping, revalidated for
fresh price/fulfillment/aisle) with a `status` of `ok` | `current_unavailable` |
`no_cached_pick`; same-identity alternatives from exactly one term search, filtered to
fulfillable products, ranked by the existing `compareUnitPrice` core (promo price when on
sale), capped; and cross-ingredient sibling suggestions from the identity-graph walk. Each
alternative SHALL carry a closed, deterministic reason vocabulary — `cheaper` (strictly lower
unit price than the current pick, only when both ranked comparable in one dimension),
`on_sale` (promo price below regular), `in_stock` (fulfillable while the current pick is
unavailable) — and no other reason values; qualitative reasons (e.g. "lower fat") SHALL NOT be
produced by this surface. The read SHALL be read-only: it never writes the cart, the SKU cache,
the grocery list, or any other store.

#### Scenario: A cheaper comparable alternative is flagged with real numbers

- **WHEN** a line's current pick unit-prices at $0.42/oz and a fulfillable search candidate of
  the same dimension unit-prices at $0.31/oz
- **THEN** the candidate is returned as an alternative with `reasons` containing `cheaper` and
  both items' `unit_price`/`base_unit` present, ranked by the `compareUnitPrice` core

#### Scenario: An out-of-stock current pick yields in-stock alternatives

- **WHEN** the cached SKU revalidates as unavailable at the caller's location
- **THEN** the line returns `status: "current_unavailable"` and its fulfillable alternatives
  carry the `in_stock` reason

#### Scenario: No cached pick degrades honestly

- **WHEN** a line has no SKU-cache mapping at the caller's location (nor a legacy untagged one)
- **THEN** the line returns `status: "no_cached_pick"` with `current: null`, alternatives from
  the term search are still returned, and no `cheaper` reason is produced (there is nothing to
  compare against)

#### Scenario: The tool and the endpoint return the same suggestions

- **WHEN** the same tenant calls `suggest_substitutions` and `POST /api/grocery/substitutions`
  with the same input and unchanged underlying data
- **THEN** both return the same suggestions, produced by the same shared operation

### Requirement: Sibling suggestions are a labeled depth-1 walk over the persisted identity graph

Sibling suggestions SHALL be computed over the persisted schema — `ingredient_edge(from_id,
to_id, kind ∈ {general, containment, membership})` with every endpoint first resolved through
the `ingredient_identity.representative` union-find pointer — and SHALL comprise exactly three
depth-1 relations for a resolved line id `x`: **satisfies** (`from_id`s of edges into `x`, any
kind — usable where `x` is requested), **generalization** (`to_id`s of `x`'s outgoing `general`
or `containment` edges; `membership` targets excluded), and **sibling** (co-children sharing
one parent with `x` through edges of the same kind, labeled with the shared parent as `via`).
No transitive walk SHALL occur (depth is one edge, or two edges through one shared parent).
Suggestion targets SHALL be `concrete = 1` nodes only, excluding the line itself and ids
already in the caller's to-buy set. Results SHALL be emitted in the fixed precedence
satisfies → `general`-kind siblings → generalizations → `containment`-kind siblings →
`membership`-kind siblings, lexicographic within each tier, deduplicated first-relation-wins,
and capped per line. Every suggestion SHALL carry its relation label (`role`, `kind`, and `via`
for siblings) — the walk proposes and names the relation; fitness judgment stays with the
member or the LLM. Each sibling SHALL be annotated `in_pantry` (a pantry row exists for its
resolved id) and, when the caller's primary store has a warmed flyer rollup containing a
matching item, an `on_sale_hint` with that item's price and savings; sibling annotation SHALL
issue no per-sibling Kroger search.

#### Scenario: A specialization family surfaces as labeled general-kind siblings

- **WHEN** the graph holds `cabbage::color-green → cabbage`, `cabbage::type-napa → cabbage`,
  and `cabbage::color-red → cabbage` (kind `general`) and the line resolves to
  `cabbage::type-napa`
- **THEN** `cabbage::color-green` and `cabbage::color-red` are returned as siblings labeled
  `kind: "general"`, `via: "cabbage"`, and `cabbage` itself is returned as a generalization
  when its node is concrete

#### Scenario: Broad membership families rank last and stay capped

- **WHEN** a line's only relations are membership co-children under a broad class parent
  (e.g. `vegetables`)
- **THEN** those siblings appear only within the per-line cap, after any suggestions from
  higher-precedence tiers, each labeled with `via` naming the class parent

#### Scenario: Merged nodes are resolved before walking

- **WHEN** an edge endpoint's identity row carries a non-null `representative`
- **THEN** the walk operates on the surviving id and never suggests a merged-away id

#### Scenario: A line with no graph neighbors fabricates nothing

- **WHEN** a line's resolved id has no edges (the common case in a sparse graph)
- **THEN** its `siblings` array is empty and the price/availability suggestions are returned
  alone — no suggestion is invented outside the graph

### Requirement: Acting on a suggestion reuses existing writes only

The substitution surface SHALL introduce no new write operation and SHALL never apply a swap
implicitly. Accepting a same-identity alternative SHALL stage a `place_order` `override` for
that line (revalidated before the cart per the existing order contract); accepting a
cross-ingredient sibling on an explicit row SHALL be the existing add + remove row writes;
accepting one on a virtual (`origin: "plan"`) row SHALL be the existing materialize add plus an
order-scoped `exclude` of the original (no persisted suppression state). Dismissals SHALL be
per-session client state, never persisted. The matcher's resolve-only and never-substitutes
guarantees SHALL be unmodified: a suggestion reaches the cart only as an explicit
caller-supplied override or list row.

#### Scenario: Same-identity swap becomes an order override

- **WHEN** the member accepts a cheaper same-identity alternative in the panel
- **THEN** the swap is staged as an `overrides` entry on the order commit — no server state
  changes until the order is placed, and the override is revalidated before the cart

#### Scenario: Cross-ingredient swap on a virtual row leaves the plan intact

- **WHEN** the member swaps a plan-derived (virtual) line for a sibling
- **THEN** the sibling is materialized as a grocery row and the original is excluded
  order-scoped only — the meal plan is untouched and the original re-derives on later reads

### Requirement: Bounded upstream budget with honest pagination

The substitution read SHALL issue at most one product revalidation plus one term search per
processed line, SHALL process at most a fixed per-call line budget (12), and SHALL return
unprocessed names in `remaining` so callers continue explicitly. When the caller has no
resolvable Kroger location, the read SHALL degrade rather than error: `location: null`, empty
price/availability sections, with sibling suggestions, pantry annotations, and
primary-store flyer hints still served.

#### Scenario: Over-budget input is paginated, not truncated silently

- **WHEN** the caller requests 20 lines
- **THEN** 12 are processed and the other 8 names are returned in `remaining`

#### Scenario: A walk-store tenant still gets the graph half

- **WHEN** a tenant with no Kroger location calls the read
- **THEN** the result carries `location: null` and sibling suggestions computed from the
  identity graph and pantry, with no Kroger product call issued

### Requirement: Aisle-enriched to-buy read is opt-in and the default stays pure

`read_to_buy` SHALL accept an optional `with_aisles` flag (`?aisles=1` on
`GET /api/grocery/to-buy`); when absent the read SHALL be unchanged, preserving its zero-Kroger
guarantee. When set, each to-buy line SHALL gain a `placement` — aisle fields
(`aisle_number`/`aisle_description`/`aisle_side`) read from the `sku_cache` row at the line's
key and the caller's location (with legacy untagged fallback), and a `department` derived from
the identity graph: the resolved key's parents via outgoing edges with precedence
`membership` → `general` → `containment`, representative-resolved, lexicographic tiebreak,
absent when the key has no parent. The enriched read SHALL cost at most one Kroger Locations
resolve (label → locationId) and zero product searches, and SHALL return the resolved
`location` (or null, in which case placements carry `department` only).

#### Scenario: The default read is byte-identical

- **WHEN** `read_to_buy` is called without `with_aisles`
- **THEN** the result is exactly the pre-existing view shape with no Kroger call of any kind

#### Scenario: A cached line carries its captured aisle

- **WHEN** the line's key has an aisle-tagged `sku_cache` row at the caller's location
- **THEN** the line's `placement` carries that row's aisle number and description

#### Scenario: An uncaptured line falls back to a graph department

- **WHEN** the line's key has no aisle data but has a membership parent (e.g. `flour`)
- **THEN** `placement.department` is that parent and the aisle fields are absent

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

### Requirement: Substitutions panel over the real read

The grocery page SHALL render the substitutions panel on explicit member action (the toolbar
trigger), fetching the substitution read online-only (never offline-queued or replayed). Each
suggestion row SHALL show the original and proposed items with the deterministic reason and
real prices (unit price for `cheaper` claims), sibling rows labeled with their relation and
`via` parent plus pantry/sale annotations, per-row accept and dismiss, a dismiss-all, and the
empty state when no suggestion exists. Accepts SHALL map to the real write semantics per line
origin; dismissals SHALL be per-session only.

#### Scenario: The panel substantiates "cheaper" with numbers

- **WHEN** a suggestion's reason is `cheaper`
- **THEN** the row shows both unit prices (proposed vs current), not a bare claim

#### Scenario: No suggestions renders the empty state

- **WHEN** the read returns no suggestions for the current list
- **THEN** the panel shows the empty-state copy instead of an empty container

### Requirement: Group-wide trending row with a minimum-signal guard

The system SHALL provide `GET /api/cookbook/trending` (session-gated, ETagged): a group-wide
`cooking_log` aggregation over a trailing window (default 60 days) — deliberately cross-tenant,
exposing per-recipe counts only (`cooks`, distinct-cook count, last cooked date) and never
which member cooked what. A recipe SHALL qualify only with at least 2 cooks or at least 2
distinct cooking tenants in the window; below the guard the trending set SHALL be empty rather
than ranking single cooks. Results SHALL be joined to the projected recipe index (unprojected
slugs dropped), filtered by the caller's overlay rejects, and deterministically ordered
(cooks, then distinct cooks, then recency, then slug). The browse page's first slot SHALL
render "New & trending": the existing new-for-me items first, then trending backfill,
deduplicated and capped — with no trending badge fabricated when the trending set is empty.

#### Scenario: Sparse production history yields an empty trending set

- **WHEN** the log holds only single-cook entries (e.g. two recipes, one cook each — the
  production state at design time)
- **THEN** the trending set is empty and the browse row renders new-for-me content alone

#### Scenario: A repeat-cooked recipe trends with counts only

- **WHEN** a recipe logs 3 cooks across 2 tenants within the window
- **THEN** it appears in the trending set with `cooks: 3` and a distinct-cook count of 2, with
  no member identities exposed

#### Scenario: A rejected recipe never trends for that member

- **WHEN** a recipe qualifies group-wide but the caller has marked it rejected
- **THEN** it is absent from that caller's trending response

### Requirement: Picked-for-you is a deterministic favorites-centroid ranking with zero AI calls

The system SHALL provide `GET /api/cookbook/picked-for-you` (session-gated, ETagged): a thin
wrap of the existing `rankCandidates` ranking using the normalized centroid of the caller's
stored favorite embeddings as the query vector — stored cron-captured vectors only, no
Workers AI or frontier-model call at request time. Candidates SHALL exclude the caller's
favorites, rejects, and recipes conflicting with the profile's dietary avoids (the same gate
the propose pool applies). With no favorites the result SHALL be empty — no backfill from the
general index — and the browse row SHALL render its empty state inviting favorites. The
optional nudge parameters `rankCandidates` carries for the propose flow SHALL be absent on
this call path.

#### Scenario: No favorites means an honest empty row

- **WHEN** the caller has no favorite recipes
- **THEN** the endpoint returns an empty list and the row renders the favorite-a-few empty
  state rather than generic picks

#### Scenario: Ranking touches no model at request time

- **WHEN** picked-for-you is computed
- **THEN** no `env.AI` call occurs — the query vector is a centroid of stored favorite
  embeddings and ranking runs over stored recipe vectors

#### Scenario: Favorites and rejects never appear as picks

- **WHEN** the caller favorites one recipe and rejects another
- **THEN** neither appears in the picked-for-you response

### Requirement: Browse slots are filled without layout change

The browse page SHALL render the trending and picked-for-you rows in the two section slots the
member core shipped, preserving the section/list structure: slot one as "New & trending" and
slot two as "Picked for you" with its sub-copy and empty state. The full-index "All recipes"
section SHALL remain available on the page. Search behavior (browse hidden while a query is
active) SHALL be unchanged.

#### Scenario: The slots swap content, not structure

- **WHEN** the browse page renders after this change
- **THEN** the sections use the same section/list components as before, with "New & trending"
  first, "Picked for you" second, and "All recipes" still reachable below
