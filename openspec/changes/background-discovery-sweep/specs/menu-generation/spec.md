## ADDED Requirements

### Requirement: New-for-me discoveries seed the plan from a read, not in-flow import

On a menu request, the agent SHALL obtain fresh discoveries by **reading** the background sweep's output — a `list_new_for_me` read returning recipes imported (`discovered_at`) after the caller's `last_planned_at` watermark, attributed to the caller, undispositioned by the caller, and not yet cooked. The agent SHALL NOT poll feeds, drain the email inbox, triage candidate blurbs, `parse_recipe`, classify, or `create_recipe` during the menu flow — that capture is the background `discovery-sweep` capability's job. Because the sweep already classified and embedded these recipes, they are immediately retrievable; the agent SHALL fold them into selection (they may claim plan slots and they surface in `search_recipes` retrieval), with no "imported this session but not yet retrievable" special-casing. On saving the plan, the agent SHALL stamp the caller's `last_planned_at` so subsequent reads return only newer discoveries.

#### Scenario: Discoveries come from a read, not a pull-and-import

- **WHEN** the agent assembles a menu
- **THEN** it calls `list_new_for_me` (no `fetch_rss_discoveries`, `read_discovery_inbox`, `parse_recipe`, or in-flow `create_recipe`) and folds the returned recipes into selection

#### Scenario: New-for-me recipes are immediately retrievable

- **WHEN** `list_new_for_me` returns a recipe the sweep imported
- **THEN** the agent may both place it directly and find it via `search_recipes`, because it is already embedded — no "work from the parse, don't re-search" special case applies

#### Scenario: Planning advances the watermark

- **WHEN** the agent saves an agreed meal plan
- **THEN** the caller's `last_planned_at` is stamped so the next `list_new_for_me` returns only recipes discovered afterward

## MODIFIED Requirements

### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** selecting recipes, but SHALL NOT load the whole corpus. The batch SHALL always include: `read_pantry()`, `read_user_profile()`, `retrospective("month")`, `list_new_for_me()` (the background sweep's discoveries for the caller — replacing the retired `fetch_rss_discoveries`/`read_discovery_inbox` pull), and `get_weather_forecast()` unconditionally (not gated on fulfillment mode). It SHALL NOT include a whole-corpus `search_recipes` membership load — recipe selection is done by **bounded retrieval** (vibe-bearing `search_recipes` specs for open-ended weeks; a vibe-less `query` spec for a named dish), issued after the context is in hand, not by dumping every recipe into context. `read_user_profile()` returns preferences, taste, diet_principles, kitchen, staples, stockup, and ready_to_eat in one call — there is no need for separate `read_preferences`, `read_taste`, `read_diet_principles`, or `read_staples` calls. When the user's fulfillment mode is Kroger (`preferences[stores].primary == "kroger"`), the batch SHALL additionally include `kroger_flyer()`; for a non-Kroger store it SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `ready_to_eat_available` is NOT called during the meal-plan flow — it is a buy-time tool used by the flush skills. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection, and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The recipe candidate space is the caller's **available corpus** — the whole shared corpus **minus the caller's rejects**, with no per-member "active set" and no `draft` recipes — reached through `search_recipes` rather than loaded wholesale. The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins), and so its at-risk perishables can seed `boost_ingredients` on the use-it-up search. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns any structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. An empty `read_user_profile().staples` array means no staples-driven prompting for that session — this is not a failure.

