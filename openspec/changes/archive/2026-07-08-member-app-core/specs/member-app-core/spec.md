## ADDED Requirements

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

The app SHALL serve a cookbook index endpoint (the shared recipe index projected to the public
hit shape, title-sorted), a keyword search endpoint reusing the cookbook's field-weighted
keyword ranking, and a new-for-me endpoint reusing the per-member discovery read with its
last-planned watermark. The browse page SHALL render a "New for you" section from new-for-me
and an all-recipes list from the index; the trending and picked-for-you rows are deferred to a
later phase and SHALL NOT be approximated with ad-hoc queries here. Search SHALL be
keyword-only in this phase — no request-time embedding.

#### Scenario: Search parity with the public cookbook

- **WHEN** a member searches the cookbook in the app
- **THEN** the results come from the same pure keyword ranker the public `/cookbook` search
  serves, over the same index, returning the same hit shape

#### Scenario: New-for-you respects the watermark

- **WHEN** the browse page loads for a member with a recorded last-planned watermark
- **THEN** the "New for you" section contains only imports newer than the member's watermark
  (capped at the floor), exactly as `list_new_for_me` would return

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

The app SHALL list the member's favorites from the per-tenant overlay joined to the cookbook
index, and SHALL write favorite state as an **explicit set** (`{ slug, favorite: boolean }`)
keyed by the recipe slug — never a toggle — so an offline-replayed mutation converges to the
intended state.

#### Scenario: Replaying a favorite write converges

- **WHEN** the same favorite-set mutation is applied twice (e.g. an offline replay after a
  successful first delivery)
- **THEN** the overlay ends in the same state as after one application

### Requirement: Meal plan page over row-level ops

The meal plan page SHALL read the tenant's planned rows and mutate them through the existing
row-level ops keyed by recipe slug: add (upsert, preserving the new-for-me watermark stamp on
add exactly as the MCP tool does), remove, schedule and **unschedule** a night, and add and
**remove** open-world sides (the latter two via the `set` op added to `update_meal_plan` in
this change). Slot provenance (`from_vibe`) SHALL be preserved across page edits.

#### Scenario: Page edits preserve provenance and the watermark

- **WHEN** a member reschedules a vibe-proposed row or edits its sides from the plan page
- **THEN** the row's `from_vibe` is unchanged, and when a member adds a recipe the new-for-me
  watermark advances exactly as an agent-side `update_meal_plan` add would

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
SHALL edit structured preferences via the existing merge-patch operation (single-select
`lunch_strategy` over the real vocabulary; dietary avoid/limit; rotation; stores; ranked
brands), SHALL edit the `taste` and `diet_principles` markdown fields, SHALL render the derived
taste read from the existing retrospective aggregation, and SHALL obtain the Kroger consent URL
from the existing builder. All whole-document writes on this page are conditional (see the
write-classes requirement).

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its "what the agent has learned" summary
- **THEN** the cuisine/protein mixes and cadence come from the existing retrospective operation
  over the real cooking log — no new aggregation is introduced

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
kind-specific (`add_vibe`, `adjust_cadence`, `prune_vibe`) — no synthetic actions without a
backing operation. Confirming an already-resolved proposal SHALL return a structured conflict
and change nothing. The queue SHALL render large backlogs sanely (production shows dozens of
pending proposals).

#### Scenario: Accepting an add_vibe proposal updates the palette

- **WHEN** a member accepts a pending `add_vibe` proposal
- **THEN** the vibe is upserted into the palette, the proposal is recorded `accepted`, and it
  leaves the queue permanently

#### Scenario: Dismissal is durable

- **WHEN** a member dismisses a proposal
- **THEN** it is recorded `rejected` and is never re-enqueued or re-surfaced (stable id
  idempotency)

### Requirement: The vibe-suggest trigger is gated by derivation job health

The app's vibe-suggestion trigger SHALL check the archetype-derivation job's recorded health
before running derivation: when the last run was healthy and within the derivation interval
(~20 hours, the cron's own constant), it SHALL return a throttled response **without invoking
any model**, so a member-tappable button cannot spend `env.AI` unboundedly. When stale or
unhealthy, it SHALL run the existing on-demand derivation, which enqueues proposals into the
same pending queue the page lists.

#### Scenario: A fresh derivation throttles the button

- **WHEN** a member taps suggest while the archetype-derive job's last healthy run is within the
  interval
- **THEN** the endpoint returns a throttled result with no model call, and the UI surfaces the
  quiet throttled state

### Requirement: Write endpoints are classified for the two-writer posture

Every member write endpoint SHALL be classified and implemented as exactly one of: **(a)** a
whole-document write requiring `If-Match` (preferences merge-patch, the profile markdown
fields, vibe edits) — a stale precondition returns 412 with a structured `conflict` body and
the SPA refetches, rebases, and re-presents; or **(b)** an idempotent upsert or delete keyed on
a canonical id (grocery and pantry rows by canonical ingredient id, plan rows by recipe slug,
favorites by slug with an explicit boolean, notes by author + slug + client-minted
`created_at`, log rows by dedupe identity or id, proposal confirms by proposal id) — replayable
last-write-wins with **no** `If-Match`, so offline mutation replay never fails on a stale row
snapshot. The classification table in this change's design SHALL be normative; conditional
reads (`If-None-Match` → 304) and ETags come from the shared middleware with no schema change.

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
