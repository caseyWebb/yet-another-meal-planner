# member-app-core Specification

## Purpose
TBD - created by archiving change member-app-core. Update Purpose after archive.
## Requirements
### Requirement: Member pages are served by session-gated JSON routes over named existing operations

The member app's pages SHALL be served by per-area Hono JSON route groups chained under the
member `/api` mount, all gated by the member session middleware to a resolved tenant, and each
endpoint SHALL call a **named, throw-free `src/` operation function** — the same functions the
MCP tools call. No route SHALL touch `env.DB` directly or re-implement tool logic inline. Where
an operation today exists only inside an MCP tool closure (`read_recipe` assembly, `log_cooked`,
the `update_preferences` apply, the `read_user_profile` assembly, night-vibe add/update,
`confirm_proposal`), it SHALL be extracted into a shared operation the tool and the route both
call, with the tool's observable behavior unchanged. Structured `ToolError` codes SHALL map to
HTTP statuses in the shared middleware, and error bodies SHALL keep the structured code so the
SPA branches on `error`, never on status text. Route groups SHALL export their types so the SPA
consumes them via `hc` with `import type` only.

#### Scenario: An endpoint is a thin adapter over a shared op

- **WHEN** any member `/api` endpoint handles a request
- **THEN** it resolves the session tenant, calls the named operation from the change's
  page→endpoint→op map, and returns the op's data — with no direct D1 access and no duplicated
  tool logic in the handler

#### Scenario: Closure extraction preserves tool behavior

- **WHEN** an MCP tool whose logic was extracted into a shared operation is invoked after the
  change
- **THEN** its params, return shape, and structured errors are byte-for-byte compatible with its
  prior behavior, and the pre-existing Worker tests pass unmodified

#### Scenario: A structured error crosses the HTTP boundary intact

- **WHEN** an operation throws a structured `ToolError` (e.g. `not_found`)
- **THEN** the response carries the mapped HTTP status and a body containing the structured
  `error` code and message

### Requirement: Cookbook browse and keyword search

The app SHALL serve a cookbook index endpoint (the shared recipe index projected to the compact hit shape — including `time_total` — title-sorted), a keyword search endpoint reusing the cookbook's field-weighted keyword ranking, and a new-for-me endpoint reusing the per-member discovery read with its last-planned watermark — every one of them over the caller's **visibility lens** (the shared enforcement point; under self-hosted this is the full attached corpus, today's behavior). Each index/search hit SHALL additionally carry its `provenance` for the caller's household — `own`, `friend`, or `curated`, the highest-precedence grant that admits it — so list surfaces can render curated (and later friend) provenance without a second read. Search SHALL be keyword-only — no request-time embedding — and SHALL keep the debounced-against-API behavior (the mock's in-memory keystroke search is a painted door, not a contract).

The browse page SHALL be **one unified, filterable list**: search bar → global filter bar → the promoted "Recommended for you" panel (see `member-app-differentiators`) → a single flat, title-sorted organic list over the caller's visible index. The page SHALL NOT render sectioned browse lists ("New & trending" / "Picked for you" / "All recipes"). Rows whose provenance is `curated` SHALL render a visible "Curated" badge on the shared RecipeRow (beside the facet chips, the promo-badge slot treatment).

**Filter bar.** A cuisine select and a protein select — options derived from the loaded (lens-visible) corpus (distinct non-null values, sorted, "All cuisines"/"All proteins" defaults), never from the authoring vocabulary — and a time segmented control (Any / ≤20 / ≤30 / ≤45). One global filter state SHALL apply to search results, the promoted panel (per-row), the organic list, and the favorites view. A recipe with no numeric `time_total` SHALL fail any active time filter — an unknown-time recipe is never claimed under a time budget. A "Clear" affordance and an "N of M match" count label SHALL render only while at least one filter is active; the filtered-empty states ("No recipes match these filters." / "None of your favorites match these filters.") SHALL repeat an inline "Clear filters" link.

**Search mode.** A non-empty query SHALL replace browse mode (the promoted panel hidden): a result-count line over the filtered results, the "No matches" empty state ("Nothing matches "{q}". Try a protein, a cuisine, or an ingredient."), and a clear button. Active filters SHALL remain visible and AND onto the search results.

**URL state.** All shareable page state — the query, the cuisine/protein/time filters, and the favorites view toggle — SHALL live in validated URL search params with default values stripped from the URL, so every combination is shareable and deep-linkable; loading such a URL SHALL reproduce the state. Transient input (the un-debounced search text) stays client-local.

#### Scenario: Search parity with the public cookbook

- **WHEN** a member searches the cookbook in the app
- **THEN** the results come from the same pure keyword ranker the public `/cookbook` search serves, returning the same hit shape — over the member's lens rather than the anonymous lens

#### Scenario: Browse renders only lens-visible rows

- **WHEN** a SaaS member browses the cookbook while a non-friend household holds recipes the member's household does not
- **THEN** those recipes appear nowhere on the page — not in the organic list, search results, filter option derivation, or the promoted panel

#### Scenario: Curated rows are badged

- **WHEN** the browse or search list renders a row whose only grant for the caller's household is the curated tenant's
- **THEN** the row carries the "Curated" provenance badge beside its facet chips

#### Scenario: One flat organic list replaces the browse sections

- **WHEN** the browse page renders with no query, no filters, and the default view
- **THEN** below the promoted panel there is exactly one flat, title-sorted recipe list over the visible index (minus rows displayed in the panel), with no section headings

#### Scenario: Filters narrow every surface with an honest time gate

- **WHEN** the member selects cuisine "italian" and time "≤30"
- **THEN** the organic list, the promoted panel's rows, the favorites view, and any search results show only italian recipes with a numeric `time_total` ≤ 30 — a recipe lacking `time_total` is excluded — and the "N of M match" count and Clear affordance render

#### Scenario: Filter and view state is shareable by URL

- **WHEN** a member loads a URL carrying query/filter/view search params (e.g. `/?cuisine=italian&time=30`)
- **THEN** the page renders with exactly that state applied, and interacting with the controls updates the URL params (defaults stripped) without a full reload

### Requirement: Recipe detail with notes, similar recipes, and the Cook-with-Claude deep link

The recipe detail page SHALL render the recipe's overlay-merged frontmatter, its derived
description, and its markdown body from the shared corpus; a Similar Recipes section computed by
the existing pure cosine over cron-captured embeddings (same floor and cap as the public
cookbook); and the group-aggregated notes for the recipe — the caller's own notes (including
private ones) editable and deletable, other members' shared notes read-only, per the existing
privacy rule. Anything conversational SHALL deep-link out to Claude (a link to
`claude.ai/new` prefilled with the cook command and slug) — the app SHALL NOT embed a model or
make any model call for the detail page. The page SHALL ALSO offer an in-app "Start Cooking" entry
that mounts the SAME shared guided cook-mode component the in-chat recipe card uses (mise-en-place
check-off, step-by-step navigation with a progress indicator, and per-step timers), when the recipe
body yields steps; its step data is parsed from the body client-side. This in-app cook mode is
presentational — its check-offs and timers are client-local — and it sits alongside, not replacing,
the Cook-with-Claude deep link and the existing favorite / add-to-plan / log-as-cooked controls.

#### Scenario: Detail is assembled from existing ops

- **WHEN** a member opens a recipe
- **THEN** the page data comes from the shared corpus read merged with the caller's overlay plus
  the derived description, and the similar list from the pure nearest-neighbor computation —
  with no new ranking logic

#### Scenario: Note privacy is preserved across the group

- **WHEN** the notes section loads
- **THEN** it contains every member's shared notes and only the caller's private notes, and edit
  and delete affordances appear only on the caller's own notes

#### Scenario: Cooking is a deep link, not a model call

- **WHEN** a member taps "Cook with Claude"
- **THEN** the app opens the Claude deep link for the recipe and issues no model request of its
  own

#### Scenario: In-app cook mode walks the recipe without a model call

- **WHEN** a member taps "Start Cooking" on a recipe whose body yields steps
- **THEN** the page mounts the shared cook-mode component and walks the mise-en-place, steps, and
  completion locally, making no model call, while the deep link and existing favorite/log/plan
  controls remain available

### Requirement: Favorites are an explicit idempotent set

The app SHALL list the member's favorites from the per-tenant overlay joined to the
cookbook index, and SHALL write favorite state as an **explicit set**
(`{ slug, favorite: boolean }`) keyed by the recipe slug — never a toggle — so an
offline-replayed mutation converges to the intended state.

Favorites SHALL render as a **cookbook view mode** (`?view=favorites`, a validated URL
search param): the organic list is replaced by the member's favorites with the global
filter state applied, the promoted panel is hidden, and the empty copy swaps — zero
favorites overall renders "No favorites yet / Tap the heart on any recipe to save it
here."; favorites that are all excluded by active filters render "None of your favorites
match these filters." with the inline "Clear filters" link.

The view mode's entry control is a **tab row** (the design-requests #1 bundle's
committed form) between the search bar and the filter bar: `role="tablist"` labeled
"Cookbook view" with two `role="tab"` buttons — "All recipes" and "Favorites" — whose
`aria-selected` reflects the active view, styled as a brand-color underline on the
active tab. The Favorites tab SHALL carry a heart icon (filled while the view is
active) and a mono count pill showing the member's **total** favorites count (the
unfiltered overlay∩index join — the same source the view lists), hidden when the member
has none. The row reads as a scope switch, not another AND-filter: the global filters
stay mounted and apply inside the favorites view. Selecting a tab SHALL write the
`view` search param (the `all` default stripped from the URL) without a full reload.