#### Scenario: Open-ended request gathers context but does not dump the corpus

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_user_profile`, `retrospective`, `list_new_for_me`, `kroger_flyer`, and `get_weather_forecast()` in a single batch before proposing; it does NOT issue a whole-corpus `search_recipes` membership load, `ready_to_eat_available`, a full-cart `kroger_prices`, `fetch_rss_discoveries`/`read_discovery_inbox`, or separate `read_preferences`/`read_taste`/`read_diet_principles`/`read_staples` calls; recipe candidates are obtained by bounded `search_recipes` retrieval afterward

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent retrieves recipes for a menu request
- **THEN** the candidate space is every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset

#### Scenario: Non-Kroger session omits flyer and skips sale signals

- **WHEN** the user's `primary` store is a non-Kroger store slug
- **THEN** `kroger_flyer` is NOT called and sale data plays no role in recipe selection for that session

#### Scenario: Pantry informs selection, not just the buy list

- **WHEN** the member has salmon and bok choy on hand and makes an open-ended request
- **THEN** the agent reasons over the loaded pantry to favor recipes that use what is already on hand (passing at-risk items as `boost_ingredients` on the use-it-up search), before finalizing the proposed set

#### Scenario: Pantry confirmation pass is not skipped

- **WHEN** any menu request is made
- **THEN** the agent runs the comprehensive pantry confirmation pass (including staples and spices) by reasoning over the loaded pantry, rather than proposing a menu without considering pantry state

#### Scenario: Weather forecast is included in the pre-pass batch

- **WHEN** the user makes a menu request
- **THEN** `get_weather_forecast()` is called in the parallel context batch alongside `read_pantry`, `read_user_profile`, etc., before any recipe is selected

#### Scenario: Forecast failure does not break the menu flow

- **WHEN** `get_weather_forecast()` returns an error (any error variant)
- **THEN** the agent continues with season-based recipe selection and does not tell the user the weather lookup failed

#### Scenario: Absent staples list does not break the menu flow

- **WHEN** `read_user_profile().staples` returns `[]` because the member has no staples in D1
- **THEN** the agent continues without staples-driven prompting; no error is surfaced

### Requirement: Discoveries are dispositioned conversationally

The agent SHALL let the user disposition discoveries through natural requests, mapping them to the favorites/rejections model: a "loved that one" request SHALL `toggle_favorite` the recipe; a "stop suggesting that" / "hide that" request SHALL `toggle_reject` it for the caller. Because discoveries are now auto-imported by the background sweep (there is no pre-import candidate for a member to triage in-conversation), a "stop suggesting that" disposition on a surfaced recipe is `toggle_reject` (per-tenant); `reject_discovery` is reserved for group-wide suppression of a discovery **source** (see the `recipe-discovery` capability), not a per-conversation disposition of a surfaced recipe. Ready-to-eat items SHALL be dispositioned analogously via `update_ready_to_eat` (favorite / reject) against the caller's per-tenant catalog. There is no `draft` state: an imported recipe is an available corpus recipe.

#### Scenario: A loved discovery is favorited

- **WHEN** the user says they loved a surfaced or imported recipe
- **THEN** the agent calls `toggle_favorite(slug, true)` for the caller, with no `status` or `rating` involved

#### Scenario: A surfaced recipe the member dislikes is toggle_reject, not reject_discovery

- **WHEN** the user says to stop suggesting a recipe surfaced by `list_new_for_me`
- **THEN** the agent calls `toggle_reject(slug)` for the caller (hiding it for them, leaving it for others), not `reject_discovery`

#### Scenario: An unwanted ready-to-eat item is rejected

- **WHEN** the user says to stop suggesting a ready-to-eat item
- **THEN** the agent calls `update_ready_to_eat(slug, { reject: true })` in the caller's catalog, affecting no other member, with no `status` or `rating`

### Requirement: An exploration allowance keeps the loop from over-tightening

Because both the background matcher and retrieval pull toward established taste, the flow SHALL permit a deliberate "a bit outside your usual" pick — surfacing an occasional candidate (from the new-for-me set or a wildcard retrieval spec) that is adjacent to, but not squarely inside, the member's established taste — so the corpus and rotation do not collapse into a filter bubble. (The complementary allowance on the import side — the sweep importing the occasional adjacent recipe — is the `discovery-sweep` capability's concern.)

#### Scenario: An adjacent pick is offered

- **WHEN** the flow assembles a proposal
- **THEN** it MAY include a clearly-flagged "a bit outside your usual" option alongside the squarely-on-taste picks

### Requirement: Menu-generation smoke-test validation

The meal-plan flow SHALL be validated by a scripted smoke test of three seeded requests — open-ended ("make me a menu"), recipe-seeded ("let's make chicken and rice this week"), and freeform-constraint ("something comforting, I'm feeling lazy") — each run from a fresh conversation against live data, with a per-seed rubric of required behaviors. The flow is considered correct when each seed's response satisfies its rubric, the user can iterate with a revision, and agreement lands items in the D1 grocery list (via `add_to_grocery_list`) with the cart untouched.

#### Scenario: Recipe-seeded smoke test passes its rubric

- **WHEN** the recipe-seeded seed "let's make chicken and rice this week" is run
- **THEN** the response uses a vibe-less `search_recipes({ specs: [{ facets: { query: "chicken rice", include_unmakeable: true } }] })`, enumerates all genuine matches including the exact-title recipe, disambiguates before verifying the pantry, then runs verification and a proposal

#### Scenario: Open-ended smoke test uses bounded retrieval

- **WHEN** the open-ended seed "make me a menu" is run
- **THEN** the response selects recipes via bounded vibe-bearing `search_recipes` specs (not a whole-corpus dump), folding the `list_new_for_me` discoveries into selection rather than polling/importing discovery sources in-flow

#### Scenario: Capture-not-flush holds across all seeds

- **WHEN** any smoke-test seed reaches agreement
- **THEN** to-buy items are persisted to the grocery list via `add_to_grocery_list` and the Kroger cart is not written

### Requirement: Side pairing bootstrap when the edge is empty

When a non-standalone main has an empty `pairs_with` and the natural companion warrants a saved recipe (a side with technique worth keeping, not a one-line preparation), the `meal-plan` flow MAY bootstrap a **corpus** pairing at plan time as opportunistic backfill — the `recipe-sides` flow is the primary author of `pairs_with`, and the `meal-plan` flow records an edge only for a pairing it confirms in the course of planning. The bootstrap SHALL follow the shared side-resolution ladder: prefer existing `course: side` recipes (retrieved via a `search_recipes` side spec driven by the main's `side_search_terms`), then a web parse (`parse_recipe`) of a specific side the user names or the agent proposes; it SHALL propose at most two candidate sides in chat; and on the user accepting such a side it SHALL ensure the side exists as a recipe (importing it via `parse_recipe` → `create_recipe` when it does not already exist, classified with `course: [side]`) and SHALL record the pairing by adding the side's slug to the main's `pairs_with` through `update_recipe`. The recorded edge is shared content, so a later menu request for the same main SHALL find the pairing already present and surface it. When the natural companion is instead a **trivial open-world side**, the agent SHALL NOT import a recipe or record a `pairs_with` edge — it proposes the open-world side directly (re-derived by reasoning each time, since it has no slug to remember). The bootstrap SHALL select sides by plate fit.

#### Scenario: Empty pairs_with bootstraps a corpus side

- **WHEN** a non-standalone main has an empty `pairs_with`, the natural companion warrants a saved recipe, and the user requests a menu including it
- **THEN** the agent searches corpus (via a `search_recipes` side spec) then a web parse, proposes one or two savory sides, and asks the user to choose

#### Scenario: Accepted corpus bootstrap imports the side and records the edge

- **WHEN** the user accepts a proposed corpus side that is not yet in the corpus
- **THEN** the agent imports it as a recipe with `course: [side]` via `parse_recipe` + `create_recipe` and adds its slug to the main's `pairs_with` via `update_recipe` in the same operation

#### Scenario: Trivial companion stays open-world, not recorded

- **WHEN** the natural companion is a one-line preparation (steamed rice, dressed greens)
- **THEN** the agent proposes it as an open-world side and records no `pairs_with` edge and imports no recipe

#### Scenario: Recorded pairing is reused next time

- **WHEN** a later menu request includes the same main whose `pairs_with` now names the previously-recorded corpus side
- **THEN** the agent surfaces the recorded side and does not re-run the bootstrap search

## REMOVED Requirements

### Requirement: Discovery surfaced during menu requests

**Reason**: Discovery no longer happens in the menu flow. The background `discovery-sweep` capability polls feeds, drains the email inbox, triages, classifies, taste-matches, and auto-imports continuously; the agent reads the result via `list_new_for_me` (see the new "New-for-me discoveries seed the plan from a read" requirement). The triage/parse/classify/import obligations leave the menu flow entirely.

**Migration**: Replace the in-flow `fetch_rss_discoveries`/`read_discovery_inbox` triage with the `list_new_for_me` read in the context pre-pass. Walled-source paste handling moves to the user-initiated manual import path; on-sale RTE discovery remains a buy-time concern.

### Requirement: Aggressive in-session import of preference-matched discoveries

**Reason**: In-session import is removed — importing is the background sweep's job (cheap triage → classify → taste-match → import), performed on `env.AI`, not on the agent's conversation. The "cost proportional to matches" discipline is preserved, but in the sweep (see the `discovery-sweep` capability: "Candidates are narrowed cheapest-first before classification").

**Migration**: No agent-side import during planning. The sweep imports matches between conversations; the agent consumes them via `list_new_for_me`.

### Requirement: Disposition collapses into the import decision

**Reason**: The import/no-action/reject disposition was an in-conversation decision over surfaced candidates. With auto-import, there is no pre-import candidate for the agent to disposition in-flow — import is decided by the sweep's matcher, and post-import disposition is the per-tenant overlay (`toggle_favorite`/`toggle_reject`) plus group-wide source suppression (`reject_discovery`), covered by the "Discoveries are dispositioned conversationally" and `recipe-discovery` requirements.

**Migration**: Drop the accept/maybe-next-time/skip/reject in-session disposition. A member who dislikes an auto-imported recipe uses `toggle_reject`; a bad source is suppressed group-wide via `reject_discovery`.
