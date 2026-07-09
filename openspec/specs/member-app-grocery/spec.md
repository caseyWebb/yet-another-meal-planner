# member-app-grocery Specification

## Purpose
TBD - created by archiving change member-app-grocery. Update Purpose after archive.
## Requirements
### Requirement: The derived to-buy view is one shared read behind the endpoint and the tool

The system SHALL expose the derived to-buy view through one shared operation called by both
`GET /api/grocery/to-buy` (session-gated, ETagged) and a new MCP `read_to_buy` tool, computing
— at read time, with no stored expansion — the same set algebra `place_order` flushes: the
`active` grocery list ∪ the meal plan's derived ingredient needs − pantry on-hand, all joined on
canonical ingredient ids. The read SHALL be pure D1 work: no Workers AI call and no Kroger call.
Each to-buy line SHALL carry `origin` provenance (`list` — an explicit row the plan does not
need; `plan` — a virtual row derived from the plan with no stored row; `both` — a stored row the
plan also needs) and `for_recipes` attribution merged across sources. The view SHALL also
return: `pantry_covered` — the lines pantry on-hand cancels (the same set `place_order` reports
as `partials`), each joined with the pantry row's `quantity`/`category`/`last_verified_at` so
verification nudges are renderable; `in_cart` — the current `in_cart` rows (the stale-cart
signal); and `underived` — the planned recipe slugs whose full ingredient list is not yet
derived, so a gap is reported rather than silently under-listed.

#### Scenario: A virtual row follows the plan with no sync step

- **WHEN** a recipe is added to the meal plan and the to-buy view is read
- **THEN** the view contains `origin: "plan"` lines for that recipe's derived ingredients that
  the pantry does not cover, with the recipe's slug in `for_recipes`, without any grocery-list
  row having been written — and removing the recipe from the plan makes those lines disappear
  from the next read

#### Scenario: The tool and the endpoint return the same view

- **WHEN** the same tenant reads `read_to_buy` and `GET /api/grocery/to-buy` with unchanged
  underlying data
- **THEN** both return the same lines, produced by the same shared operation

#### Scenario: Pantry coverage is reported with verify metadata, not dropped

- **WHEN** a planned recipe needs an ingredient whose canonical id is in the pantry
- **THEN** the line appears under `pantry_covered` (not `to_buy`) carrying the pantry row's
  quantity and last-verified date, mirroring the `partials` set `place_order` would prompt on

#### Scenario: An underived planned recipe is surfaced honestly

- **WHEN** the meal plan contains a recipe whose `ingredients_full` facet has not yet been
  derived
- **THEN** the view lists that slug under `underived` and derives nothing for it, rather than
  silently omitting its needs

#### Scenario: The read makes no external calls

- **WHEN** the to-buy view is computed
- **THEN** no Kroger API request and no Workers AI call is made — the read is D1 (and the
  ingredient-resolver context) only

### Requirement: Editing or pinning a derived row materializes it as an explicit menu row

Editing a virtual (`origin: "plan"`) line — a quantity annotation, a note — or pinning it SHALL
materialize it through the existing grocery add upsert as an explicit `source: "menu"` row
carrying the derived `for_recipes`, keyed by the same canonical id, so the stored row and the
derived need merge in every subsequent read (`origin: "both"`) and in the order-time set
algebra; no duplicate line can arise. Materialization SHALL introduce no new write operation and
SHALL remain a replay-idempotent upsert keyed on the canonical id. A virtual row SHALL offer no
remove: "already have it" is a pantry write (the line then moves to `pantry_covered`), "not
cooking it" is a plan edit, and "not this order" is the order flow's order-scoped `exclude`.
A materialized row later removed SHALL re-derive as a virtual row while the plan still needs it.

#### Scenario: Editing a virtual row's quantity materializes it

- **WHEN** a member sets a quantity on an `origin: "plan"` line
- **THEN** an explicit `source: "menu"` row is upserted under the same canonical id with the
  derived `for_recipes` and the edited quantity, and the next view read shows the line as
  `origin: "both"` with exactly one entry for that ingredient

#### Scenario: Materialization replay converges

- **WHEN** the same materialize write is replayed (an offline mutation re-fired)
- **THEN** the row upserts to the same state with no duplicate created

