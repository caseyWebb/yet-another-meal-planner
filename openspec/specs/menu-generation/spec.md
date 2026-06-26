# menu-generation Specification

## Purpose

Defines the agent-side orchestration of a menu request end-to-end: the parallel context pre-pass (all choice-independent context — pantry, preferences, taste, diet history, real cook history, and both discovery pools — loaded before recipe selection; Kroger flyer conditional on fulfillment mode), holistic reasoning over that loaded context to select mains and sides, recipe notes surfaced alongside recipe content, proposal assembly (perishable callouts, meal-prep, Kroger-gated sale features, recipe discoveries, sized to `default_cooking_nights`), capture of the plan and grocery list, and an order handoff prompt. **No full-cart pricing happens in this flow** — costing the cart is the place-grocery-order skill's job; the only `kroger_prices` use here is a targeted deal-check to verify specific sale claims during selection. Behavioral requirements are realized in `AGENT_INSTRUCTIONS.md` and validated conversationally.
## Requirements
### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** settling on recipes. The batch SHALL always include: `read_pantry()`, `read_user_profile()`, `retrospective("month")`, `fetch_rss_discoveries()`, `read_discovery_inbox()`, `list_recipes()`, and `get_weather_forecast()` unconditionally (not gated on fulfillment mode). `read_user_profile()` returns preferences, taste, diet_principles, kitchen, staples, stockup, and ready_to_eat in one call — there is no need for separate `read_preferences`, `read_taste`, `read_diet_principles`, or `read_staples` calls. When the user's fulfillment mode is Kroger (`preferences [stores].primary == "kroger"`), the batch SHALL additionally include `kroger_flyer()`; for a non-Kroger store it SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `ready_to_eat_available` is NOT called during the meal-plan flow — it is a buy-time tool used by the flush skills. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection (see "Sale-steering as a soft selection pull"), and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The `list_recipes()` call is the **single faceted load**: because `course` rides every entry's frontmatter, one call returns the available mains and sides with full metadata and the agent buckets them by `course` — there SHALL NOT be a separate later call to source sides. The recipe candidate set is the caller's **available corpus** — the whole shared corpus **minus the caller's rejects** — with no per-member "active set" to assemble and no `draft` recipes to surface separately (whether that candidate set is dumped in full via `list_recipes` or narrowed via `recipe_semantic_search` is the planner's choice and out of scope for this change). The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins by reasoning over it), not merely the post-selection buy list. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns `{ error: "forecast_unavailable" }`, `{ error: "no_location" }`, or any other structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. An empty `read_user_profile().staples` array means no staples-driven prompting for that session — this is not a failure.

