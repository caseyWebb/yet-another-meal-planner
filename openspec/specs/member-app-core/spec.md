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

The app SHALL serve a cookbook index endpoint (the shared recipe index projected to the
compact hit shape — including `time_total` — title-sorted), a keyword search endpoint
reusing the cookbook's field-weighted keyword ranking, and a new-for-me endpoint reusing
the per-member discovery read with its last-planned watermark. Search SHALL be
keyword-only — no request-time embedding — and SHALL keep the debounced-against-API
behavior (the mock's in-memory keystroke search is a painted door, not a contract).

The browse page SHALL be **one unified, filterable list**: search bar → global filter
bar → the promoted "Recommended for you" panel (see `member-app-differentiators`) → a
single flat, title-sorted organic list over the full index. The page SHALL NOT render
sectioned browse lists ("New & trending" / "Picked for you" / "All recipes").

**Filter bar.** A cuisine select and a protein select — options derived from the loaded
corpus (distinct non-null values, sorted, "All cuisines"/"All proteins" defaults), never
from the authoring vocabulary — and a time segmented control (Any / ≤20 / ≤30 / ≤45).
One global filter state SHALL apply to search results, the promoted panel (per-row), the
organic list, and the favorites view. A recipe with no numeric `time_total` SHALL fail
any active time filter — an unknown-time recipe is never claimed under a time budget. A
"Clear" affordance and an "N of M match" count label SHALL render only while at least
one filter is active; the filtered-empty states ("No recipes match these filters." /
"None of your favorites match these filters.") SHALL repeat an inline "Clear filters"
link.

**Search mode.** A non-empty query SHALL replace browse mode (the promoted panel
hidden): a result-count line over the filtered results, the "No matches" empty state
("Nothing matches "{q}". Try a protein, a cuisine, or an ingredient."), and a clear
button. Active filters SHALL remain visible and AND onto the search results.

**URL state.** All shareable page state — the query, the cuisine/protein/time filters,
and the favorites view toggle — SHALL live in validated URL search params with default
values stripped from the URL, so every combination is shareable and deep-linkable;
loading such a URL SHALL reproduce the state. Transient input (the un-debounced search
text) stays client-local.

#### Scenario: Search parity with the public cookbook

- **WHEN** a member searches the cookbook in the app
- **THEN** the results come from the same pure keyword ranker the public `/cookbook`
  search serves, over the same index, returning the same hit shape

#### Scenario: One flat organic list replaces the browse sections

- **WHEN** the browse page renders with no query, no filters, and the default view
- **THEN** below the promoted panel there is exactly one flat, title-sorted recipe list
  over the full index (minus rows displayed in the panel), with no section headings

#### Scenario: Filters narrow every surface with an honest time gate

- **WHEN** the member selects cuisine "italian" and time "≤30"
- **THEN** the organic list, the promoted panel's rows, the favorites view, and any
  search results show only italian recipes with a numeric `time_total` ≤ 30 — a recipe
  lacking `time_total` is excluded — and the "N of M match" count and Clear affordance
  render

#### Scenario: Clearing filters restores the full list

- **WHEN** filters exclude every recipe and the member follows the inline "Clear
  filters" link
- **THEN** the filter state resets, the filtered-empty state disappears, and the full
  organic list (and promoted panel, outside search/favorites modes) renders again

#### Scenario: Filter and view state is shareable by URL

- **WHEN** a member loads a URL carrying query/filter/view search params (e.g.
  `/?cuisine=italian&time=30`)
- **THEN** the page renders with exactly that state applied, and interacting with the
  controls updates the URL params (defaults stripped) without a full reload

### Requirement: Recipe detail with notes, similar recipes, and the Cook-with-Claude deep link

The recipe detail page SHALL render the recipe's overlay-merged frontmatter, its derived
description, and its markdown body from the shared corpus; a Similar Recipes section computed by
the existing pure cosine over cron-captured embeddings (same floor and cap as the public
cookbook); and the group-aggregated notes for the recipe — the caller's own notes (including
private ones) editable and deletable, other members' shared notes read-only, per the existing
privacy rule. Anything conversational SHALL deep-link out to Claude (a link to
`claude.ai/new` prefilled with the cook command and slug) — the app SHALL NOT embed a model or
make any model call for the detail page.

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

#### Scenario: Page edits preserve provenance and the watermark

- **WHEN** a member reschedules a vibe-proposed row or edits its sides from the plan page
- **THEN** the edit addresses the row by its id, the row's `from_vibe` and `meal` are unchanged,
  and when a member adds a recipe the new-for-me watermark advances exactly as an agent-side
  `update_meal_plan` add would

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
(add/upsert keyed by canonical ingredient id, remove, mark-verified), including a
needs-verification section listing perishable-category items whose `last_verified_at` exceeds a
staleness threshold — derived client-side from served fields, with no new backend query.

#### Scenario: Verifying clears the nudge

- **WHEN** a member verifies a flagged perishable
- **THEN** `mark_pantry_verified`'s op stamps today and the item leaves the needs-verification
  section on the next render

### Requirement: Cooking log page with member corrections

The cooking log page SHALL list the caller's log most-recent-first via a bounded read (recipe
rows enriched with title and facets from the recipe index), SHALL log a cook through the same
shared operation the `log_cooked` tool uses — preserving slug validation, the `satisfied_vibe`
stamp, and the atomic meal-plan clear — with route-level idempotent dedupe so a replayed
mutation cannot double-log, and SHALL support deleting one of the caller's own entries by id.

#### Scenario: Logging from the app behaves like the tool