#### Scenario: Removing a materialized row un-pins, not un-plans

- **WHEN** a member removes a previously materialized `source: "menu"` row while its recipe
  remains on the meal plan
- **THEN** the next view read derives the ingredient again as an `origin: "plan"` virtual row

### Requirement: The grocery page renders the derived view

The grocery page SHALL render from the to-buy view: the to-buy lines (explicit and virtual in
one list, virtual rows visually attributed to the plan, `for_recipes` linking to recipe detail),
the "Already in your pantry" section (coverage rows with a verify action for a stale-verified
perishable and a "buy fresh" action that materializes the item onto the list), the in-cart group
(with the existing clear-purchased removal), and the bottom add-row. The page SHALL surface the
view's `underived` slugs as a quiet notice rather than hiding them. Category grouping and the
P1 interactions (in-cart set, remove on explicit rows, add) SHALL continue to work unchanged;
store-picker aisle grouping and the substitutions panel remain out of scope (later phases).

#### Scenario: The page shows plan-derived and explicit items as one list

- **WHEN** a member with a meal plan, an ad-hoc list row, and pantry coverage opens the grocery
  page
- **THEN** they see the union minus pantry coverage as one to-buy list with virtual rows
  attributed to their recipes, and the covered items under "Already in your pantry" with their
  verify nudges

#### Scenario: A stale perishable invites verification

- **WHEN** a pantry-covered line's pantry row is a perishable last verified beyond the
  staleness window
- **THEN** the row is flagged with the unchecked duration and offers verify (pantry verify op)
  and buy-fresh (materialize) actions

### Requirement: Order preview and commit are thin adapters over the extracted place_order operation

The member app SHALL expose the order flow as `POST /api/grocery/order` — accepting the
`place_order` tool's input shape (`menu_needs`, `quantities`, `include_partials`, `overrides`,
`exclude`, `preview`) and returning its result shape — implemented by extracting the tool
closure into a shared operation and a deps builder (matcher resolve, SKU revalidation, location
resolution) that the MCP tool and the route both call, with the tool's observable behavior
unchanged. Preview and commit SHALL be the same endpoint discriminated by `preview` (the
operation's own contract). The endpoint SHALL be gated to Kroger-online fulfillment: a
non-Kroger primary receives a structured error directing to the appropriate flow, never a cart
write. The commit mutation SHALL be online-only — never queued or replayed by the offline
mutation layer — because the cart write is not idempotent.

#### Scenario: Preview resolves without writing

- **WHEN** the app posts the order endpoint with `preview: true`
- **THEN** the response carries resolved lines (fresh price/on-sale), the checkpoint batch,
  partials, and underived slugs, and no cart write, SKU-cache commit, or list advancement
  occurs

#### Scenario: The endpoint and the tool share one operation

- **WHEN** the same tenant submits the same order input through the MCP tool and the endpoint
- **THEN** both produce the same result via the same shared operation, and the pre-existing
  tool tests pass unmodified

#### Scenario: A non-Kroger tenant cannot flush a cart

- **WHEN** a tenant whose primary store is not Kroger-online posts the order endpoint
- **THEN** the response is a structured error naming the correct flow, and nothing is resolved
  or written

#### Scenario: A commit is never replayed offline

- **WHEN** the app goes offline with an order commit in flight or attempted
- **THEN** the commit is not persisted for replay; on reconnect the UI refetches the list and
  view (whose `in_cart` state reflects only lines the cart write actually took)

### Requirement: The order UI renders dispositions and honest partial results

The order dialog SHALL lead with the stale-cart warning when the view's `in_cart` section is
non-empty (the cart API is write-only — the member clears the store cart manually). Preview
SHALL render each disposition surface: checkpoint items with their candidate lists (choice →
commit `overrides`), pantry partials (confirm → `include_partials`), assumed-quantity lines
(count → `quantities`), and per-line exclusion (→ `exclude`). After commit the UI SHALL report
each write independently and honestly: it SHALL never present the cart as populated when
`cart.written` is false; a `reauth_required` cart failure SHALL render the Kroger re-link
affordance over the existing login-url read; lines the cart took SHALL show as advanced to
in-cart. The in-cart group SHALL offer the user-asserted "order placed" advance — the member
route accepting `status: "ordered"` — enforced by the shared transition guard (legal only from
`in_cart`, stamping `ordered_at`).

#### Scenario: A checkpoint item is dispositioned, not dropped

- **WHEN** preview returns an ambiguous item with candidates
- **THEN** the dialog renders the candidates for choice and the commit carries the chosen SKU
  as an override; an undispositioned checkpoint item is simply not carted, and the UI says so

#### Scenario: A failed cart write is reported truthfully

- **WHEN** commit returns `cart.written: false` with `code: "reauth_required"`
- **THEN** the UI does not claim the cart is populated, shows the items as still to-buy, and
  offers the Kroger re-link flow

#### Scenario: Mark order placed advances only from in_cart

- **WHEN** the member asserts the order was placed on the in-cart group
- **THEN** each item advances `in_cart → ordered` with `ordered_at` stamped via the guarded
  shared operation, and an attempt against a non-`in_cart` row is rejected with the structured
  transition error

### Requirement: Grocery-power UI coverage runs without Kroger credentials

The app Playwright suite SHALL cover this change's surfaces without any Kroger credential or
external call: the derived to-buy view, pantry coverage, materialization, and mark-order-placed
SHALL run live against the seeded local Worker (the shared seed gaining recipes with derived
full ingredient lists, meal-plan rows, pantry rows including a stale-verified perishable, and
grocery rows); the order dialog SHALL be driven by intercepting the order endpoint and
fulfilling fixtures typed against the operation's exported result shape (a clean resolve, a
checkpoint/partials/assumed-quantity batch, and a failed-cart `reauth_required` result). No
product code SHALL grow test-only Kroger fakes for this; the operation seam (injected deps)
remains the unit-test surface.

