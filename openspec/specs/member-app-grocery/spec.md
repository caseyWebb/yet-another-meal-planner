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

The grocery route SHALL be a page header/launcher shell around the shared Grocery component and SHALL render the authoritative grocery snapshot: active and checked explicit/virtual lines, recipe attribution linking to detail, first-class household lines, pantry coverage and verification/Buy anyway, substitution decisions, underived slugs, grouped in-cart sends, and the bottom add row. It SHALL offer exactly **Department | Recipe** grouping; the previous Category/Aisle toggle SHALL be removed.

Department groups SHALL use store-placement presentation (`placement.section`, additively aliased from the prior placement-department field), order groups by minimum numeric aisle then label, put household/non-grocery rows in Household, and put missing placement last in Not mapped. Recipe attribution SHALL be ordered by planned date, meal-plan row id, then slug; a multi-recipe line SHALL appear once in its first recipe group with `+N`, and unattributed lines SHALL appear in No recipe. The default SHALL be Department; a remembered toggle is member-local pure view state.

Rows SHALL show check/strike-through, quantity, stable recipe attribution, note, Staple marker where present, remove for explicit rows, and anchored pantry-look-alike decisions. Header stats SHALL report To buy, Checked, and In carts; pre-send flyer hints and persisted send estimates SHALL remain distinctly labeled. The in-cart groups SHALL render between the active list and pantry coverage as specified by `grocery-list-widget`.

#### Scenario: The page shows plan-derived and explicit items as one list
- **WHEN** a member with a meal plan, an ad-hoc list row, a checked row, and pantry coverage opens the grocery page
- **THEN** they see shopping lines together with durable checked styling, the unchecked union-minus-pantry count, and covered items under the pantry section

#### Scenario: Department order is deterministic
- **WHEN** lines have aisle 8/Produce, aisle 2/Dairy, household kind, and no placement
- **THEN** the groups render Dairy, Produce, Household, and Not mapped in deterministic route/fallback order

#### Scenario: Recipe mode does not duplicate a line
- **WHEN** one line contributes to two recipes
- **THEN** it appears only in its first stable recipe group with the second represented as `+1`

#### Scenario: A stale perishable invites a real verification write
- **WHEN** a pantry-covered line is classified worth-a-look
- **THEN** Still good invokes pantry verification and Buy anyway invokes the coverage-override materialization operation rather than dismissing locally

#### Scenario: Household line stays out of pantry semantics
- **WHEN** a `kind:"household"` row renders
- **THEN** it appears under Household with list controls and no recipe or pantry-restock action

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

The grocery route SHALL launch the shared Order Review component/controller over a fresh empty-stage preview. The review SHALL render the mock's hierarchy: Kroger/store heading; Going to cart, transient Estimated total, and positive Flyer savings tiles; the stale-cart explanation and required “I've cleared the old Kroger cart” acknowledgement; matched lines; decision cards; and a sticky send summary. A line SHALL offer a quantity stepper only when quantity was assumed, a fixed quantity chip when user-specified, Skip/Add back, same-identity alternatives, and at most one featured staged swap. Decision cards SHALL expose same-identity brand choice and narrow Save preferred brand, or unavailable recovery through broader/manual catalog search with divergence and fulfillment notes. Undecided lines SHALL remain left off.

Every skip, quantity, candidate, broader/manual selection, Undo, and impulse addition SHALL remain local stage until final send; closing/reopening SHALL discard it and call a fresh preview. Saving a brand SHALL perform the narrow persistent write immediately. Final send SHALL require the current fingerprint and cleared-cart gate and SHALL never be offline-queued. A changed review SHALL replace the visible preview and require reconfirmation.

The confirmed screen SHALL appear only for `cart.written:true` and SHALL report independently: items sent to Kroger (not purchased), moved to In cart, exact learned mappings, authoritative saved brands, left-off lines that stayed to-buy, and the persisted send-record total/savings when available. Cart failure SHALL remain a review/error state and expose re-link on `reauth_required`. The only post-send navigation SHALL be **Back to grocery**; there SHALL be no Back to review. Reopening starts from current to-buy, whose sent rows are already excluded.