- **WHEN** a member logs a planned, vibe-proposed recipe from the app
- **THEN** the log row carries the vibe's `satisfied_vibe` provenance and the plan row is
  cleared in the same D1 transaction, exactly as via `log_cooked`

#### Scenario: A replayed log write cannot double-log

- **WHEN** the same log mutation is delivered twice
- **THEN** the second delivery is answered as deduplicated and exactly one log row exists

### Requirement: Profile page over the assembled profile

The profile page SHALL read the assembled profile (including the member's Kroger link state),
SHALL edit structured preferences via the existing merge-patch operation (dietary avoid/limit;
rotation; stores; ranked brands), SHALL edit the `taste` and `diet_principles` markdown fields,
SHALL render the derived taste read from the existing retrospective aggregation, and SHALL
obtain the Kroger consent URL from the existing builder. There is no `lunch_strategy` control —
the preference is retired (D8/D21; meal vibes subsume it); the per-meal cadence and vibes
editing surfaces are band 2's `profile-planning-and-vibes-ui` slice, the D25(2) coupling
obligation that follows this change. All whole-document writes on this page are conditional
(see the write-classes requirement).

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its "what the agent has learned" summary
- **THEN** the cuisine/protein mixes and cadence come from the existing retrospective operation
  over the real cooking log — no new aggregation is introduced

#### Scenario: No retired-preference control renders

- **WHEN** the profile page's preferences tab renders
- **THEN** it offers no `lunch_strategy` or ready-to-eat default-action control — those
  preferences are retired, and their successors (per-meal cadence, meal vibes) land with the
  band-2 profile/vibes UI slice

### Requirement: Night-vibe palette page uses the production vocabulary

The palette page SHALL list, create, edit, and delete the tenant's night vibes through the
shared vibe operations, rendering the **production** field vocabulary — the closed
`weather_affinity`/`weather_antipathy` set, `season` as a list, `facets`, `cadence_days`,
`pinned`, `base_weight` — and SHALL derive per-vibe recency (last satisfied) from the cooking
log's `satisfied_vibe` provenance at read time, since the vibe row stores none. The page SHALL
render a useful empty state (production palettes start empty).

#### Scenario: The palette read merges derived recency

- **WHEN** the palette page loads
- **THEN** each vibe row carries its derived last-satisfied date (or none), and the
  cadence-debt display is computed from it and `cadence_days` without any new stored column

### Requirement: Reconciliation queue with member confirmation

The app SHALL render the member's pending reconciliation proposals and resolve them through the
same confirm semantics as `confirm_proposal`: accept applies the proposal's diff and records
`accepted`; dismiss records `rejected` and the proposal never re-surfaces. Actions SHALL be
kind-specific (`add_vibe`, `adjust_cadence`, `prune_vibe`, `merge_recipes`) — no synthetic
actions without a backing operation. A `merge_recipes` proposal (corpus curation, present only
in the operator's own queue) SHALL render its pair honestly — a title naming both recipes from
the payload, the rationale, and a note that the merge itself is performed with the agent in
chat — and SHALL offer **Dismiss only** (backed by confirm-reject): the app has no merge
operation, so it SHALL NOT render an accept/merge button for this kind. Confirming an
already-resolved proposal SHALL return a structured conflict and change nothing. The queue
SHALL render large backlogs sanely (production shows dozens of pending proposals).

#### Scenario: Accepting an add_vibe proposal updates the palette

- **WHEN** a member accepts a pending `add_vibe` proposal
- **THEN** the vibe is upserted into the palette, the proposal is recorded `accepted`, and it
  leaves the queue permanently

#### Scenario: Dismissal is durable

- **WHEN** a member dismisses a proposal
- **THEN** it is recorded `rejected` and is never re-enqueued or re-surfaced (stable id
  idempotency)

#### Scenario: A merge_recipes proposal renders without a synthetic accept

- **WHEN** the operator's queue contains a pending `merge_recipes` proposal
- **THEN** the row names both recipes and shows the rationale, points the merge itself at the
  chat surface, and offers only Dismiss — no accept/merge button is rendered for it

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

The whoami read (`GET /api/session`) SHALL additionally return `profile` — the
deployment profile (`"self-hosted" | "saas"`) — and `operator: { name, repo }` — the
operator's display name and plugin-marketplace repo slug — alongside the tenant
identity, preserving the shared ETag contract. `profile` SHALL be resolved through a
single Worker-side accessor that is the only site naming the profile source; until the
deployment-profile flag channel ships, the accessor returns `"self-hosted"` and claims
no configuration channel. `operator.name` SHALL come from the optional non-secret
`OPERATOR_NAME` var, falling back to `OWNER_TENANT_ID`, else `null`; `operator.repo`
from the optional non-secret `MARKETPLACE_REPO` var (stamped onto the deploy by the
operator deploy workflow from the calling data repo — the data repo IS the
marketplace), else `null`. Unset config SHALL yield explicit `null`s — never a
fabricated slug or name.

#### Scenario: Whoami carries the templated operator config

- **WHEN** an authenticated member requests `GET /api/session` on a deployment with
  `MARKETPLACE_REPO` and `OPERATOR_NAME` set
- **THEN** the response body carries `profile: "self-hosted"`, `operator.repo` and
  `operator.name` with those values, and the response keeps its weak ETag /
  `If-None-Match` 304 behavior

#### Scenario: Unset operator config degrades to nulls

- **WHEN** `OPERATOR_NAME` and `MARKETPLACE_REPO` are unset (e.g. local dev) and
  `OWNER_TENANT_ID` is unset
- **THEN** whoami returns `operator: { name: null, repo: null }`, and with only
  `OWNER_TENANT_ID` set, `operator.name` is that tenant id

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