#### Scenario: Open-ended request gathers all choice-independent context before proposing

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_user_profile`, `retrospective`, `fetch_rss_discoveries`, `read_discovery_inbox`, `kroger_flyer`, `list_recipes()`, and `get_weather_forecast()` in a single batch before presenting any proposal; `ready_to_eat_available` and a full-cart `kroger_prices` are NOT called here, and no separate `read_preferences`, `read_taste`, `read_diet_principles`, or `read_staples` calls are made

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent loads recipes for a menu request
- **THEN** it considers every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset

#### Scenario: Non-Kroger session omits flyer and skips sale signals

- **WHEN** the user's `primary` store is a non-Kroger store slug
- **THEN** `kroger_flyer` is NOT called and sale data plays no role in recipe selection for that session

#### Scenario: One faceted load returns mains and sides together

- **WHEN** the up-front batch runs
- **THEN** the single `list_recipes()` result carries `course` on every entry, the agent buckets it into mains and sides, and no separate side-sourcing `list_recipes` call is made later in the flow

#### Scenario: Pantry informs selection, not just the buy list

- **WHEN** the member has salmon and bok choy on hand and makes an open-ended request
- **THEN** the agent reasons over the loaded pantry to favor recipes that use what is already on hand, before finalizing the proposed set

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

### Requirement: Named-dish exhaustive enumeration

When the user names a specific dish, the agent SHALL use `list_recipes` with the `query` filter to retrieve corpus matches and SHALL enumerate **all** genuine matches returned, rather than surfacing a partial subset from memory. The agent SHALL disambiguate among multiple genuine matches (or confirm the single match) with the user **before** walking the pantry for the chosen recipe.

#### Scenario: Named dish surfaces the exact-title recipe

- **WHEN** the user says "let's make chicken and rice this week" and the corpus contains a recipe titled "Chicken and Rice" plus other chicken-and-rice dishes
- **THEN** the agent calls `list_recipes({ query: "chicken rice" })`, lists every returned match including the recipe titled "Chicken and Rice," and asks which one (or confirms) before verifying the pantry

#### Scenario: No silent under-counting

- **WHEN** `list_recipes` returns N genuine matches for a named dish
- **THEN** the agent presents all N (not a vibe-matched couple) and does not claim a smaller count than the tool returned

### Requirement: Sale-steering as a soft selection pull (Kroger only)

When the fulfillment mode is Kroger and `kroger_flyer` surfaced a sale, the agent MAY let a genuine deal act as a **soft pull** toward recipes that use the discounted ingredient — weaker than expiry-matching but real. Before a flyer sale steers the menu, the agent SHALL verify the deal is actually cheap relative to comparable items: it SHALL call `kroger_prices` on a small set of standard alternatives, rank by `compare_unit_price`, and count the deal as real only if the sale item wins on **unit price** (not just on its own percent-off discount, which may merely bring a premium brand in line with a standard brand's everyday price). Any `kroger_prices` use here is a **targeted deal-check on a handful of comparable items** — it SHALL NOT be a price-the-whole-proposed-list pass.

#### Scenario: Sale is verified against comparable unit prices before steering the menu

- **WHEN** a Kroger flyer item shows a percent-off discount
- **THEN** the agent checks it against comparable-item unit prices via `kroger_prices` before treating the sale as a selection pull, and does not steer on discount percentage alone

#### Scenario: Sale check is targeted, not a full-cart price pass

- **WHEN** the agent verifies a sale claim during selection
- **THEN** the `kroger_prices` call covers only the handful of items being compared — not the entire proposed grocery list

### Requirement: Full proposal assembly

The agent SHALL assemble a menu proposal that reasons over the gathered context and the user's original message, and SHALL incorporate, when applicable: freeform constraints (mood/cuisine/effort such as "comfort food," "something Italian," "I'm feeling lazy"); recipe notes surfaced from `read_recipe_notes` (tweaks worth baking in, warnings, group ratings); meal-prep callouts for `meal_preppable` recipes; **inventory substitutions** spotted by reasoning over the loaded pantry (a stand-in the member already has for a missing ingredient, surfaced during the pantry pass for confirmation before the item reaches the buy list); a **staples-backed restocking callout** (cross-referencing the `staples` array from `read_user_profile()` against pantry — missing or low staples are surfaced and confirmed before being added to the list; perishable staples with a stale `last_verified_at` are batched into a staleness nudge); and — **Kroger sessions only** — sale-based substitution opportunities (surfaced after flyer/price data is available, substitute candidates enumerated from world knowledge and verified via `kroger_prices`/`kroger_flyer`) and stockup alerts for bulk-buy items on sale. The proposal SHALL be sized to the user's cooking frequency (`default_cooking_nights`) unless the user specified otherwise. Ready-to-eat options, on-sale RTE discovery, and restock-of-RTE-favorites are **not** part of the proposal — the no-cook-night offer comes after the plan is saved (see "Ready-to-eat no-cook night offer"), and on-sale RTE discovery and restock suggestions are buy-time concerns handled by the flush skills (place-grocery-order, shopping-list).

#### Scenario: Recipe notes are surfaced with the proposal

- **WHEN** the chosen recipes have notes from `read_recipe_notes`
- **THEN** the proposal surfaces the relevant ones — a tweak worth baking in, a warning worth a late swap, positive group signal — not a full transcript of every note

#### Scenario: Inventory substitution is spotted from the loaded pantry

- **WHEN** a chosen recipe calls for salmon, salmon is in `not_in_pantry`, and the loaded pantry contains trout
- **THEN** the agent offers the trout as a stand-in for confirmation during the pantry pass, and on acceptance the salmon is not added to the buy list

#### Scenario: Freeform constraint shapes selection

- **WHEN** the user says "something comforting, I'm feeling lazy this week"
- **THEN** the proposal biases toward comforting and low-effort/meal-preppable recipes while still running the pantry pass and proposing a restock list

#### Scenario: Staples restocking callout is backed by loaded staples data

- **WHEN** olive oil is in the member's staples list and absent from pantry
- **THEN** the agent includes olive oil in the restocking callout and confirms with the user before adding to the shopping list; model judgment is not the primary signal

#### Scenario: Perishable-staple staleness is batched into one nudge

- **WHEN** eggs and butter are both perishable staples with stale `last_verified_at` values
- **THEN** the agent surfaces them together in a single prompt ("I haven't seen you update eggs or butter recently — do you still have those?") rather than two separate questions

#### Scenario: No staples list — restocking callout falls back to model judgment

- **WHEN** the member has an empty `staples` array in D1 and a menu is requested
- **THEN** the restocking callout (if any) is based on model judgment, same as current behavior

#### Scenario: Sale substitutions appear with the proposal (Kroger), not during pantry verify

- **WHEN** a menu recipe calls for an ingredient whose substitute is on sale (Kroger session)
- **THEN** the sale-based substitution is surfaced alongside the menu proposal (after flyer data), with the substitute candidates enumerated by the agent and verified via the Kroger tools, not during the pantry confirmation pass

#### Scenario: Sale-based features are skipped for non-Kroger sessions

- **WHEN** the user's fulfillment mode is not Kroger
- **THEN** no sale-based substitutions and no stockup alerts are surfaced in the proposal

#### Scenario: Proposal sized to cooking frequency

- **WHEN** the user makes an open-ended request and `default_cooking_nights` is 3
- **THEN** the agent proposes 3 cooking nights (not 5 with extras), unless the user asked for a different count

### Requirement: To-buy list assembled from recipe content, notes, and the loaded pantry

The to-buy list SHALL be produced by the agent reasoning over the chosen recipes' content and the loaded pantry, not by a `verify_pantry_*` tool. At this step the agent SHALL call, in parallel for each chosen recipe (mains and corpus sides), both `read_recipe(slug)` and `read_recipe_notes(slug)` — the body to cook from, and the group's notes/ratings to surface in the proposal. For an **open-world side** (which has no recipe to read), the agent SHALL enumerate its ingredients from world knowledge (e.g. roasted broccoli → broccoli, olive oil, garlic), match them against the loaded pantry the same way, and emit the absent ones as to-buy. Ingredients SHALL be matched against the loaded pantry (treating semantic equivalents like `scallion`/`green onion` as on-hand, surfacing genuinely-absent items as to-buy); the result is emitted directly as `grocery_list_ops`, attributing each item to the recipe(s) needing it. Presence-only stance holds: the agent SHALL NOT net quantities against the buy list (quantity reconciliation stays the order-placement partials flow). **No `kroger_prices` call happens at this step** — pricing the to-buy list is the place-grocery-order flow's responsibility.

#### Scenario: Recipe notes loaded alongside recipe body

- **WHEN** the agent reads the chosen recipes to assemble the to-buy list
- **THEN** it calls `read_recipe_notes(slug)` alongside `read_recipe(slug)` for each corpus recipe (mains and corpus sides), in parallel across the chosen set

#### Scenario: To-buy comes from read_recipe + pantry reasoning, not a verify tool

- **WHEN** the user agrees to a menu and the agent assembles the buy list
- **THEN** the agent loads the chosen recipes via `read_recipe`, matches their ingredients against the loaded pantry, and emits `grocery_list_ops` for the absent items — issuing no `verify_pantry_*` call

#### Scenario: Open-world side ingredients come from world knowledge

- **WHEN** a chosen open-world side ("roasted broccoli") has no corpus recipe
- **THEN** the agent enumerates its ingredients from world knowledge, matches them against the loaded pantry, and adds the absent ones to the buy list without a `read_recipe` call for the side

#### Scenario: Semantic on-hand match avoids a needless buy

- **WHEN** a chosen recipe calls for `scallions` and the loaded pantry contains `green onions`
- **THEN** the agent treats it as on-hand (not added to the buy list), as a confirmable judgment rather than a string match

#### Scenario: No kroger_prices call during to-buy assembly

- **WHEN** the agent assembles the to-buy list and `grocery_list_ops`
- **THEN** no `kroger_prices` call is made at this step — pricing is deferred to the place-grocery-order flow

### Requirement: Capture to grocery list, never flush to cart

On agreement, the agent SHALL persist the menu's to-buy items to the grocery list via `add_to_grocery_list` (ingredient-level, SKU-free), and SHALL record the agreed recipes as planned rows in the meal plan via `update_meal_plan` (committed cook intent), setting `planned_for` to the intended cooking night when known, along with side effects such as pantry verifications. **Corpus sides** (`course: side` recipes) are recipes and SHALL be captured the same way as mains: each chosen corpus side earns its own planned slug row, its to-buy ingredients are added to the grocery list, and any side draft imported during plate-rounding plus any new `pairs_with` edge SHALL be committed in the same operation. **Open-world sides** (free-text plate companions with no corpus recipe) SHALL instead be captured as a `sides` array on their **accompanying main's** planned row, and their world-knowledge-derived ingredients SHALL be added to the grocery list with `source = "menu"`, `for_recipes = []` (no slug to attribute to), and a `note` identifying the side (e.g. "for the roasted-broccoli side"). The agent SHALL NOT bump `last_cooked` on menu agreement — `last_cooked` moves only when a cook is asserted and logged (see the cooking-history capability). The menu flow SHALL NOT call `place_order` or otherwise write the Kroger cart. Cart population SHALL occur only on an explicit order request.

#### Scenario: Agreed menu captures intent without touching the cart

- **WHEN** the user agrees to a proposed menu
- **THEN** the agent persists to-buy items via `add_to_grocery_list`, records the agreed recipes via `update_meal_plan`, and does NOT call `place_order` or write the Kroger cart

#### Scenario: Agreed corpus side captures as its own planned recipe

- **WHEN** the user agrees to a menu in which a main was rounded out with a `course: side` corpus recipe
- **THEN** the agent records a planned slug row for the side via `update_meal_plan`, adds the side's to-buy ingredients via `add_to_grocery_list`, and commits any new `pairs_with` edge or imported side draft in the same operation

#### Scenario: Agreed open-world side captures on the main's row and flows to the buy list

- **WHEN** the user agrees to a menu in which a main was rounded out with an open-world side ("roasted broccoli")
- **THEN** the agent records `sides = ["roasted broccoli"]` on the main's planned row (no separate slug row), and adds the side's absent ingredients to the grocery list as `source = "menu"`, `for_recipes = []`, with a `note` identifying the side — all in the same operation, cart untouched

#### Scenario: Agreement does not record a cook

- **WHEN** the user agrees to a proposed menu
- **THEN** no cooking log entry is written (via `log_cooked`) and no recipe's `last_cooked` is changed

#### Scenario: Empty-list case is stated explicitly

- **WHEN** the pantry already covers everything the agreed menu needs
- **THEN** the agent says so explicitly, commits any pantry verifications via `update_meal_plan`, and adds nothing to the grocery list

### Requirement: Order handoff offer

After the meal plan is saved and the RTE pass (if applicable) is complete, the agent SHALL offer to continue to the fulfillment flow: for Kroger sessions, it SHALL ask whether to place the order now (handing off to the place-grocery-order flow, which runs the stale-cart check, SKU resolution, cart pricing, and flush); for in-store sessions, it SHALL offer to switch to the shopping-list flow. The handoff SHALL be a prompt — never automatic — and the agent SHALL summarize what was saved either way.

#### Scenario: Kroger session offers to place the order

- **WHEN** the user's fulfillment mode is Kroger and the meal plan is saved
- **THEN** the agent asks whether to place the order now, and on yes hands off to the place-grocery-order flow

#### Scenario: In-store session offers the shopping list

- **WHEN** the user's fulfillment mode is an in-store store slug and the meal plan is saved
- **THEN** the agent offers to switch to the shopping-list flow

### Requirement: Menu-generation smoke-test validation

The menu-generation flow SHALL be validated by a scripted smoke test of three seeded requests — open-ended ("make me a menu"), recipe-seeded ("let's make chicken and rice this week"), and freeform-constraint ("something comforting, I'm feeling lazy") — each run from a fresh conversation against live data, with a per-seed rubric of required behaviors. The flow is considered correct when each seed's response satisfies its rubric, the user can iterate with a revision, and agreement lands items in the D1 grocery list (via `add_to_grocery_list`) with the cart untouched.

#### Scenario: Recipe-seeded smoke test passes its rubric

- **WHEN** the recipe-seeded seed "let's make chicken and rice this week" is run
- **THEN** the response uses `list_recipes({ query: "chicken rice" })`, enumerates all genuine matches including the exact-title recipe, disambiguates before verifying the pantry, then runs verification and a proposal

#### Scenario: Capture-not-flush holds across all seeds

- **WHEN** any smoke-test seed reaches agreement
- **THEN** to-buy items are persisted to the grocery list via `add_to_grocery_list` and the Kroger cart is not written

### Requirement: Discovery surfaced during menu requests

On a menu request, the agent SHALL surface a small number of new recipe discoveries from the `fetch_rss_discoveries` and `read_discovery_inbox` pools (both loaded in the pre-pass). Recipe discoveries that fit the taste profile and this request SHALL be imported immediately in draft state (`parse_recipe` → agent enrichment → `create_recipe`), not deferred until the user expresses interest in this conversation. Discovery SHALL NOT block or dominate the menu proposal — it is a side channel, surfaced as 1–2 callouts. On-sale ready-to-eat discovery is **not** surfaced during the menu request — it is a buy-time concern handled by the place-grocery-order and shopping-list flows.

#### Scenario: Menu request surfaces and drafts recipe discoveries

- **WHEN** the agent assembles a menu proposal and `fetch_rss_discoveries` returns RSS candidates or `read_discovery_inbox` returns inbox emails with recipe links
- **THEN** the agent scans each inbox email body for recipe titles and URLs, surfaces ~1–2 of the best fits across both pools for the taste profile and this request, and imports the chosen ones in draft via `parse_recipe` + `create_recipe`, without waiting for the user to ask

#### Scenario: Unreachable candidate is presented as a link, not an import

- **WHEN** `parse_recipe` returns `unreachable`/`no_jsonld`/`not_a_recipe` for a candidate
- **THEN** the agent presents the link and skips the import (common for inbox candidates from walled sources) — it does not block or defer the proposal

#### Scenario: On-sale ready-to-eat discovery is not surfaced here

- **WHEN** a menu request runs
- **THEN** the agent does NOT scan `kroger_flyer` for on-sale RTE items during the menu flow — that discovery happens at order/shopping time in the flush skills

### Requirement: Discoveries are dispositioned conversationally

The agent SHALL let the user disposition discoveries through natural requests, mapping them to the favorites/rejections model: a "loved that one" request SHALL `toggle_favorite` the recipe; a "stop suggesting that" / "hide that" request SHALL `toggle_reject` it for the caller (or `reject_discovery` the URL when the candidate is not yet imported and is not corpus-worthy for the group); ready-to-eat items SHALL be dispositioned analogously via `update_ready_to_eat` (favorite / reject) against the caller's per-tenant catalog. There is no `draft` state and no de-prioritized-drafts behavior: an imported recipe is an available corpus recipe, and a non-imported discovery simply stays a discovery.

#### Scenario: A loved discovery is favorited

- **WHEN** the user says they loved a surfaced or just-imported recipe
- **THEN** the agent calls `toggle_favorite(slug, true)` for the caller, with no `status` or `rating` involved

#### Scenario: An unwanted ready-to-eat item is rejected

- **WHEN** the user says to stop suggesting a ready-to-eat item
- **THEN** the agent calls `update_ready_to_eat(slug, { reject: true })` in the caller's catalog, affecting no other member, with no `status` or `rating`

### Requirement: Soft variety honoring backed by real history

Menu generation SHALL honor the variety targets and restrictions in the member's `diet_principles` (from `read_user_profile()`) as **selection inputs**: variety targets SHALL act as a **pull** on which recipes are chosen — a "fish once a week" target that `retrospective` shows as unmet should pull a fish recipe into the proposed set, not merely be checked after the fact. Both `diet_principles` (from `read_user_profile()`) and `retrospective("month")` are loaded in the pre-pass batch and SHALL be available as selection context from the start. The agent SHALL **explain tradeoffs** when it cannot satisfy all variety targets, rather than silently violating or rigidly enforcing them. Restrictions declared as hard exclusions SHALL be treated as gates (never propose a violating recipe); variety targets SHALL be treated as soft preferences.

#### Scenario: Variety target acts as a selection pull

- **WHEN** `diet_principles.md` targets fish at least once a week and `retrospective` shows no fish cooked recently
- **THEN** the agent favors including a fish dish during selection, not merely checks at proposal time whether one is included

#### Scenario: Hard restriction is not violated

- **WHEN** `diet_principles.md` declares a hard exclusion
- **THEN** the proposal never includes a recipe violating that exclusion

#### Scenario: Variety reasoning uses cooked history, not plans

- **WHEN** the agent reasons about recent protein/cuisine balance
- **THEN** it derives the balance from `retrospective` over the D1 cooking log (cooked events), not from meal plan intent rows

#### Scenario: Tradeoff is explained when variety cannot be satisfied

- **WHEN** the agent cannot satisfy all variety targets in the proposal
- **THEN** it says so and explains the tradeoff, rather than silently violating or rigidly enforcing

### Requirement: Plate-rounding with side pairings

When assembling a menu, the agent SHALL round out each main that is not an already-complete plate by surfacing or sourcing a savory side (starch, vegetable, salad, or bread). Whether a main is an already-rounded plate (a one-pot dish, a composed grain bowl, a protein-plus-vegetable sheet-pan dinner) SHALL be **inferred by the agent at plan time** from the recipe's content — there is no persisted `standalone` flag to gate on, and the agent SHALL NOT prompt for a side when it judges the main already stands alone. For a non-standalone main, if its `pairs_with` already names one or more **corpus sides**, the agent SHALL surface those remembered sides for the user to choose from rather than sourcing a new one. A chosen side MAY be either a **corpus side** (a `course: side` recipe, sourced via the faceted load already in hand) or an **open-world side** (a trivial preparation named from world knowledge — "white rice", "a simple arugula salad" — that needs no recipe file). The plate-rounding judgment SHALL be part of the single holistic reasoning pass over the faceted load and loaded pantry (see "Holistic plate reasoning over one faceted load"), not a separate phase that issues its own recipe-search calls. Drink, wine, and dessert pairings are out of scope for this capability.

#### Scenario: Already-rounded main is not prompted for a side

- **WHEN** the agent judges a chosen main to be an already-rounded one-pot plate
- **THEN** the agent does not propose or source a side for it and proceeds to assemble the proposal — without writing or reading any persisted standalone flag

#### Scenario: Remembered corpus pairing is surfaced

- **WHEN** a non-standalone main's `pairs_with` already names a corpus side recipe
- **THEN** the agent surfaces that remembered side for the user to accept rather than searching for a new one

#### Scenario: Open-world side rounds out a main

- **WHEN** a non-standalone main has no remembered pairing and the natural companion is a trivial preparation (e.g. steamed rice)
- **THEN** the agent MAY propose it as an open-world side, without minting a recipe for it

#### Scenario: Corpus side's content is read alongside its main

- **WHEN** the user accepts a corpus side for a main
- **THEN** the agent reads the side's content via `read_recipe` (and `read_recipe_notes`) alongside the mains at the to-buy step, and its absent ingredients join the to-buy list — there is no separate pricing call for the side in the meal-plan flow

### Requirement: Side pairing bootstrap when the edge is empty

When a non-standalone main has an empty `pairs_with` and the natural companion warrants a saved recipe (a side with technique worth keeping, not a one-line preparation), the agent SHALL bootstrap a **corpus** pairing at plan time: it SHALL prefer existing `course: side` recipes (already in hand from the faceted load), then the RSS discovery pool (`fetch_rss_discoveries`), then a web parse (`parse_recipe`); it SHALL propose at most two candidate sides in chat; and on the user accepting such a side it SHALL ensure the side exists as a recipe (importing it as a recipe via the discovery path using `parse_recipe` → `create_recipe` when it does not already exist, classified with `course: [side]`) and SHALL record the pairing by adding the side's slug to the main's `pairs_with` through `update_recipe`. The recorded edge is shared content, so a later menu request for the same main SHALL find the pairing already present and surface it. When the natural companion is instead a **trivial open-world side**, the agent SHALL NOT import a recipe or record a `pairs_with` edge — it proposes the open-world side directly (re-derived by reasoning each time, since it has no slug to remember). The bootstrap SHALL select sides by plate fit.

#### Scenario: Empty pairs_with bootstraps a corpus side

- **WHEN** a non-standalone main has an empty `pairs_with`, the natural companion warrants a saved recipe, and the user requests a menu including it
- **THEN** the agent searches corpus-then-RSS-then-web, proposes one or two savory sides, and asks the user to choose

#### Scenario: Accepted corpus bootstrap imports the side and records the edge

- **WHEN** the user accepts a proposed corpus side that is not yet in the corpus
- **THEN** the agent imports it as a recipe with `course: [side]` via `parse_recipe` + `create_recipe` and adds its slug to the main's `pairs_with` via `update_recipe` in the same operation

#### Scenario: Trivial companion stays open-world, not recorded

- **WHEN** the natural companion is a one-line preparation (steamed rice, dressed greens)
- **THEN** the agent proposes it as an open-world side and records no `pairs_with` edge and imports no recipe

#### Scenario: Recorded pairing is reused next time

- **WHEN** a later menu request includes the same main whose `pairs_with` now names the previously-recorded corpus side
- **THEN** the agent surfaces the recorded side and does not re-run the bootstrap search

### Requirement: Perishable-ingredient waste callout

When assembling a menu proposal, for each perishable that a proposed recipe uses in **less than a typical purchase unit** (a partial-package amount — judged by the agent from the recipe body plus its own knowledge of how the item is sold, e.g. 2 tbsp of cilantro from a bunch; **no Kroger lookup**), the agent SHALL determine whether another recipe in the proposal also uses that perishable. If none does, it SHALL offer either to add a recipe that uses up the remainder or to swap the recipe. The agent SHALL make this determination by **reasoning over the `perishable_ingredients` already present in the recipe index** (and in `list_recipes` results it already holds) — it SHALL NOT require a dedicated perishable-search or filter tool. A perishable consumed in roughly a full purchase unit (no meaningful leftover), or already shared by another proposed recipe, SHALL NOT trigger a callout.

#### Scenario: Partial-unit, unshared perishable triggers a callout

- **WHEN** a proposed recipe uses a partial purchase unit of cilantro (e.g. a few tablespoons from a bunch) and no other proposed recipe lists cilantro in its `perishable_ingredients`
- **THEN** the agent flags the likely leftover and offers to add a recipe that uses cilantro up, or to swap the recipe

#### Scenario: Full-unit use does not trigger a callout

- **WHEN** a proposed recipe uses roughly a whole purchase unit of a perishable (no meaningful remainder)
- **THEN** no waste callout is raised for that item, even if it is the only recipe using it

#### Scenario: Shared perishable does not trigger a callout

- **WHEN** a perishable appears in the `perishable_ingredients` of two or more proposed recipes
- **THEN** no waste callout is raised for that item

#### Scenario: Determination is reasoning over the index, not a search tool

- **WHEN** the agent evaluates leftover perishables for the proposal
- **THEN** it reasons over the `perishable_ingredients` already present in the recipe index / `list_recipes` results, with no dedicated perishable-search or filter tool and no Kroger lookup

### Requirement: Holistic plate reasoning over one faceted load

On a menu request, the agent SHALL perform menu selection and plate-rounding as a **single holistic reasoning pass** over the one faceted active-recipe load (mains and sides bucketed by `course`) and the loaded pantry, rather than as sequenced phases each issuing their own recipe-search calls. In this one pass the agent SHALL reason across: (a) the **menu** of mains, pulled toward what the pantry already holds and toward real flyer deals (Kroger-only, verified by unit-price check); (b) **sides**, both corpus (`course: side`) and open-world; (c) **expiry-matching** — biasing the menu toward pantry items likely to spoil soon, judged from each item's `added_at`, `category` (e.g. `fridge` faster than `freezer`/`pantry`), and `prepared_from`, since the pantry carries no explicit expiry date; and (d) **inventory substitutions** — stand-ins the member already has for an otherwise-absent ingredient. There SHALL be no `kroger_prices` costing of the assembled plate in the meal-plan flow — the cart is priced at order time (place-grocery-order).

#### Scenario: Sides are reasoned in the same pass as mains, not a later phase

- **WHEN** the agent assembles a proposal from the faceted load
- **THEN** mains and their sides are chosen together in one reasoning pass over the loaded set and pantry, with no separate side-sourcing tool calls issued after the mains are picked

#### Scenario: Expiry-matching pulls the menu toward soon-to-spoil items

- **WHEN** the loaded pantry shows a fridge item added many days ago whose freshness is waning
- **THEN** the agent biases the menu toward a recipe (or open-world side) that uses that item, reasoning from `added_at`/`category` rather than any stored expiry date

#### Scenario: No full-cart kroger_prices costing in meal-plan

- **WHEN** the holistic pass produces a tentative plate of mains and sides
- **THEN** the agent does NOT issue a `kroger_prices` call over the full to-buy set — pricing the cart belongs to the place-grocery-order flow

### Requirement: Weather-aware recipe selection (soft hints, silent)

When `get_weather_forecast` returns a valid forecast, the agent SHALL use the `meal_vibes` array on each forecast day as **soft weighting** when assigning recipes to `planned_for` dates. The agent SHALL prefer:
- recipes without grill-style preparation on days carrying `no-grill`
- soups, stews, and comfort-food recipes on days carrying `soup` or `comfort`
- lighter meals on days carrying `light`
- grill-style recipes on days carrying `grill-friendly`

This weighting SHALL be a nudge applied during holistic reasoning, not a filter or hard exclusion. An explicit user preference ("I want burgers Tuesday") SHALL always override weather hints. The agent SHALL NOT mention the weather forecast or its weather-based reasoning in the proposal unless the user explicitly asks.

#### Scenario: Rainy day steers away from grilling

- **WHEN** the forecast for a `planned_for` date carries `no-grill` and the recipe corpus includes both a grilled dish and a braised dish equally fitting the user's taste
- **THEN** the agent favors the braised dish for that date, without explaining the weather rationale in the proposal

#### Scenario: User preference overrides weather hint

- **WHEN** the forecast carries `no-grill` for Tuesday but the user explicitly requests burgers on Tuesday
- **THEN** the agent proposes burgers on Tuesday; weather hints do not override expressed preference

#### Scenario: Cold rainy day favors comfort food

- **WHEN** the forecast for a date carries both `no-grill` and `soup`
- **THEN** the agent weights toward soups, stews, and hearty comfort meals for that day

#### Scenario: Weather reasoning is not narrated

- **WHEN** the agent has used `meal_vibes` to steer recipe selection
- **THEN** the proposal reads like a normal meal plan; weather is not mentioned unless the user asks why a particular recipe was chosen