#### Scenario: Assumed and specified quantities render differently
- **WHEN** one preview line has assumed quantity and another has a user-specified package count
- **THEN** only the assumed line has a stepper and the specified line renders a fixed quantity chip

#### Scenario: Brand save is narrow and immediate
- **WHEN** a member chooses a same-identity candidate and enables Save preferred brand
- **THEN** the app calls the family-scoped save operation, adopts its authoritative result, and leaves all other review choices staged

#### Scenario: Unavailable line can be recovered without silent substitution
- **WHEN** broader or manual search returns candidates for an unavailable line
- **THEN** the app shows divergence/modality facts, requires an explicit selection, and leaves an unresolved line off the send

#### Scenario: Changed preview requires another confirmation
- **WHEN** final send returns `review_changed`
- **THEN** the app renders the refreshed preview/divergences, performs no success navigation, and requires the member to press Send again

#### Scenario: Failed cart is never confirmed
- **WHEN** commit returns `cart.written:false` with `reauth_required`
- **THEN** the app does not claim items moved or learned, keeps them to-buy, and offers Kroger re-link

#### Scenario: Sent review cannot be replayed
- **WHEN** a successful confirmation is closed with Back to grocery and Order review is opened again
- **THEN** a fresh empty-stage preview is fetched and the prior sent/staged set cannot be sent again from retained UI state

### Requirement: Grocery-power UI coverage runs without Kroger credentials

The app Playwright suite SHALL cover the shared Grocery and Order Review surfaces without Kroger credentials. Order Review SHALL use endpoint fixtures typed against the shared contracts for native-tier matched lines, assumed/specified quantity, stale-cart gate, choose-one/save, broader/manual recovery, impulse staging, preview divergence, honest cart/cache/send partial failures, and successful persisted-result confirmation. No product code SHALL add test-only Kroger behavior; matcher/order injected dependencies remain the unit seam.

#### Scenario: Review interactions use typed fixtures
- **WHEN** the app suite exercises review, search, save, changed-preview, failure, and success flows
- **THEN** requests and responses conform to the shared contracts and no external Kroger call occurs

#### Scenario: Visual coverage captures review and confirmation
- **WHEN** the Order Review Playwright scenarios run
- **THEN** reviewed screenshots cover the primary review, decision recovery, and honest confirmation states in the shared component

### Requirement: The grocery view renders a reified display name

The member grocery surfaces SHALL render a human label from stored/curated data, never a raw canonical id. A stored-row read (`read_grocery_list`) and the derived to-buy view SHALL render each line's label as the row's `display_name ?? name`; a `plan`-derived line (no stored row) and a line materialized by canonical id SHALL render the identity node's curated `display_name`. The **enriched** to-buy read SHALL expose the curated `display_name` for surfaces that previously rendered a bare canonical id as human text — the sibling-suggestion label and relation target, and the aisle/department grouping label. The **default** (non-enriched) to-buy view SHALL be unchanged: `GET /api/grocery/to-buy` and the `read_to_buy` tool SHALL still return the same lines via the same shared operation, with the reified display confined to the stored-row read and the enriched view — no default line field is added or re-sourced. The `display_name` SHALL never enter the set algebra, which continues to join on the canonical ids.

#### Scenario: Accepting a sibling swap renders the clean label, not the id

- **WHEN** the member accepts an inline substitute (a graph-sibling swap) and the app materializes it via `add_to_grocery_list` with the sibling's canonical `id` (e.g. `cabbage::color-red`)
- **THEN** the new grocery-list row renders as "Red cabbage" (its curated `display_name`), not `cabbage::color-red`, while still deduping and ordering on the canonical id

#### Scenario: The enriched view labels previously-raw-id surfaces

- **WHEN** the enriched to-buy view is read and a line carries substitute siblings and an aisle/department grouping
- **THEN** the sibling label, the relation target, and the department heading render curated human labels (via the node `display_name`) rather than bare canonical ids