The standalone `/favorites` route SHALL redirect to the favorites view mode
(`/?view=favorites`), preserving any other search params it was given, and the sidebar
SHALL NOT carry a Favorites nav entry — the cookbook tab row is the one entry point.

#### Scenario: Replaying a favorite write converges

- **WHEN** the same favorite-set mutation is applied twice (e.g. an offline replay after
  a successful first delivery)
- **THEN** the overlay ends in the same state as after one application

#### Scenario: The favorites view mode filters favorites and hides the panel

- **WHEN** a member with favorites opens `/?view=favorites` with an active filter
- **THEN** only favorites passing the filter render, the promoted panel is absent, and
  clearing the filter shows all favorites

#### Scenario: Both favorites empty states render the specced copy

- **WHEN** the favorites view is open with zero favorites overall, or with favorites
  that all fail the active filters
- **THEN** the page renders "No favorites yet / Tap the heart on any recipe to save it
  here." in the first case and "None of your favorites match these filters." with an
  inline "Clear filters" link in the second

#### Scenario: The tab row switches the view and reflects it

- **WHEN** a member selects the Favorites tab and then the All recipes tab
- **THEN** the URL gains `view=favorites` and the list becomes the favorites with the
  promoted panel hidden, the Favorites tab showing `aria-selected="true"` and the
  filled heart — and switching back strips the param, restores the organic list and
  panel, and moves `aria-selected` to All recipes

#### Scenario: The count pill is the honest total favorites count

- **WHEN** the member has N > 0 favorites
- **THEN** the Favorites tab's pill reads N regardless of any active filters, and with
  zero favorites no pill renders

#### Scenario: /favorites redirects into the view mode

- **WHEN** a member opens `/favorites`, with or without other search params
- **THEN** they land on `/?view=favorites` with those params preserved and the
  favorites view active

### Requirement: Meal plan page over row-level ops

The meal plan page SHALL read the tenant's planned rows and mutate them through the existing
row-level ops keyed by the **plan-row id** (client-mintable ULID; the class (b) replay key), with
slug-addressed ops keeping their defined fan-out (remove-by-slug drops all matching rows;
set-by-slug requires a unique match or returns candidates — the `meal-planning` capability): add
(id-keyed, preserving the new-for-me watermark stamp on add exactly as the MCP tool does),
remove, schedule and **unschedule** a slot, and add and **remove** open-world sides (via the
`set` op). Slot provenance (`from_vibe`) and the row's `meal` SHALL be preserved across page
edits unless explicitly changed.

The page SHALL render the meal dimension:

- **Scheduled rows** SHALL render day-grouped with a per-day heading and a `breakfast | lunch |
  dinner` meal label, ordered by date then meal (breakfast < lunch < dinner) within a day.
- A **"Show empty meal slots" switch** (transient per-mount state, not URL-persisted) SHALL swap
  the scheduled list for a fixed **7-day × {breakfast, lunch, dinner} empty-slots grid** over the
  member's **local** calendar days (today..+6) whose cell position IS the date: an empty cell
  offers a "+ Add Recipe" combobox; a cell SHALL show **every** row on that night and meal (two
  recipes, or duplicate siblings, stack — no row is ever hidden), each with the recipe (click to
  change), its sides, provenance, a remove control, and a `×N` badge when the recipe occupies
  more than one **meal** slot (project rows do not count toward the badge).
- The **Unscheduled section** SHALL group rows by meal; a meal's group renders only when it has
  unscheduled rows (a fully empty plan shows no bare meal headers), each shown group carrying its
  own "+ Add Recipe" picker; setting a row's date schedules it.
- A **"Baking, treats & drinks" Projects section** SHALL always be reachable (both modes, even on
  an empty plan) and render `meal='project'` rows as title + a course-derived kind label (Baking /
  Dessert / Beverage / else title-cased) + remove, with an "+ Add a project" picker offering only
  **project-eligible** corpus recipes — those carrying a course facet outside the meal set
  (`main`/`side`/`breakfast`/`component`). A project add SHALL be an **explicit duplication** so a
  project-eligible recipe already planned as a meal row is never moved by it.
- A row carrying **`from_vibe`** SHALL render a muted provenance chip resolving the id to its vibe
  phrase through the existing vibes read; an id that no longer resolves renders **no** chip (never
  a raw id).
- An op-layer conflict (an ambiguous coalesce over a slug with 2+ rows, a project-constraint
  refusal) SHALL be surfaced to the member as a failure, never swallowed as a silent no-op or a
  false success; an occupied-slot replacement SHALL be refused up front when the incoming recipe
  already occupies 2+ slots, so the occupant is never moved and the slot never emptied.

The page SHALL compose the D26-final interaction semantics from the existing ops — the ops route
accepts an ordered array, so a multi-step resolution rides one call, and the UI always holds the
row id:

- Picking an already-planned recipe into a slot SHALL default to a **MOVE** (a plain `add` that
  coalesces onto the existing row, relocating it with sides preserved); an explicit **"Add again
  instead"** affordance SHALL be the ONLY path that mints a second slot (the `duplicate: true`
  spelling), issued as a two-op array that restores the moved row and inserts the duplicate.
- Picking a recipe into a slot already holding a **different** recipe SHALL MOVE the occupant to
  Unscheduled (a `set planned_for: null`) with a confirming toast — never a silent remove of the
  occupant.
- Rows scheduled beyond the grid's 7-day horizon SHALL remain visible in a "Later" strip with an
  editable date, never hidden.
- Every side surface SHALL use the open-world side combobox (never a `window.prompt`).

#### Scenario: Page edits preserve provenance and the watermark

- **WHEN** a member reschedules a vibe-proposed row or edits its sides from the plan page
- **THEN** the edit addresses the row by its id, the row's `from_vibe` and `meal` are unchanged,
  and when a member adds a recipe the new-for-me watermark advances exactly as an agent-side
  `update_meal_plan` add would

#### Scenario: Picking an already-planned recipe moves it, sides kept

- **WHEN** a member picks an already-planned recipe (with sides) into an empty grid slot
- **THEN** the existing row is relocated to that slot with its sides preserved and no second row
  is created — a plain `add` coalesce, not a duplicate

#### Scenario: "Add again" is the only duplication path

- **WHEN** a member, after a move, chooses "Add again instead"
- **THEN** one ordered call restores the moved row to its previous slot and inserts a second row
  with `duplicate: true`, and the two sibling slots render a `×2` badge

#### Scenario: An occupied slot moves its occupant to Unscheduled, never deletes it

- **WHEN** a member picks a recipe into a slot already holding a different recipe
- **THEN** the occupant is set to `planned_for: null` (moved to Unscheduled) with a "Moved … to
  Unscheduled" toast, the new recipe takes the slot, and no `remove` of the occupant is issued

#### Scenario: A beyond-horizon row stays visible in Later

- **WHEN** the empty-slots grid is shown and a scheduled row is dated beyond the 7-day horizon
- **THEN** that row renders in the "Later" strip with an editable date, and editing the date into
  the window pulls it into the grid

#### Scenario: Projects are course-filtered rows with a course-derived kind

- **WHEN** the Projects section renders and its "+ Add a project" picker is opened
- **THEN** the picker offers only recipes with a non-meal course facet, each project row shows a
  kind label derived from its course (e.g. `dessert` → "Dessert"), and project rows are excluded
  from the meal-plan sidebar badge

#### Scenario: Sides are added through the open-world combobox

- **WHEN** a member adds a side to any plan row or filled slot
- **THEN** the side is entered through the open-world side combobox (free-text allowed) and
  persisted via the `set` op — never through a `window.prompt`

#### Scenario: An ambiguous add surfaces a conflict, not a false success

- **WHEN** a member picks a recipe that already occupies 2+ slots into a grid slot
- **THEN** a failure notice is shown and no row is created — never a silent no-op or a success
  toast

#### Scenario: An unresolved provenance id renders no chip

- **WHEN** a plan row carries a `from_vibe` id that no longer matches any vibe in the palette
- **THEN** the row renders no provenance chip (the raw id is never shown)

### Requirement: Grocery page over the guarded list ops

The grocery page SHALL render the tenant's list grouped by category (`kind`), with add, remove,
quantity/note-preserving patch, an in-cart control that writes `status` as an **explicit
value** (`active` or `in_cart`), and a "clear purchased" action that removes each `in_cart`
row (received is terminal removal). The member route SHALL accept only `active | in_cart` for
`status` at its boundary; the shared op-layer transition guard backstops it. The page SHALL NOT
include substitutions, aisle or department grouping, a store picker, order placement, or the
derived to-buy view — those belong to later phases.

#### Scenario: A member can move an item in and out of the cart, and no further

- **WHEN** a member taps an item's in-cart control in either direction
- **THEN** the item's status is set to the explicit target value, and no interaction on the page
  can produce a `status: "ordered"` write