#### Scenario: The to-buy view is exercised end-to-end offline

- **WHEN** the Playwright suite runs the grocery specs against the seeded `wrangler dev`
- **THEN** virtual rows, pantry coverage with a verify nudge, and materialize-on-edit render
  from real Worker computation with no network egress

#### Scenario: The order dialog is exercised against typed fixtures

- **WHEN** the order specs run
- **THEN** the order endpoint is intercepted with fixtures that type-check against the shared
  operation's result type, covering the disposition surfaces and the honest-failure rendering
  without any Kroger call

### Requirement: The grocery view renders a reified display name

The member grocery surfaces SHALL render a human label from stored/curated data, never a raw canonical id. A stored-row read (`read_grocery_list`) and the derived to-buy view SHALL render each line's label as the row's `display_name ?? name`; a `plan`-derived line (no stored row) and a line materialized by canonical id SHALL render the identity node's curated `display_name`. The **enriched** to-buy read SHALL expose the curated `display_name` for surfaces that previously rendered a bare canonical id as human text — the sibling-suggestion label and relation target, and the aisle/department grouping label. The **default** (non-enriched) to-buy view SHALL be unchanged: `GET /api/grocery/to-buy` and the `read_to_buy` tool SHALL still return the same lines via the same shared operation, with the reified display confined to the stored-row read and the enriched view — no default line field is added or re-sourced. The `display_name` SHALL never enter the set algebra, which continues to join on the canonical ids.

#### Scenario: Accepting a sibling swap renders the clean label, not the id

- **WHEN** the member accepts an inline substitute (a graph-sibling swap) and the app materializes it via `add_to_grocery_list` with the sibling's canonical `id` (e.g. `cabbage::color-red`)
- **THEN** the new grocery-list row renders as "Red cabbage" (its curated `display_name`), not `cabbage::color-red`, while still deduping and ordering on the canonical id

#### Scenario: The enriched view labels previously-raw-id surfaces

- **WHEN** the enriched to-buy view is read and a line carries substitute siblings and an aisle/department grouping
- **THEN** the sibling label, the relation target, and the department heading render curated human labels (via the node `display_name`) rather than bare canonical ids

#### Scenario: The default read_to_buy is unchanged

- **WHEN** the same tenant reads `read_to_buy` and `GET /api/grocery/to-buy` (default, non-enriched) with unchanged underlying data
- **THEN** both return the same lines via the same shared operation, with no new field on the default line and each `to_buy[].name` sourced exactly as before