#### Scenario: The default read_to_buy remains backward-compatible with additive grocery freshness

- **WHEN** the same tenant reads `read_to_buy` and `GET /api/grocery/to-buy` (default, non-enriched) with unchanged underlying data
- **THEN** both return the same lines via the same shared operation, each `to_buy[].name` is sourced exactly as before, and the additive checked/concurrency fields plus aggregate `snapshot_version` follow the canonical grocery freshness contract without requiring enriched placement or substitution fields

### Requirement: The grocery launcher is a projection of configured store adapters

The grocery page SHALL replace its independently-derived Kroger-only affordance with a fulfillment launcher that renders only the `launcher` entries returned by the shared store-adapter projection. It SHALL branch on each entry's `mode` and `enabled`/`disabled_reason` fields, not on raw profile preferences, Kroger token state, shared store rows, or satellite liveness. Kroger online order SHALL open Order Review only from an enabled `online_order` entry. A disabled entry SHALL remain visible with the projection's actionable reason; no unavailable path SHALL issue a fulfillment request.

The launcher SHALL keep the manual-shop fallback outside the adapter projection. Instacart SHALL have no launcher entry in this change. A Satellite entry with unavailable freshness SHALL be disabled, and an Offline walk entry SHALL identify the selected existing store without duplicating its identity.

#### Scenario: Kroger launcher state matches the Preferences card

- **WHEN** the projection reports Kroger connected with an exact preferred location and an enabled online-order entry
- **THEN** Grocery offers that Kroger order path and Profile shows the same connection/location from the same response

#### Scenario: Missing Kroger setup is actionable but inert

- **WHEN** the projection returns a Kroger entry disabled by `connect_kroger` or `choose_kroger_store`
- **THEN** the launcher shows the corresponding setup action/reason and does not open or post an order preview

#### Scenario: Unknown Satellite freshness disables launch

- **WHEN** a configured satellite entry has `session_fresh:null` and `satellite_freshness_unavailable`
- **THEN** the launcher shows the store as unavailable and sends no cart-fill request

#### Scenario: Instacart placeholder cannot leak into fulfillment

- **WHEN** the Profile card includes the `coming_soon` Instacart tab
- **THEN** the grocery launcher's entries contain no Instacart path

### Requirement: Store preference changes discard store-bound preview state

The Grocery page SHALL treat a successful standing-store change or Kroger disconnect as an invalidation boundary. It SHALL close an open Order Review, discard its local preview/disposition state, invalidate the shared adapter projection and enriched store-placement read, and preserve the underlying store-agnostic to-buy membership and grocery lifecycle rows. A subsequent Kroger Order Review SHALL start with a new preview under the current exact location.

#### Scenario: A store switch cannot commit an old preview

- **WHEN** the preferred location changes after a preview was resolved
- **THEN** that preview can no longer be committed, and the member must open a fresh preview resolved for the new location

#### Scenario: List membership survives a store switch

- **WHEN** the standing adapter changes from Kroger to an Offline store
- **THEN** the active/derived grocery set is unchanged while only placement and launcher presentation are re-derived

### Requirement: The member adapter respects write classifications

The member Grocery adapter SHALL register check/uncheck (including atomic virtual materialize-and-check), pantry verification/Buy anyway, persistent substitution accept/undo, and send-line relist as idempotent class-(b) canonical-key mutations with optimistic cache state and serial offline replay. Mark placed SHALL be online-only; while unavailable it SHALL show an offline hint and SHALL never enqueue. Every settled mutation SHALL reconcile both raw and snapshot grocery queries.

#### Scenario: Offline check renders optimistically
- **WHEN** a member checks a line offline
- **THEN** the shared component shows it checked immediately and the registered mutation pauses for serial replay

#### Scenario: Mark placed cannot queue
- **WHEN** a member is offline with an in-cart send visible
- **THEN** Mark order placed is disabled with an offline hint and no mutation-cache record is created