### Requirement: Pantry page over row-level ops

The pantry page SHALL read the tenant's pantry and mutate it through the existing row ops
(add/upsert keyed by canonical ingredient id, remove, mark-verified, and **dispose**), with no
new backend query, no new Worker route, and no D1/tool/schema change — every behavior consumes
the band-1 `pantry-disposition-foundations` contract (`GET /api/pantry` serving `location`;
`POST /api/pantry/ops` accepting `dispose`; the `WASTE_REASONS` enum; `PANTRY_LOCATIONS` /
`PANTRY_CATEGORIES`; the server-side `stampDepartment` funnel and the ingredient-category cron).
The three controlled vocabularies SHALL have a single source in `@yamp/contract`, imported by
both the Worker's `src/department.ts` and the member app.

The page SHALL keep the **needs-verification section**: perishable-category items (`produce`,
`dairy`, `seafood`, `meat`) whose `last_verified_at` exceeds the 7-day staleness threshold,
derived client-side from served fields, most-stale first, each with a `{N}d unchecked` badge, an
editable qty, a Verify control that drops the row on the next render, and a **bare trash** — the
one bare-trash affordance on the page, since here removal is verification cleanup, not a
disposition. An item SHALL appear in exactly one section.

The page SHALL offer a **multi-item add grid** (ITEM / QTY / CATEGORY / LOCATION) with
`<datalist>` suggestions drawn from the controlled vocab (category placeholder "auto", location
"—"): a fresh draft row SHALL append whenever the last row gains a name, each row SHALL carry a
per-row remove (disabled at a single row), and Clear + an "Add N items" commit (disabled at
zero) SHALL fire ONE batch of `add` ops. Added rows SHALL come back verified-now. Category and
location autofill SHALL be **non-authoritative UX only**: a blank category commits as "auto" and
the server's D17 ingredient-identity funnel / cron classifies it; any client-side recognition
MAY pre-fill category/location for a recognized name but SHALL NEVER clobber a value the member
typed.

The page SHALL offer a **group-by toggle** (transient per-mount state) with two dimensions:
**Category** (alphabetical) and **Location** (the fixed `PANTRY_LOCATIONS` order — Fridge,
Freezer, Pantry, Spice rack, Counter, Cabinet); locations store the slug and display Title Case.

**Item rows** SHALL render a relative verified stamp, a re-verify control hidden once the row is
verified today, and an editable qty written as the `add` upsert (preserving the row's location
and `added_at`). Every regular-row removal SHALL be a disposition — regular rows carry **no bare
trash**:

- A **Used split button** whose primary action fires `dispose{disposition:"used"}` (an
  idempotent delete; partial-use decrement and a consumption signal are out of scope), and whose
  menu opens the waste modal.
- A **waste modal** ("Toss '{item}'") SHALL present all 10 canonical `WASTE_REASONS` as a
  single-tap reason list; on tap it SHALL mint a client-side `event_id`, stamp `occurred_at`, fire
  `dispose{disposition:"waste", reason, event_id, occurred_at}`, and remove the row. The modal
  SHALL NEVER ask for a value or price (the event's value is derived later from spend history).
- `prepared_from` rows SHALL use the same disposition flow (their waste stamps the Leftovers
  pseudo-department server-side).

#### Scenario: Verifying clears the nudge

- **WHEN** a member verifies a flagged perishable
- **THEN** `mark_pantry_verified`'s op stamps today and the item leaves the needs-verification
  section on the next render

#### Scenario: Group-by Location renders the fixed vocabulary order

- **WHEN** a member with pantry rows in at least two locations switches the group-by control to
  Location
- **THEN** the rows regroup under Title-Case location headers in the fixed `PANTRY_LOCATIONS`
  order (e.g. Fridge before Pantry regardless of row order), and switching back to Category
  regroups them alphabetically by food-category label

#### Scenario: Multi-add autofills without authority and never clobbers a typed override

- **WHEN** a member types a recognized item name into an add row and, in another row, types an
  explicit category or location that differs from what recognition would fill
- **THEN** the recognized row's untouched category/location are pre-filled as a convenience while
  the typed override is preserved unchanged, and committing sends one batch of `add` ops — a row
  left blank in category commits with no category (the server funnel classifies it), and the
  added rows render verified-now

#### Scenario: Used is an idempotent delete with no modal

- **WHEN** a member taps the primary Used action on a regular row
- **THEN** a `dispose{disposition:"used"}` op is issued, the row is removed, and no waste modal
  or reason is shown

#### Scenario: Mark-as-waste records one canonical reason and never asks a value

- **WHEN** a member opens a row's menu, chooses Mark as waste, and taps a reason
- **THEN** the reason is one of the ten canonical `WASTE_REASONS`, the op carries
  `disposition:"waste"` with a client-minted `event_id` and a stamped `occurred_at`, the row is
  removed, and at no point is the member asked for the item's value or price

### Requirement: Cooking log page with member corrections

The cooking log page SHALL list the caller's log most-recent-first via a bounded read (recipe
rows enriched with title and facets from the recipe index), SHALL log a cook through the same
shared operation the `log_cooked` tool uses — preserving slug validation, the `satisfied_vibe`
stamp, and the atomic meal-plan clear — with route-level idempotent dedupe so a replayed
mutation cannot double-log, and SHALL support deleting one of the caller's own entries by id.

The composer SHALL carry a **meal** control (`breakfast | lunch | dinner`, defaulting by time of
day — before 11:00 breakfast, before 16:00 lunch, else dinner) and a **source** control mapping
**From cookbook → `recipe`** (a recipe select) and **Something else → `ad_hoc`** (a free-text
dish name); the mock's "Leftovers" source is deliberately not offered (the log is a cooking log,
not an eating log — `log_cooked`'s closed `type` set has no leftovers value; leftovers-as-waste
is captured at pantry disposition). The composer SHALL carry a date picker defaulting to today
and **allowing backdating**, and on submit SHALL preserve the chosen meal and date for rapid
multi-logging. The chosen `meal` SHALL be sent to the shared log operation.

The list SHALL group entries by day (Today / Yesterday / an absolute date label) with a per-day
logged count, ordering rows within a day by meal (breakfast < lunch < dinner; a row whose meal
is unset sorts last), and each row SHALL show its meal tag, the recipe link with facet chips (or
a non-recipe badge for an `ad_hoc` entry), and a delete control.

#### Scenario: Logging from the app behaves like the tool

- **WHEN** a member logs a planned, vibe-proposed recipe from the app
- **THEN** the log row carries the vibe's `satisfied_vibe` provenance and the plan row is
  cleared in the same D1 transaction, exactly as via `log_cooked`

#### Scenario: A replayed log write cannot double-log

- **WHEN** the same log mutation is delivered twice
- **THEN** the second delivery is answered as deduplicated and exactly one log row exists

#### Scenario: The composer logs the chosen meal and a non-recipe entry

- **WHEN** a member picks a meal, selects "Something else", types a dish name, and logs it
- **THEN** an `ad_hoc` entry carrying that meal and name is logged, and the meal and date persist
  in the composer for the next entry

#### Scenario: The list groups by day and tags the meal

- **WHEN** the log holds entries across several days and meals
- **THEN** they render grouped by day with a logged count, ordered breakfast before lunch before
  dinner within a day, each row tagged with its meal

### Requirement: Profile page over the assembled profile

The profile page SHALL read the assembled profile, SHALL edit structured preferences via the existing merge-patch operation (dietary avoid/limit; rotation; stores; brand tiers; the per-meal `cadence` map; the `weekly_budget`), SHALL edit the `taste` and `diet_principles` markdown fields, and SHALL render the derived taste read from the existing retrospective aggregation. Kroger connection/location state and every Store-card adapter summary SHALL come from the shared store-adapter projection rather than being re-derived from the assembled profile. All whole-document writes on this page are conditional (see the write-classes requirement).

The Preferences tab's **Planning card** SHALL expose the household planning knobs the shipped schema backs:

- **Per-meal weekly cadence steppers** — Breakfast / Lunch / Dinner, an integer 0–7 each, each writing a per-key merge patch (`{cadence: {<meal>: n}}`) so adjusting one meal preserves the others, with the − and + controls disabled at 0 and 7. (The mock's richer per-night "typical week" grid is out of scope — it needs storage the shipped schema does not carry.)
- The resurface-after and novelty-boost sliders (schema-faithful).
- A **weekly grocery budget** control whose unset state is first-class: clearing the field writes `weekly_budget: null` (deleting the key), a numeric value writes `Math.max(0, Math.round(n))` formatted on blur, and the control SHALL NEVER write `0` to mean "off"; an unset budget SHALL show helper copy that the budget line won't render.

The retired `lunch_strategy` and `ready_to_eat_default_action` preferences (D8/D21; per-meal cadence and meal vibes subsume them) SHALL have no control.

The Preferences tab's **Store card** SHALL render adapter tabs in the stable order Kroger / Instacart / Satellites / Offline. Kroger SHALL show projection-backed connection state and preferred name/address, Connect/Reconnect via the existing login-URL endpoint, online-only Disconnect, and a gear-triggered modal that submits a ZIP search, presents all bounded nearest-first results, and conditionally writes the selected exact location. Satellites SHALL show the projection's secret-free read-only unavailable summary and the adapter-authoring guide only until a real member Satellites route ships; it SHALL NOT render a no-op member-surface link. Offline SHALL list the existing grocery stores and allow standing selection, without implementing store CRUD or the aisle-map editor in this change. Instacart SHALL show only the shared projection's operator-configured availability and Marketplace-handoff explanation; it SHALL expose no member account link, retailer preference/override, credential, price, availability, or ETA state, and its unavailable state SHALL say `Not configured` rather than imply future account linking.

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its "what the agent has learned" summary
- **THEN** the cuisine/protein mixes and cadence come from the existing retrospective operation over the real cooking log — no new aggregation is introduced

#### Scenario: A per-meal cadence set persists

- **WHEN** a member steps one meal's weekly cadence up or down on the Planning card
- **THEN** the change is written as a per-key `{cadence: {<meal>: n}}` merge patch, the other meals' counts are preserved, and a reload shows the persisted value

#### Scenario: Setting and clearing the weekly budget (a clear is not a zero)

- **WHEN** a member sets a numeric weekly budget and then clears the field
- **THEN** the numeric value is written as `weekly_budget` (rounded, non-negative) and the clear writes `weekly_budget: null` — an UNSET state, not `0` — so a reload renders the empty control with its "no budget line" helper copy

#### Scenario: No retired-preference control renders

- **WHEN** the profile page's preferences tab renders
- **THEN** it offers no `lunch_strategy` or ready-to-eat default-action control — those preferences are retired and subsumed by the per-meal cadence steppers and meal vibes

#### Scenario: Store tabs share the adapter projection

- **WHEN** a member opens each Store tab and then visits Grocery
- **THEN** connection, preferred-store, Offline, Satellite, and launcher state all come from the same projection response

#### Scenario: Instacart tab reflects operator configuration only

- **WHEN** the member opens Instacart with complete valid operator configuration or with the adapter disabled
- **THEN** the tab reports `Available` or `Not configured` from the shared projection and offers no member account, retailer, price, availability, or ETA control

#### Scenario: Kroger picker selects an exact store

- **WHEN** a member searches a valid ZIP, chooses one of multiple Kroger results, and the conditional preferences write succeeds
- **THEN** the Store card refreshes to that result's exact name/address and no standalone ZIP preference control remains

#### Scenario: Offline does not duplicate the aisle-map change

- **WHEN** a member opens Offline in this change
- **THEN** existing shared store identities and standing selection render, but no duplicate store entity, shared-store CRUD form, or aisle-map editor is present

### Requirement: Reconciliation queue with member confirmation

The app SHALL render the member's pending reconciliation proposals as **inline suggestions** and
resolve them through the same confirm semantics as `confirm_proposal`: accept applies the
proposal's diff and records `accepted`; dismiss records `rejected` and the proposal never
re-surfaces. Presentation SHALL be kind-specific — no synthetic action without a backing
operation:

- An `adjust_cadence` or `prune_vibe` proposal SHALL attach to its palette row (joined by the
  proposal's target vibe) as a wand opening a suggestion panel with the rationale and an
  Apply/Retire + Dismiss action.
- An `add_vibe` proposal SHALL render as a per-meal-group footer card (grouped by its payload
  meal) with an Add + Dismiss action.
- A `merge_recipes` proposal (corpus curation, present only in the operator's own queue) SHALL
  NOT surface on the member vibes tab at all — it is filtered out entirely, since the merge
  itself is performed with the agent in chat; the member app has no merge operation.

Confirming an already-resolved proposal SHALL return a structured conflict and change nothing.
The tab SHALL render large backlogs sanely (production shows dozens of pending proposals).

#### Scenario: Accepting an add_vibe proposal updates the palette

- **WHEN** a member accepts a pending `add_vibe` proposal from its meal-group footer card
- **THEN** the vibe is upserted into that meal's group in the palette, the proposal is recorded
  `accepted`, and its card leaves the tab permanently

#### Scenario: An inline adjust_cadence suggestion applies to its row

- **WHEN** a member opens a palette row's suggestion wand and applies its `adjust_cadence`
  proposal
- **THEN** the vibe's cadence is upserted to the proposal's value, the proposal is recorded
  `accepted`, and the row's wand/suggestion leaves the tab

#### Scenario: Dismissal is durable

- **WHEN** a member dismisses an inline suggestion
- **THEN** it is recorded `rejected` and is never re-enqueued or re-surfaced (stable id
  idempotency)

#### Scenario: A merge_recipes proposal never surfaces on the member vibes tab

- **WHEN** the member's proposal feed contains a pending `merge_recipes` proposal
- **THEN** it renders nowhere on the meal vibes tab — no title, no rationale, and no
  accept/dismiss surface — because the merge is chat-guided and the member app has no merge
  operation

### Requirement: Write endpoints are classified for the two-writer posture

Every member write endpoint SHALL be classified and implemented as exactly one of: **(a)** a
whole-document write requiring `If-Match` (preferences merge-patch, the profile markdown
fields, vibe edits) — a stale precondition returns 412 with a structured `conflict` body and
the SPA refetches, rebases, and re-presents; or **(b)** an idempotent upsert or delete keyed on
a canonical id (grocery and pantry rows by canonical ingredient id, **plan rows by the
client-minted plan-row id — slug-addressed ops keep their defined fan-out**, favorites by slug
with an explicit boolean, notes by author + slug + client-minted `created_at`, log rows by the
`(date, meal, type, recipe|name)` dedupe identity or id, proposal confirms by proposal id) —
replayable last-write-wins with **no** `If-Match`, so offline mutation replay never fails on a
stale row snapshot. The classification table in this change's design SHALL be normative;
conditional reads (`If-None-Match` → 304) and ETags come from the shared middleware with no
schema change.

#### Scenario: A lost class (a) race is surfaced, not clobbered

- **WHEN** two writers race on a class (a) document and the app's `If-Match` no longer matches
- **THEN** the write is refused with 412 and a structured `conflict` body, nothing is stored,
  and the app rebases the member's edit on the refetched document

#### Scenario: A class (b) replay never preconditions

- **WHEN** a queued class (b) mutation replays after reconnect against rows another writer has
  since touched
- **THEN** it applies as a canonical-id upsert/delete without any `If-Match`, and the final
  state is the mutation's intended state for that key

### Requirement: Every member page ships with Playwright coverage

Every page in this phase SHALL ship with page objects and specs on the member-app Playwright
harness, exercised in CI as a blocking job with per-area screenshots surfaced for review —
including the empty and populated states production exhibits (empty palette with a pending
proposal backlog; near-empty cooking log) and the failure surfaces this change introduces (the
grocery status-guard rejection, a 412 rebase, the throttled suggest state).

#### Scenario: A page change cannot merge without its coverage

- **WHEN** a change touches a member page or its routes
- **THEN** the corresponding page objects/specs are updated in the same change and the blocking
  Playwright job passes with fresh screenshots

### Requirement: Whoami reports the deployment profile and operator identity

The whoami read (`GET /api/session`) SHALL additionally return `profile` — the deployment profile (`"self-hosted" | "saas"`) — and `operator: { name, repo }` — the operator's display name and plugin-marketplace repo slug — alongside the tenant identity, preserving the shared ETag contract. `profile` SHALL be resolved through the single Worker-side accessor that is the only site naming the profile source; the accessor SHALL read the `deployment_profile` value on the `operator_config` D1 singleton (the shipped configuration channel — see `shared-corpus`), resolving NULL/absent to `"self-hosted"`. `operator.name` SHALL come from the optional non-secret `OPERATOR_NAME` var, falling back to `OWNER_TENANT_ID`, else `null`; `operator.repo` from the optional non-secret `MARKETPLACE_REPO` var (stamped onto the deploy by the operator deploy workflow from the calling data repo — the data repo IS the marketplace), else `null`. Unset config SHALL yield explicit `null`s — never a fabricated slug or name.

#### Scenario: Whoami reflects the configured profile

- **WHEN** an authenticated member requests `GET /api/session` on a deployment whose `operator_config.deployment_profile` is `"saas"`
- **THEN** the response body carries `profile: "saas"` through the single accessor, and the response keeps its weak ETag / `If-None-Match` 304 behavior

#### Scenario: An unconfigured deployment reports self-hosted

- **WHEN** `GET /api/session` runs on a deployment that never wrote `deployment_profile`
- **THEN** whoami returns `profile: "self-hosted"` — the compiled default over the NULL column

#### Scenario: Unset operator config degrades to nulls

- **WHEN** `OPERATOR_NAME` and `MARKETPLACE_REPO` are unset (e.g. local dev) and `OWNER_TENANT_ID` is unset
- **THEN** whoami returns `operator: { name: null, repo: null }`, and with only `OWNER_TENANT_ID` set, `operator.name` is that tenant id

### Requirement: The sidebar offers a guided Connect-to-Claude modal

The app shell's sidebar SHALL render a "Connect to Claude.ai" CTA opening a guided
modal over the EXISTING distribution/connect flow — pure UI, no new backend write
path. The modal SHALL present two tabs of numbered steps templated from whoami's
`operator` config (never hardcoded slugs or names), each command copyable with
per-step "Copied" feedback:

- **Claude.ai (default)**: add the marketplace (copyable `operator.repo` slug), turn
  on auto-sync (naming `operator.name`'s updates), install the yamp plugin, open
  Connectors, connect yamp (entering the operator-sent invite code if prompted). The
  tab SHALL NOT carry a Kroger step — on the conversational surface Kroger consent is
  agent-initiated via `kroger_login_url` (deliberate omission).
- **Claude Code**: `/plugin marketplace add <operator.repo>`,
  `/plugin install yamp@yamp`, authorize the connector (`/mcp`, with copy covering the
  cross-device approval from the signed-in web app and the invite-code prompt where it
  applies), and an optional Kroger-cart step whose action mints the member's personal
  one-time consent link through the EXISTING session-gated
  `GET /api/profile/kroger-login-url` and opens it — never a static
  `/oauth/init?tenant=` URL, which the nonce-bound consent flow does not accept.

The modal footer SHALL carry the invite-code note (codes are minted per member, shown
once in the admin panel) and an "Open Claude.ai" action targeting `claude.ai/new` in a
new tab. When `operator.repo` is `null`, the affected steps SHALL degrade to
ask-your-operator copy with no copyable command; when `operator.name` is `null`, copy
SHALL fall back to "your operator".

#### Scenario: The modal renders templated, copyable steps

- **WHEN** a signed-in member opens the sidebar CTA on a deployment with operator
  config set
- **THEN** the Claude.ai tab shows the five steps with the deployment's marketplace
  repo slug as the copyable command, copying a step flips its button to "Copied", and
  the footer offers the invite-code note and the Open Claude.ai link

#### Scenario: The Claude Code tab covers install, auth, and optional Kroger

- **WHEN** the member switches to the Claude Code tab
- **THEN** the marketplace-add and plugin-install commands render templated and
  copyable, the auth step names `/mcp` with the web-app approval path, and the
  optional Kroger step's action requests the existing consent-link endpoint and opens
  the minted URL

#### Scenario: Missing operator config degrades honestly

- **WHEN** the modal opens on a deployment where whoami returned
  `operator: { name: null, repo: null }`
- **THEN** the marketplace steps show ask-your-operator copy with no copyable command,
  no fabricated slug appears anywhere, and the remaining steps render unchanged

### Requirement: The retired vibe-suggest route returns a pinned 410 stub for one deprecation window

For one deprecation window, `POST /api/vibes/suggest` SHALL remain registered and SHALL return —
pinned to the member-API route-level error convention (`c.json({ error: <literal>, message },
status)`, the `csrf_rejected`/`rate_limited` family; explicitly NOT a `src/errors.ts` `ToolError`
code) —

```ts
return c.json({ error: "gone" as const,
  message: "Vibe suggestions now arrive automatically; this trigger was retired." }, 410);
```

so the deployed SPA's shipped suggest button fails *explicably* — never the SPA-shell/404 trap —
and it SHALL invoke no derivation and no model. The stub is a docs/TOOLS.md Deprecations row; the
window-close cleanup change (`remove-meal-dimension-shims`) removes it, and the worker route tests
and the app suite's suggest coverage assert the stub while it lives.

#### Scenario: The shipped button fails explicably, without model spend

- **WHEN** a member on the deployed SPA taps the suggest button during the deprecation window
- **THEN** the route answers `410` with the structured `{ error: "gone", message }` body, runs no
  derivation, and touches no `env.AI`

#### Scenario: After the window the route falls to the normal 404

- **WHEN** the window-close cleanup removes the stub and the path is requested
- **THEN** it is answered by the standard unknown-API 404, never the SPA shell

### Requirement: Sidebar badge counts are derived once from the area reads

The app shell's sidebar SHALL derive its nav badge counts from one shared derivation so a
badge and the page it mirrors can never disagree. The meal-plan badge SHALL count
schedulable meal rows only, excluding project rows (`meal: 'project'`). The grocery badge
SHALL be the derived to-buy line count — the same derivation the grocery page renders —
so rows already advanced to `in_cart` or `ordered` are excluded and plan-derived needs are
included. A count of zero SHALL render no badge. The people badge (pending inbound
requests) is reserved for the People destination and is not rendered until it ships; the
mock's friend-count badge is a known mock defect and SHALL NOT be reproduced.

#### Scenario: Project rows do not inflate the meal-plan badge

- **WHEN** the plan holds N schedulable meal rows (`meal` in breakfast/lunch/dinner) plus
  one or more project rows (`meal: 'project'`)
- **THEN** the meal-plan badge reads N

#### Scenario: The grocery badge is the derived to-buy count

- **WHEN** the grocery page's derived to-buy view holds M lines
- **THEN** the grocery badge reads M, and rows advanced to `in_cart` or `ordered` are not
  counted

### Requirement: Retrospective page shell with tabs
The "Cooking log" nav destination SHALL remain the **Retrospective** page at `/retrospective` ("Look back at what you cooked — and what it cost."), with three tabs — **Cooking log** (default), **Spend analyzer**, and **Waste analyzer** — whose selected tab is held in the `?tab` URL search parameter. The Cooking log SHALL retain its composer and log list. The Spend and Waste tabs SHALL each render their production analyzer. The legacy `/log` route SHALL redirect to `/retrospective`.

The Spend and Waste panels SHALL share one `?range` URL search parameter accepting exactly `4w`, `8w`, or `12w`. Entering either analyzer with a missing or invalid range SHALL canonicalize it to `8w` with replace navigation before that analyzer request. Selecting a range SHALL write the selected valid value to the URL and both analyzers SHALL use it when active. Cooking log SHALL ignore but retain a valid range so returning to either analyzer preserves it. The Spend query key SHALL include range and run only while Spend is active; the Waste query key SHALL include range and run only while Waste is active. Neither aggregate SHALL be persisted for offline use.

The tab list SHALL use stable tab and panel ids, with each tab's `aria-controls` pointing to its panel and each panel's `aria-labelledby` pointing back. The selected tab SHALL have `aria-selected="true"` and `tabIndex=0`; unselected tabs SHALL have `aria-selected="false"` and `tabIndex=-1`. `ArrowLeft` and `ArrowRight` SHALL wrap through tabs and activate and focus the destination; `Home` and `End` SHALL activate and focus the first and last tab. The shared range selector SHALL be a named `role="group"` of buttons whose selected state is exposed with `aria-pressed`.

Loading SHALL use a status region. A failed analyzer request SHALL render the structured API message and a keyboard-operable retry for the same tab and range. Empty, unavailable, partial, and complete presentations SHALL branch on response status and coverage rather than infer state from a zero subtotal. In Spend, awaiting placement SHALL render as a separate notice; a null weekly budget SHALL omit the budget line; and a positive budget SHALL render with each week's documented tri-state comparison. Weekly bars SHALL be semantic chronological lists with visible week, known amount or unavailable value, and coverage text; bar geometry SHALL be decorative and hidden from assistive technology. KPIs and breakdowns SHALL retain textual labels and values.

Both panels SHALL use existing components and shared styles. On narrow and tall layouts, controls and cards SHALL remain readable and each labelled weekly chart SHALL use horizontal overflow without clipping information. No canvas, chart dependency, offline cache, speculative fallback, client-side aggregate model, or unrelated page redesign SHALL be introduced.

#### Scenario: The retrospective shell defaults to the cooking log
- **WHEN** a member opens `/retrospective` with no `?tab`
- **THEN** the Cooking log tab is selected and its composer and log list render

#### Scenario: Spend canonicalizes a missing range to eight weeks
- **WHEN** a member enters the Spend analyzer with no `?range`
- **THEN** the URL is replace-canonicalized to `range=8w`, the Spend query uses `8w`, and eight chronological weekly rows render from the production response

#### Scenario: Spend canonicalizes an invalid range
- **WHEN** a member enters the Spend analyzer with any range other than `4w`, `8w`, or `12w`
- **THEN** replace navigation writes `range=8w` before the Spend request rather than sending the invalid value

#### Scenario: Waste canonicalizes a missing range to eight weeks
- **WHEN** a member enters the Waste analyzer with no `?range`
- **THEN** the URL is replace-canonicalized to `range=8w`, the Waste query uses `8w`, and eight chronological weekly rows render from the production response

#### Scenario: Waste canonicalizes an invalid range
- **WHEN** a member enters the Waste analyzer with any range other than `4w`, `8w`, or `12w`
- **THEN** replace navigation writes `range=8w` before the Waste request rather than sending the invalid value

#### Scenario: Range selection is shared and URL-persisted
- **WHEN** a member selects 4 weeks or 12 weeks in the named range group
- **THEN** the pressed button and `?range` value update, the active analyzer query key and response use that range, and the other analyzer uses the same range when selected

#### Scenario: Cooking log retains a valid analyzer range without querying either analyzer
- **WHEN** a member selects a valid analyzer range, switches to Cooking log, and later returns
- **THEN** Cooking log retains the URL range, neither analyzer query runs while Cooking log is active, and the preserved range is used on return

#### Scenario: Switching tabs is reflected in the URL
- **WHEN** a member selects the Spend analyzer or Waste analyzer tab
- **THEN** the `?tab` search parameter and selected tab semantics update and the selected production panel renders

#### Scenario: Tab keyboard navigation activates and focuses predictably
- **WHEN** focus is in the tab list and the member presses ArrowLeft, ArrowRight, Home, or End
- **THEN** focus and selection move together using the documented wrapping order and tab/panel relationships remain valid

#### Scenario: Range controls expose their selected state
- **WHEN** either analyzer panel renders or range changes
- **THEN** the shared named group contains three buttons and exactly the active range exposes `aria-pressed="true"`

#### Scenario: Spend loading and retry remain operable
- **WHEN** the Spend query is pending and then returns a structured error
- **THEN** a status region announces loading, the error view presents the server message, and a keyboard member can retry the same range

#### Scenario: Empty and unavailable Spend are not shown as ordinary zero spend
- **WHEN** the shared Spend result status is `empty` or `unavailable`
- **THEN** the Spend panel renders the corresponding distinct truthful state and coverage counts rather than presenting a complete zero-like KPI set

#### Scenario: Partial Spend labels every known subtotal honestly
- **WHEN** monetary or department coverage makes the shared Spend result partial
- **THEN** the Spend panel labels displayed amounts as known/incomplete and shows the response's unpriced, estimated, or pending-classification evidence without inventing a remainder

#### Scenario: Budget absence and presence remain distinct
- **WHEN** Spend `weekly_budget` is null
- **THEN** no budget line or under-budget claim renders; when it is positive, the budget line and true, false, or unknown weekly comparison follow the response exactly

#### Scenario: Awaiting placement remains separate from recorded Spend
- **WHEN** Spend `awaiting_mark_placed` is positive
- **THEN** a separate notice reports the count without adding those rows to weekly bars, KPIs, or insight

#### Scenario: Spend weekly bars retain their text equivalent
- **WHEN** the Spend chart renders
- **THEN** assistive technology encounters a chronological list containing each week's label, known amount, and coverage while decorative geometry is hidden

#### Scenario: Narrow and tall layouts preserve analyzer information
- **WHEN** either analyzer panel renders at the member harness's narrow or tall viewport
- **THEN** controls and cards remain readable and the labelled weekly region scrolls horizontally rather than clipping weeks or textual values

#### Scenario: Spend and Waste remain distinct read models
- **WHEN** the member switches between Spend and Waste with one shared range
- **THEN** only the active analyzer is queried, each panel renders only its own shared aggregate, and no Spend amount or rule is relabeled as Waste data or vice versa

#### Scenario: The legacy log route redirects
- **WHEN** a member navigates to `/log`
- **THEN** they land on `/retrospective`

### Requirement: The member Spend endpoint is a session-gated adapter over the shared analyzer
The member API SHALL expose `GET /api/retrospective/spend?range=4w|8w|12w`. The member session SHALL resolve tenant identity; the route SHALL accept no tenant parameter, SHALL call the shared `readSpendAnalyzer` operation, SHALL perform no direct D1 read or write, and SHALL return the shared `SpendAnalyzer` object directly through the existing ETag response helper. A missing range SHALL default to `8w`. Any other value SHALL produce HTTP 400 with `{ "error": "validation_failed", "message": "range must be 4w | 8w | 12w" }` through the existing structured-error middleware. The dedicated body, profile retrospective `.spend`, and MCP retrospective `.spend` SHALL conform to the same additive aggregate shape defined by the spend-telemetry capability; only their documented default ranges differ.

#### Scenario: An authenticated request returns the shared object
- **WHEN** a signed-in member requests `/api/retrospective/spend?range=12w`
- **THEN** the route resolves that session's tenant and returns the shared twelve-week `SpendAnalyzer` object directly with the existing ETag behavior
#### Scenario: A missing API range defaults to eight weeks
- **WHEN** a signed-in member requests `/api/retrospective/spend` without `range`
- **THEN** the endpoint returns the shared aggregate with `range: "8w"`
#### Scenario: An invalid API range returns the exact structured error
- **WHEN** a signed-in member requests the endpoint with a range outside `4w`, `8w`, or `12w`
- **THEN** the response is HTTP 400 with error `validation_failed` and message `range must be 4w | 8w | 12w`
#### Scenario: An unauthenticated request cannot read Spend
- **WHEN** a caller without a valid member session requests the Spend endpoint
- **THEN** existing session middleware rejects the request before analysis and no household data is returned
#### Scenario: Tenant identity cannot be overridden publicly
- **WHEN** a signed-in caller adds an arbitrary tenant-like query or header value
- **THEN** the route ignores it, uses only the session-resolved tenant, and returns no other tenant's spend, cooking, budget, or awaiting-placement facts
#### Scenario: The API read has no side effect
- **WHEN** an authenticated Spend GET is repeated with unchanged committed facts
- **THEN** it returns the same deterministic object and performs no write, historical correction, cache persistence, scheduled work, or capture action
#### Scenario: The legacy profile endpoint retains its default
- **WHEN** an existing member client calls the profile retrospective endpoint without any new Spend input
- **THEN** its `.spend` value uses the same shared aggregate with the compatible four-week default and its existing non-Spend contract is unchanged

### Requirement: The Retrospective Spend panel is verified through real production entry points
The member-app Playwright page object and specs SHALL cover the Spend panel in the same change. The primary populated Spend case SHALL use the real seeded session-gated member API and its production analyzer operation, not a parallel browser-only aggregate. It SHALL verify the eight-week default, URL range changes, semantic tabs and range controls, textual KPI and weekly content, the awaiting-placement notice, and reviewed desktop plus tall/narrow screenshots. Narrow route interception SHALL be permitted only for otherwise unreachable presentation timing or branches such as sustained loading, forced structured error/retry, or a particular valid partial/unavailable response; such interception SHALL use the production response type and SHALL NOT be the primary analyzer proof.

#### Scenario: Primary browser coverage uses seeded production data
- **WHEN** the primary Spend Playwright case signs in and opens the Spend tab
- **THEN** its values come through the composed member API and production analyzer over seeded facts, and the case verifies default range, URL changes, semantic content, awaiting notice, and responsive screenshots
#### Scenario: Presentation-only interception cannot replace production proof
- **WHEN** a loading, structured-error, partial, or unavailable branch cannot be held reliably with seeded production timing
- **THEN** a narrowly scoped interception may return the exact production response shape for that branch, while the primary aggregate assertions continue to use the real endpoint
#### Scenario: No test-only analyzer model is introduced
- **WHEN** member UI and route tests are reviewed
- **THEN** they invoke the production API/operation or a narrowly typed presentation fixture and do not duplicate classification, coverage, KPI, ordering, or insight logic as an alternate implementation

### Requirement: The member Waste endpoint is a session-gated adapter over the shared analyzer
The member API SHALL expose `GET /api/retrospective/waste?range=4w|8w|12w&mapping_version=<name>` under the existing Worker-first `/api/*` dispatch. Existing session middleware SHALL resolve tenant identity; the route SHALL accept no tenant parameter, call the shared `readWasteAnalyzer` operation, perform no direct D1 read or write, and return the shared `WasteAnalyzer` object directly through the existing `jsonWithEtag` private/no-cache helper. A matching `If-None-Match` SHALL yield the existing 304 behavior.

A missing `range` SHALL default to `8w`. Any other range SHALL produce HTTP 400 with `{ "error": "validation_failed", "message": "range must be 4w | 8w | 12w" }` through the existing structured-error middleware. A missing `mapping_version` SHALL select the declared current avoidability mapping. An explicit supported name SHALL replay that immutable mapping. An unsupported value SHALL produce HTTP 400 with `validation_failed` and exact message `unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1`; it SHALL never silently select current. The HTTP query name SHALL be exactly `mapping_version`; `waste_mapping_version` SHALL remain the distinct MCP input name.

The dedicated body, MCP retrospective `.waste`, and profile retrospective `.waste` SHALL conform to the same additive aggregate contract; only their documented default ranges and exposed selectors SHALL differ. The dedicated API and UI SHALL default to `8w`/current; MCP and profile composition SHALL default to `4w`/current, and profile SHALL expose no new selector. The GET SHALL be deterministic and read-only. This change SHALL add no standalone/direct Waste analyzer, derived-value, avoidability, aggregate, edit, delete, or correction writer and SHALL NOT alter the separate existing `update_pantry` qualitative waste-disposition capture, which accepts no dollar value.

#### Scenario: An authenticated request returns the direct shared object
- **WHEN** a signed-in member requests `/api/retrospective/waste?range=12w&mapping_version=waste-avoidability-v1`
- **THEN** the route resolves that session's tenant and returns the direct shared twelve-week v1 `WasteAnalyzer` with private ETag behavior

#### Scenario: Missing API inputs use the UI defaults
- **WHEN** a signed-in member requests `/api/retrospective/waste` without query inputs
- **THEN** the endpoint returns the shared object with `range: "8w"` and the declared current avoidability mapping

#### Scenario: Invalid API range returns the exact structured error
- **WHEN** a signed-in member requests a range outside `4w`, `8w`, or `12w`
- **THEN** the response is HTTP 400 with error `validation_failed` and message `range must be 4w | 8w | 12w`

#### Scenario: Unknown mapping returns the exact structured error
- **WHEN** a signed-in member requests an unsupported `mapping_version`
- **THEN** the response is HTTP 400 with error `validation_failed` and message `unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1`

#### Scenario: ETag revalidation returns not modified
- **WHEN** an authenticated caller repeats an unchanged Waste GET with its matching ETag in `If-None-Match`
- **THEN** the existing helper returns 304 with no aggregate body and no side effect

#### Scenario: An unauthenticated request cannot read Waste
- **WHEN** a caller without a valid member session requests the Waste endpoint
- **THEN** existing session middleware rejects the request before analysis and no household data is returned

#### Scenario: Tenant identity cannot be overridden publicly
- **WHEN** a signed-in caller adds an arbitrary tenant-like query or header value while another tenant has matching facts
- **THEN** the route uses only the session-resolved tenant and returns no other household's Waste or Spend history

#### Scenario: API and MCP selector names remain exact
- **WHEN** callers request explicit mapping replay on the member and MCP transports
- **THEN** HTTP accepts `mapping_version`, MCP accepts `waste_mapping_version`, and both feed the same resolver and return the same selected-version object

#### Scenario: The API read is side-effect free
- **WHEN** an authenticated Waste GET repeats with unchanged committed facts
- **THEN** it returns the same ordered object and performs no event write, correction, cache persistence, classification fill, or scheduled work

### Requirement: The Retrospective Waste panel presents truthful server-authored analysis accessibly
The Waste panel SHALL request `GET /api/retrospective/waste` with the shared active range, omit `mapping_version` so the UI uses the current mapping, use TanStack query key `['retrospective', 'waste', range]`, and run only while Waste is selected. It SHALL render the server-authored aggregate without recalculating values, classification, KPIs, percentages, ordering, or insight in React, and SHALL remain outside the offline persistence allowlist.

While pending, the panel SHALL expose an accessible status reading `Loading waste analysis…`. A failed request SHALL expose a structured `role="alert"` containing the server message and a keyboard-operable Retry that refetches the same range. `status=empty` SHALL render a distinct empty state that retains the range control, exact zero Items-binned count, and the server-returned Waste rate and trend while omitting the Tossed-value dollar KPI and dollar breakdowns. This SHALL expose an available exact `0.0%` rate against positive complete qualifying Spend and an available `-100.0%` trend against positive exact prior Waste; zero denominators SHALL retain their returned unavailable reasons. Unavailable money SHALL be labelled `Last-paid value unavailable` while exact item counts and classified count breakdowns remain visible. Monetary partial status caused by an unmatched event or estimated match SHALL be labelled `Known last-paid estimate`; unmatched and estimated counts SHALL appear beside selected/Tossed value and every weekly row, breakdown, or group whose returned coverage/counts supply that evidence. Complete money SHALL be labelled `Last-paid estimate`, never a receipt total or measured tossed-quantity value. Pending Waste department classification alone SHALL NOT relabel complete money as partial: it SHALL retain `Last-paid estimate` while Department coverage is presented separately. A separately pending selected Spend department may independently make the returned Waste rate incomplete.

KPI text SHALL expose Tossed value when nonempty, exact Items binned and items per week, Waste rate with its returned unavailable reason when NULL, and matched Waste trend. Each KPI definition-list group SHALL place both value and detail evidence in valid `<dd>` elements. An unavailable trend SHALL show its returned `current_incomplete`, `prior_incomplete`, or `prior_zero` reason and label current/prior returned amounts as known last-paid subtotals, not unqualified estimates; because the contract does not return prior coverage counts, React SHALL NOT invent unmatched or estimated evidence for the prior interval. Weekly bars SHALL be a labelled semantic chronological list whose visible text includes week, event count, known amount or unavailable label, and coverage; decorative bar geometry SHALL be hidden from assistive technology. Department, reason, and avoidability rows SHALL expose labels, event counts, known amounts, count and amount percentages, and denominator/coverage text. Most-wasted rows SHALL expose display name, `tossed N×`, optional effective department, and a value label derived directly from the returned item `status`; counts remain evidence rather than a second status reducer. The exact server `insight` SHALL render as text.

An available Waste rate at `10.0%` or above SHALL use the reviewed red treatment and SHALL retain a textual percentage so color is not the only signal. A NULL or otherwise unavailable rate SHALL never receive threshold styling. The panel SHALL label Waste-derived dollar figures as spend-history last-paid estimates and SHALL never imply member-entered value, SKU/flyer fallback, receipt reconciliation, or quantity multiplication. If it displays the qualifying Spend denominator, it SHALL label that value as recorded/captured grocery spend, not as a per-toss last-paid estimate.

The shared tabs and range controls SHALL retain the tab/panel, keyboard, named-group, and `aria-pressed` semantics in the modified shell requirement. Desktop SHALL follow the reviewed Retrospective composition. Narrow layouts SHALL stack KPI, breakdown, and item cards in reading order and let controls wrap without overlap. Tall layouts SHALL keep controls and KPIs compact at the top while preserving every row. The weekly visual SHALL sit in a labelled horizontal-overflow region at narrow widths with no clipped textual data. The implementation SHALL use existing components and CSS only: no canvas, chart package, hover-only content, offline aggregate fallback, or client-side analyzer model.

#### Scenario: Waste query runs only for the active shared range
- **WHEN** the member selects Waste with `range=12w`, switches away, and later returns
- **THEN** the query key is `['retrospective', 'waste', '12w']`, no Waste request runs while inactive, and return uses the retained shared range

#### Scenario: Loading and retry are announced and operable
- **WHEN** the Waste request is pending and then returns a structured error
- **THEN** `Loading waste analysis…` is announced as status, the server message appears in an alert, and keyboard activation of Retry refetches the same range

#### Scenario: Empty Waste preserves non-dollar KPI truth
- **WHEN** the shared result has `status: "empty"`
- **THEN** the panel retains range selection, shows exact zero Items binned plus the returned Waste rate and trend, and omits the Tossed-value dollar KPI and dollar breakdowns

#### Scenario: Unavailable value preserves exact non-monetary facts
- **WHEN** events exist but monetary status is unavailable
- **THEN** the panel reads `Last-paid value unavailable` and still shows exact event counts and returned reason, avoidability, and classified-department counts without displaying `$0` as value

#### Scenario: Partial value exposes every returned source of incompleteness
- **WHEN** the shared result has unmatched events or estimated matches
- **THEN** known money is labelled `Known last-paid estimate` and returned unmatched/estimated evidence remains visible beside selected/Tossed value and affected weeks, breakdowns, and item groups

#### Scenario: Pending department is separate from complete Waste money
- **WHEN** every Waste event has a non-estimated eligible last-paid match but at least one effective department is pending
- **THEN** Waste money remains labelled `Last-paid estimate` while pending Department coverage and any independently incomplete Waste rate are displayed separately

#### Scenario: Complete value remains an estimate
- **WHEN** every event has a non-estimated eligible last-paid match
- **THEN** dollar output is labelled `Last-paid estimate`, not receipt total or exact tossed-quantity value

#### Scenario: Qualifying Spend keeps its recorded-spend meaning
- **WHEN** the panel displays Waste-derived money and the qualifying Spend denominator together
- **THEN** Waste money is labelled as a last-paid estimate and qualifying Spend is labelled as recorded/captured grocery spend, not a per-toss estimate

#### Scenario: KPI and charts have semantic textual equivalents
- **WHEN** Waste KPIs, weekly bars, breakdowns, and most-wasted items render
- **THEN** KPI labels, values, and detail evidence use valid definition-list terms/descriptions; dates, counts, amounts or unavailable states, percentages, denominators, coverage, and insight are available as text; and decorative geometry is hidden

#### Scenario: Prior-incomplete trend uses returned evidence only
- **WHEN** trend has `status: "unavailable"` and `reason: "prior_incomplete"`
- **THEN** the panel displays the prior-incomplete reason and returned current/prior known amounts without inventing prior unmatched or estimated counts

#### Scenario: Waste-rate threshold is available-only and not color-only
- **WHEN** rate is available at 10.0 percent or above
- **THEN** the reviewed red treatment and textual percentage render; when rate is NULL, threshold styling does not render and the returned unavailable reason does

#### Scenario: Shared controls meet keyboard semantics
- **WHEN** a keyboard member navigates tabs and changes the Waste range
- **THEN** tab focus/selection wraps and activates as documented, stable tab/panel relationships remain reciprocal, and exactly one range button exposes `aria-pressed="true"`

#### Scenario: Narrow and tall Waste layouts retain every fact
- **WHEN** the panel renders at reviewed narrow or tall viewport sizes
- **THEN** cards stack in reading order, controls do not overlap, every row remains reachable, and the labelled weekly region scrolls horizontally without clipping its text

#### Scenario: React does not become a parallel analyzer
- **WHEN** the Waste panel receives a valid production response
- **THEN** it presents the returned values, reasons, ordering, and insight without deriving alternative value, coverage, avoidability, rate, trend, or tie-breaking behavior

### Requirement: The Retrospective Waste panel is verified through real production entry points
The member-app Playwright page object and specs SHALL cover the Waste panel in the same change. The primary populated Waste case SHALL sign in through the seeded member harness and reach the production analyzer through the composed session-gated API, not a browser-only aggregate. It SHALL verify `8w` URL canonicalization, shared range changes, tab and range keyboard behavior, exact chronological 4w/8w/12w weekly starts/bounds/event/status/amount projections from fixed seeded facts, SPA row order/text mirroring each real response, KPI/weekly/breakdown/most-wasted/insight text, qualified Waste-versus-recorded-Spend labels, valid KPI definition-list semantics, available-only Waste-rate styling, and reviewed desktop plus narrow and tall screenshots after transient toasts clear.

Narrow route interception SHALL be allowed only to hold an otherwise unreachable presentation timing or branch such as sustained loading, forced structured error/retry, one valid unavailable/partial response, pending-department monetary-label orthogonality, or an unavailable trend with `prior_incomplete`. Any intercepted aggregate SHALL use the exported production response type and SHALL not add prior coverage fields, replace the seeded production proof, or duplicate server calculations. API tests SHALL use the composed production app to verify session rejection, tenant non-overridability, `8w`/current defaults, explicit range and `mapping_version`, exact validation errors, ETag 304, direct shared shape, and read-only behavior.

#### Scenario: Primary browser coverage uses seeded production data
- **WHEN** the primary Waste Playwright case signs in and opens Waste
- **THEN** its aggregate comes through the real member API and production reader over seeded facts and the case verifies default range, shared URL changes, exact 4w/8w/12w weekly projections and matching SPA row order/text, semantics, textual analysis, rate styling, and unobscured responsive screenshots

#### Scenario: Presentation-only interception cannot replace production proof
- **WHEN** loading, structured-error, unavailable, partial, pending-department, or prior-incomplete-trend timing cannot be held reliably with seeded production data
- **THEN** a narrowly scoped typed interception may hold that presentation branch while primary aggregate assertions continue to use the real endpoint

#### Scenario: API tests exercise the composed authenticated route
- **WHEN** route tests verify defaults, explicit replay, validation, ETag, authorization, tenant isolation, and repeat reads
- **THEN** they call the composed production member app and shared analyzer rather than a parallel route or test-only reducer

#### Scenario: Browser and API tests do not encode an alternate model
- **WHEN** the member UI and route tests are reviewed
- **THEN** they assert production outputs and presentation states without duplicating valuation, mapping, coverage, KPI, denominator, ordering, or insight algorithms

### Requirement: Meal-vibe palette page uses the production vocabulary

The meal-vibe palette page SHALL list, create, edit, and delete the tenant's meal vibes through
the shared vibe operations, rendering the **production** field vocabulary — the closed
`weather_affinity`/`weather_antipathy` set, `season` as a list, `facets`, `cadence_days`,
`pinned`, `base_weight`, and the vibe's `meal` — and SHALL derive per-vibe recency (last
satisfied) from the cooking log's `satisfied_vibe` provenance at read time, since the vibe row
stores none. The page SHALL render a useful empty state (production palettes start empty).

The list SHALL be **grouped by meal** into Breakfast / Lunch / Dinner sections (a vibe's `meal`,
defaulting `dinner`), each group rendering a per-group empty line when it holds no vibes. The
add/edit form SHALL carry a **Meal select** as its first field and include `meal` in the
created/edited vibe, so a vibe can be created into — or moved between — meals. A **pinned** vibe
SHALL carry a row indicator (a pin glyph + "Pinned" chip) beside its name, coexisting with the
status badge and chips without adding row height, and a pinned row SHALL de-emphasize its
cadence-debt meter (pinning force-places the vibe regardless of debt). The **member-assignment**
layout (the "Who's it for" form field and the row's member tag, D29) SHALL be present in the
markup but gated behind a `showWho` flag that is off this band — no member roster is rendered
until band 5 wires it.

#### Scenario: The palette read merges derived recency

- **WHEN** the palette page loads
- **THEN** each vibe row carries its derived last-satisfied date (or none), and the
  cadence-debt display is computed from it and `cadence_days` without any new stored column

#### Scenario: Vibes are grouped by meal

- **WHEN** the palette holds vibes across breakfast, lunch, and dinner
- **THEN** each vibe renders inside its meal's group, and a meal with no vibes renders its
  per-group empty line

#### Scenario: A pinned row renders its indicator and de-emphasizes debt

- **WHEN** the palette holds a pinned vibe and an unpinned vibe in the same meal group
- **THEN** the pinned row shows the pin indicator beside its name and de-emphasizes its
  cadence-debt meter, and the unpinned row shows no pin indicator

### Requirement: The Offline Store card edits nickname and owned aisle contribution

The existing Preferences Store card's Offline tab SHALL continue to list shared grocery-store registry rows from the adapter projection. For a selected row it SHALL expose the shared identity distinctly from an optional household nickname and SHALL write nickname only through the existing conditional preferences merge flow. It SHALL expose effective map status/age and a whole-document aisle editor whose editable data is labeled **Your map contribution**, separate from the read-only effective community preview.

The editor SHALL save through the session-gated aisle-map endpoint with `If-Match`, default new entries to shared visibility, preserve an explicit private choice, and offer a separate explicit "Use current map as a starting point" action rather than silently copying another author's facts into the caller's contribution. It SHALL render stale/unknown/mapped states, structured conflicts, offline-disabled save, and keyboard/focus behavior with existing shared UI primitives. It SHALL NOT add member shared-store identity CRUD.

#### Scenario: Editing map changes only own contribution
- **WHEN** a member edits and saves their full contribution from the Offline tab
- **THEN** the UI refreshes the effective map/projection while shared identity and other authors' notes remain unchanged

#### Scenario: Community map is not silently claimed
- **WHEN** a member with no contribution opens a store whose effective map comes from others
- **THEN** the map is visible as community context but the editable contribution stays empty until the member explicitly adopts or adds entries

#### Scenario: Offline editor is read-only
- **WHEN** the Store card is offline with cached secret-free map context
- **THEN** it may show that context but nickname/map saves are disabled and never queued

### Requirement: Store-walk member surfaces ship with browser-level visual coverage

The app Playwright harness SHALL extend page objects before implementation assertions and SHALL cover Offline registry reuse, shared/private nickname boundary, mapped/stale/unknown summaries, effective-versus-owned map editing and ETag conflict, mid-walk progression, pause/resume, completion sheet, offline queued/reload/replay success, replay conflict, and unchanged unchecked items. The suite SHALL capture and review desktop and tall/mobile screenshots for the changed Store card, active walk, and completion states without production-only fakes.

#### Scenario: Zero-connectivity walk is browser-proven
- **WHEN** the browser suite loads persisted Grocery context, disconnects, checks rows, queues Finish, reloads, and reconnects
- **THEN** the visual/behavior assertions prove one receipt, no per-tap spinner, pending copy before replay, and authoritative post-replay state

### Requirement: Cookbook cold-start onboarding states (SaaS)

Under the SaaS profile, the cookbook browse page SHALL render a cold-start onboarding treatment while the member's household owns zero non-curated imports and has not explicitly dismissed it (the deployment profile comes from whoami; the states never render under self-hosted):

- **Curated-floor state** (curated tier visible): an onboarding panel above the curated list with three compact action cards — "Add friends" (friends' recipes flow into your cookbook; links the People destination), "Import with the agent" (paste a recipe URL in a Claude chat and it lands here; opens the Connect-to-Claude modal when the member is not yet connected), and "Start from the curated set" (anchor-scrolls to the list; hearts and plan-toggles work on curated rows immediately). The curated rows below carry the "Curated" provenance badge.
- **True-zero state** (curated hidden by the household setting, or the curated tier empty): the same three cards carry the page with the fuller empty-illustration treatment consistent with the existing "No favorites yet" empty-state style, and no recipe list renders.
- In both states the "Recommended for you" panel and the filter bar SHALL be hidden.
- **Dismissal**: the panel SHALL disappear permanently once the household owns at least one non-curated import (a derived condition, no stored state), or on explicit dismiss — a persisted household-level flag written through the existing preferences path. A dismissed panel SHALL NOT return when the household later returns to zero own recipes unless the flag is cleared.

The states SHALL be covered by Playwright specs through the real seeded API: both variants, the badge, and dismiss persistence.

#### Scenario: A new SaaS household sees the curated-floor onboarding

- **WHEN** a member of a household with zero non-curated imports (curated visible) opens the cookbook on a SaaS deployment
- **THEN** the onboarding panel renders its three action cards above the curated list, curated rows are badged, and the Recommended panel and filter bar are absent

#### Scenario: The true-zero variant carries the page

- **WHEN** the same household has set curated-hide and owns no recipes
- **THEN** the page renders the three cards with the fuller empty treatment, no list, no filter bar, and no promoted panel

#### Scenario: The first own recipe retires the onboarding

- **WHEN** the household gains its first non-curated import (agent import, or later a sweep match)
- **THEN** the onboarding panel no longer renders and the standard browse page (filter bar, promoted panel when eligible) takes over

#### Scenario: Explicit dismiss persists for the household

- **WHEN** a member dismisses the onboarding panel and any household member reloads the cookbook later, still with zero own recipes
- **THEN** the panel stays dismissed (household-level persistence), and the curated list or true-zero empty state renders without it

#### Scenario: Self-hosted never sees onboarding

- **WHEN** any member opens the cookbook on a self-hosted deployment, regardless of corpus size
- **THEN** the cold-start states never render