### Requirement: The Grocery page hosts a local active store walk

The Grocery route SHALL start a walk without a server round trip by minting a ULID and storing tenant-stamped local navigation `{session_id, store_slug, started_at, current_group, state}` while placing `mode=walk`, `walk`, and `store` in URL search. The local record SHALL NOT store an independent checked set; rendered/optimistic Grocery `checked_at` SHALL be the only item-progress truth. Pause SHALL exit walk mode while preserving row checks and the local record; the same device SHALL offer Resume, while another device MAY start a new shell over converged checked rows.

#### Scenario: Start offline creates no server session
- **WHEN** a member starts a walk from a persisted Grocery snapshot with zero connectivity
- **THEN** the URL/local shell starts immediately, no server walk-session write occurs, and item progress reads existing cached checked state

#### Scenario: Pause keeps progress
- **WHEN** a member pauses mid-walk and later resumes on the same device
- **THEN** local aisle navigation resumes and all picked state still comes from Grocery row checks

### Requirement: Active-walk presentation follows the approved local brief

Walk mode SHALL replace the normal page header with store display name, `N of M` progress, and an overall progress bar. It SHALL render route groups in resolved order, visually activate the first incomplete group, collapse completed groups to checked summaries while allowing reopen, preserve the existing checkbox/strikethrough row interaction, and trail Grab last plus Anywhere / Not mapped groups. It SHALL hide add/recipe grouping, order launcher/in-cart, underived, pantry coverage, and substitution panels. Check taps SHALL have no spinner; disconnection SHALL show a quiet "Offline — changes will sync" note.

#### Scenario: Mid-walk focuses the current aisle
- **WHEN** two aisle groups are complete and the next contains unchecked lines
- **THEN** the completed groups collapse, the next group is active, and global progress reflects the authoritative/optimistic row checks

#### Scenario: Walk hides decision panels
- **WHEN** walk mode is active
- **THEN** pantry coverage, substitutions, ordering, add-row, recipe grouping, and underived panels are absent without changing their underlying state

### Requirement: Finish has review, queued, receipt, and conflict states

Finish SHALL open a confirmation sheet showing checked/total counts, that unchecked items stay listed, verified pantry-restock semantics, and estimated-spend caveat. It SHALL freeze the exact checked keys, session id, store/mode, and occurred-at as the immutable logical request, and capture the rendered Grocery snapshot version as its initial delivery precondition. Online success SHALL render/adopt the durable receipt and authoritative snapshot, clear the local session, and exit walk mode.

Offline confirmation SHALL queue those immutable logical fields, set local state `pending_commit`, prevent edits to its captured lines, and show "Finishing when online" while retaining visibly pending checked rows rather than pretending they were consumed. After earlier queued checks settle, execution SHALL replace only the delivery snapshot precondition with the latest authoritative cached version; it SHALL NOT broaden the frozen keys or change session/store/time. Replay success SHALL adopt its receipt/snapshot and clear the session. A checked-set or idempotency conflict SHALL restore review/walk with fresh state and an actionable message; the app SHALL NOT broaden/retry the set automatically.

A generic transport failure SHALL retain the frozen request in `pending_commit` and expose an explicit Retry finish action that redelivers it independently of the current rendered checked rows. This SHALL recover a durable receipt when the server committed but its response was lost; it SHALL NOT mint a new event time or require the consumed rows to remain visible.

#### Scenario: Unchecked items remain after finish
- **WHEN** a member confirms 14 checked of 23 and commit succeeds
- **THEN** the receipt covers exactly 14 consumed rows and the nine unchecked rows remain on the list

#### Scenario: Offline finish remains visibly pending
- **WHEN** Finish is confirmed offline
- **THEN** one immutable queued mutation exists, the UI says it will finish online, and rows are not presented as authoritatively received before a receipt returns

#### Scenario: Reconnect conflict requires review
- **WHEN** the queued exact set no longer matches at replay
- **THEN** no partial effects occur and the page restores fresh checked state for explicit member review
