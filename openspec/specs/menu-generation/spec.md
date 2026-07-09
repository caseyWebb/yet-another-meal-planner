# menu-generation Specification

## Purpose

Defines the agent-side orchestration of a menu request end-to-end: the parallel context pre-pass (all choice-independent context — pantry, preferences, taste, diet history, real cook history, and both discovery pools — loaded before recipe selection; Kroger flyer conditional on fulfillment mode), holistic reasoning over that loaded context to select mains and sides, recipe notes surfaced alongside recipe content, proposal assembly (perishable callouts, meal-prep, Kroger-gated sale features, recipe discoveries, sized to `default_cooking_nights`), capture of the plan and grocery list, and an order handoff prompt. **No full-cart pricing happens in this flow** — costing the cart is the place-grocery-order skill's job; the only `kroger_prices` use here is a targeted deal-check to verify specific sale claims during selection. Behavioral requirements are realized in `AGENT_INSTRUCTIONS.md` and validated conversationally.
## Requirements
### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** selecting recipes, but SHALL NOT load the whole corpus. The batch SHALL always include: `read_pantry()`, `read_user_profile()`, `retrospective("month")`, `list_new_for_me()` (the background sweep's discoveries for the caller — replacing the retired `fetch_rss_discoveries`/`read_discovery_inbox` pull), and `get_weather_forecast()` unconditionally (not gated on fulfillment mode). It SHALL NOT include a whole-corpus `search_recipes` membership load — recipe selection is done by **bounded retrieval** (vibe-bearing `search_recipes` specs for open-ended weeks; a vibe-less `query` spec for a named dish), issued after the context is in hand, not by dumping every recipe into context. `read_user_profile()` returns preferences, taste, diet_principles, kitchen, staples, stockup, and ready_to_eat in one call — there is no need for separate `read_preferences`, `read_taste`, `read_diet_principles`, or `read_staples` calls. When the caller's **primary fulfillment store has a warmed flyer**, the batch SHALL additionally include the **store-aware flyer read** — `kroger_flyer()` when the primary store is Kroger, `store_flyer()` when it is a satellite-scanned store — so satellite-scanned sales feed selection the same way Kroger sales do; when the primary store has no warmed flyer (no Kroger rollup and no satellite scan), the flyer read SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `ready_to_eat_available` is NOT called during the meal-plan flow — it is a buy-time tool used by the flush skills. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection, and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The recipe candidate space is the caller's **available corpus** — the whole shared corpus **minus the caller's rejects**, with no per-member "active set" and no `draft` recipes — reached through `search_recipes` rather than loaded wholesale. The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins), and so its at-risk perishables can seed `boost_ingredients` on the use-it-up search. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns any structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. An empty `read_user_profile().staples` array means no staples-driven prompting for that session — this is not a failure.

#### Scenario: Open-ended request gathers context but does not dump the corpus

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_user_profile`, `retrospective`, `list_new_for_me`, `kroger_flyer`, and `get_weather_forecast()` in a single batch before proposing; it does NOT issue a whole-corpus `search_recipes` membership load, `ready_to_eat_available`, a full-cart `kroger_prices`, `fetch_rss_discoveries`/`read_discovery_inbox`, or separate `read_preferences`/`read_taste`/`read_diet_principles`/`read_staples` calls; recipe candidates are obtained by bounded `search_recipes` retrieval afterward

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent retrieves recipes for a menu request
- **THEN** the candidate space is every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset

#### Scenario: A satellite-scanned store's sales feed selection the same way

- **WHEN** the caller's `primary` store is a non-Kroger store slug that has a warmed satellite scan
- **THEN** the batch includes `store_flyer()` for that store and its sales inform recipe selection the same way a Kroger flyer would, rather than being omitted

#### Scenario: A store with no warmed flyer omits sale signals

- **WHEN** the caller's primary store has neither a Kroger rollup nor a satellite scan
- **THEN** the flyer read is omitted and sale data plays no role in recipe selection for that session

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

### Requirement: Named-dish exhaustive enumeration

When the user names a specific dish, the agent SHALL resolve it deterministically with a **vibe-less** `search_recipes` `query` spec (membership mode), NOT a semantic vibe search, and SHALL enumerate **all** genuine matches returned, rather than surfacing a partial subset from memory. Because the spec carries no `vibe`, the result is the complete membership set — exhaustive, unranked, and inclusive of a recipe imported earlier this session (membership mode keeps the unembedded). The spec SHALL pass `include_unmakeable: true` so a named recipe is surfaced flagged rather than silently dropped by the makeability gate. The agent SHALL disambiguate among multiple genuine matches (or confirm the single match) with the user **before** walking the pantry for the chosen recipe.

#### Scenario: Named dish surfaces the exact-title recipe

- **WHEN** the user says "let's make chicken and rice this week" and the corpus contains a recipe titled "Chicken and Rice" plus other chicken-and-rice dishes
- **THEN** the agent calls `search_recipes({ specs: [{ label: "named", facets: { query: "chicken rice", include_unmakeable: true } }] })`, lists every returned match including the recipe titled "Chicken and Rice," and asks which one (or confirms) before verifying the pantry

#### Scenario: No silent under-counting

- **WHEN** the vibe-less `query` spec returns N genuine matches for a named dish
- **THEN** the agent presents all N (not a vibe-matched couple) and does not claim a smaller count than the tool returned

#### Scenario: A just-imported named dish is still found

- **WHEN** the user names a dish that was imported earlier this session and has no embedding yet
- **THEN** the vibe-less `query` spec still returns it (membership mode keeps the unembedded), and it is not dropped as it would be by a vibe-bearing search

### Requirement: Full proposal assembly

The agent SHALL assemble a menu proposal by **driving `propose_meal_plan`** with an ephemeral vibe set distilled from the gathered context and the user's original message (the `meal-plan-proposal` capability), then layering narration over the returned proposal — it SHALL NOT hand-compose the week by selecting recipes over a retrieved union itself. The distillation SHALL incorporate, when applicable, freeform constraints (mood/cuisine/effort such as "comfort food," "something Italian," "I'm feeling lazy") as vibe phrases and hard exclusions as facets. The narration layered over the proposal SHALL incorporate, when applicable: recipe notes surfaced from `read_recipe_notes` (tweaks worth baking in, warnings, group ratings); meal-prep callouts for `meal_preppable` recipes; **inventory substitutions** spotted by reasoning over the loaded pantry (a stand-in the member already has for a missing ingredient, surfaced during the pantry pass for confirmation before the item reaches the buy list); a **staples-backed restocking callout** (cross-referencing the `staples` array from `read_user_profile()` against pantry — missing or low staples are surfaced and confirmed before being added to the list; perishable staples with a stale `last_verified_at` are batched into a staleness nudge); and — **Kroger sessions only** — sale-based substitution opportunities (surfaced after flyer/price data is available, substitute candidates enumerated from world knowledge and verified via `kroger_prices`/`kroger_flyer`) and stockup alerts for bulk-buy items on sale. The proposal SHALL be sized to the user's cooking frequency (`default_cooking_nights`) unless the user specified otherwise — passed as the `nights` input to `propose_meal_plan`. Ready-to-eat options, on-sale RTE discovery, and restock-of-RTE-favorites are **not** part of the proposal.

#### Scenario: Recipe notes are surfaced with the proposal

- **WHEN** the chosen recipes have notes from `read_recipe_notes`
- **THEN** the proposal surfaces the relevant ones — a tweak worth baking in, a warning worth a late swap, positive group signal — not a full transcript of every note

#### Scenario: Inventory substitution is spotted from the loaded pantry

- **WHEN** a chosen recipe calls for salmon, salmon is in `not_in_pantry`, and the loaded pantry contains trout
- **THEN** the agent offers the trout as a stand-in for confirmation during the pantry pass, and on acceptance the salmon is not added to the buy list

#### Scenario: Freeform constraint shapes the ephemeral vibe set

- **WHEN** the user says "something comforting, I'm feeling lazy this week"
- **THEN** the agent distills a comforting, low-effort ephemeral vibe set (and any facet gates) passed to `propose_meal_plan`, then runs the pantry pass and restock list over the returned proposal

#### Scenario: Staples restocking callout is backed by loaded staples data

- **WHEN** olive oil is in the member's staples list and absent from pantry
- **THEN** the agent includes olive oil in the restocking callout and confirms with the user before adding to the shopping list; model judgment is not the primary signal

#### Scenario: Sale substitutions appear with the proposal (Kroger), not during pantry verify

- **WHEN** a menu recipe calls for an ingredient whose substitute is on sale (Kroger session)
- **THEN** the sale-based substitution is surfaced alongside the returned proposal (after flyer data), with the substitute candidates enumerated by the agent and verified via the Kroger tools, not during the pantry confirmation pass

#### Scenario: Proposal sized to cooking frequency

- **WHEN** the user makes an open-ended request and `default_cooking_nights` is 3
- **THEN** the agent passes `nights: 3` to `propose_meal_plan` (not 5 with extras), unless the user asked for a different count

### Requirement: To-buy list assembled from recipe content, notes, and the loaded pantry

The to-buy review SHALL be grounded in the **derived to-buy read** (`read_to_buy` — the plan's derived ingredient needs ∪ the active list − pantry on-hand, on canonical ids), with the agent's judgment layered on top rather than re-deriving presence by hand. At this step the agent SHALL still call, in parallel for each chosen recipe (mains and corpus sides), both `read_recipe(slug)` and `read_recipe_notes(slug)` — the body for cooking judgment (optional ingredients, doubling, waste callouts) and the group's notes/ratings to surface in the proposal — but SHALL NOT string-match each ingredient against the pantry to decide presence: canonical-id subtraction is the read's job. After the plan is saved, the agent SHALL read `read_to_buy` and review it with the user: surface the `pantry_covered` section's verification nudges (a stale-verified perishable gets a "still good?" ask), treat an **optional** ingredient the pantry lacks as an *ask* before materializing it (never a silent add or drop), and report `underived` planned recipes honestly (offering to add their items explicitly). For an **open-world side** (which has no recipe to derive from), the agent SHALL enumerate its ingredients from world knowledge and capture the absent ones explicitly, as before. Presence-only stance holds: the agent SHALL NOT net quantities against the buy list (quantity reconciliation stays the order-placement partials flow). **No `kroger_prices` call happens at this step** — pricing the to-buy list is the place-grocery-order flow's responsibility.

#### Scenario: Recipe notes loaded alongside recipe body

- **WHEN** the agent reads the chosen recipes during proposal assembly
- **THEN** it calls `read_recipe_notes(slug)` alongside `read_recipe(slug)` for each corpus recipe (mains and corpus sides), in parallel across the chosen set

#### Scenario: Presence comes from the derived read, not hand-matching

- **WHEN** the user agrees to a menu and the agent reviews what needs buying
- **THEN** the agent reads `read_to_buy` and presents its lines and pantry coverage, rather than enumerating each recipe's ingredients against the loaded pantry itself

#### Scenario: An optional missing ingredient is an ask

- **WHEN** a chosen recipe's optional ingredient (e.g. a garnish) is absent from the pantry
- **THEN** the agent asks whether to include it and materializes it as an explicit row only on a yes

#### Scenario: An underived planned recipe is compensated conversationally

- **WHEN** `read_to_buy` reports a planned recipe under `underived`
- **THEN** the agent says so and offers to add that recipe's items explicitly from the body it already read, rather than letting the gap pass silently

#### Scenario: Open-world side ingredients come from world knowledge

- **WHEN** a chosen open-world side ("roasted broccoli") has no corpus recipe
- **THEN** the agent enumerates its ingredients from world knowledge, and adds the absent ones to the buy list explicitly without a `read_recipe` call for the side

#### Scenario: No kroger_prices call during to-buy assembly

- **WHEN** the agent assembles and reviews the to-buy view
- **THEN** no `kroger_prices` call is made at this step — pricing is deferred to the place-grocery-order flow

### Requirement: Capture to grocery list, never flush to cart

On agreement, the agent SHALL record the agreed recipes as planned rows in the meal plan via `update_meal_plan` (committed cook intent), setting `planned_for` to the intended cooking night when known, along with side effects such as pantry verifications — and SHALL NOT hand-expand the planned recipes' ingredients into `add_to_grocery_list` calls: the plan's ingredient needs derive at read time (`read_to_buy`), following the plan automatically. `add_to_grocery_list` at this step SHALL be reserved for what derivation cannot produce: **open-world side** ingredients (world-knowledge-derived, `source = "menu"`, `for_recipes = []`, a `note` identifying the side), confirmed extras and optional-ingredient asks, and **materializations** — a derived line the user gave a quantity or note (e.g. the meal-prep doubling's scaled items carry their doubled `quantity` annotation and a "double batch" `note` as explicit `source = "menu"` rows, so the order-time quantity reconcile honors them). **Corpus sides** (`course: side` recipes) SHALL be captured as planned rows like mains — each chosen corpus side earns its own planned slug row (its ingredients then derive like any planned recipe), and any side draft imported during plate-rounding plus any new `pairs_with` edge SHALL be committed in the same operation. **Open-world sides** SHALL be captured as a `sides` array on their **accompanying main's** planned row. The agent SHALL NOT bump `last_cooked` on menu agreement — `last_cooked` moves only when a cook is asserted and logged (see the cooking-history capability). The menu flow SHALL NOT call `place_order` or otherwise write the Kroger cart. Cart population SHALL occur only on an explicit order request.

#### Scenario: Agreed menu captures the plan without expanding ingredients

- **WHEN** the user agrees to a proposed menu of corpus recipes whose ingredients the derivation covers
- **THEN** the agent records the recipes via `update_meal_plan`, writes **no** per-ingredient `add_to_grocery_list` calls for them, does not call `place_order`, and the derived to-buy read immediately reflects the menu's needs

#### Scenario: Agreed corpus side captures as its own planned recipe

- **WHEN** the user agrees to a menu in which a main was rounded out with a `course: side` corpus recipe
- **THEN** the agent records a planned slug row for the side via `update_meal_plan` (its ingredients derive from there), and commits any new `pairs_with` edge or imported side draft in the same operation

#### Scenario: Agreed open-world side captures on the main's row and flows to the buy list

- **WHEN** the user agrees to a menu in which a main was rounded out with an open-world side ("roasted broccoli")
- **THEN** the agent records `sides = ["roasted broccoli"]` on the main's planned row (no separate slug row), and adds the side's absent ingredients to the grocery list as `source = "menu"`, `for_recipes = []`, with a `note` identifying the side — all in the same operation, cart untouched

#### Scenario: A doubling materializes the scaled items

- **WHEN** the user accepts a double-batch offer on a meal-preppable recipe
- **THEN** the agent materializes the scaled items as explicit `source = "menu"` rows carrying the doubled quantity annotation and a note, so the larger need survives to the order-time quantity reconcile

#### Scenario: Agreement does not record a cook

- **WHEN** the user agrees to a proposed menu
- **THEN** no cooking log entry is written (via `log_cooked`) and no recipe's `last_cooked` is changed

#### Scenario: Empty-list case is stated explicitly

- **WHEN** the pantry already covers what the agreed menu needs (the derived view's to-buy is empty)
- **THEN** the agent says so explicitly, persists any pantry verifications, and adds nothing to the grocery list

### Requirement: Order handoff offer

After the meal plan is saved and the RTE pass (if applicable) is complete, the agent SHALL offer to continue to the fulfillment flow: for Kroger sessions, it SHALL ask whether to place the order now (handing off to the place-grocery-order flow, which runs the stale-cart check, SKU resolution, cart pricing, and flush); for in-store sessions, it SHALL offer to switch to the shopping-list flow. The handoff SHALL be a prompt — never automatic — and the agent SHALL summarize what was saved either way.

#### Scenario: Kroger session offers to place the order

- **WHEN** the user's fulfillment mode is Kroger and the meal plan is saved
- **THEN** the agent asks whether to place the order now, and on yes hands off to the place-grocery-order flow

#### Scenario: In-store session offers the shopping list

- **WHEN** the user's fulfillment mode is an in-store store slug and the meal plan is saved
- **THEN** the agent offers to switch to the shopping-list flow

### Requirement: Menu-generation smoke-test validation

The meal-plan flow SHALL be validated by a scripted smoke test of three seeded requests — open-ended ("make me a menu"), recipe-seeded ("let's make chicken and rice this week"), and freeform-constraint ("something comforting, I'm feeling lazy") — each run from a fresh conversation against live data, with a per-seed rubric of required behaviors. The flow is considered correct when each seed's response satisfies its rubric, the user can iterate with a revision, and agreement lands planned rows in the D1 meal plan (via `update_meal_plan`) whose ingredient needs appear in the derived to-buy read — with only open-world-side ingredients, extras, and materializations written as grocery rows, and the cart untouched. The open-ended and freeform rubrics require that composition is driven by `propose_meal_plan` over a distilled ephemeral vibe set — **not** by the agent hand-selecting mains over a retrieved union.

#### Scenario: Recipe-seeded smoke test passes its rubric

- **WHEN** the recipe-seeded seed "let's make chicken and rice this week" is run
- **THEN** the response resolves the dish with a vibe-less `search_recipes({ specs: [{ facets: { query: "chicken rice", include_unmakeable: true } }] })`, enumerates all genuine matches including the exact-title recipe, disambiguates before verifying the pantry, then `lock`s the chosen dish into `propose_meal_plan` and authors the remaining nights' vibes rather than hand-composing

#### Scenario: Open-ended smoke test drives the engine over an ephemeral vibe set

- **WHEN** the open-ended seed "make me a menu" is run
- **THEN** the response distills a bounded ephemeral vibe set (not a whole-corpus dump), folds the `list_new_for_me` discoveries in by authoring, and calls `propose_meal_plan` to compose the week — it does NOT hand-select mains over a retrieved union or poll/import discovery sources in-flow

#### Scenario: Capture-not-flush holds across all seeds

- **WHEN** any smoke-test seed reaches agreement
- **THEN** planned rows land in the meal plan, the derived to-buy read reflects their needs, only open-world-side/extra/materialization items are written via `add_to_grocery_list`, and the Kroger cart is not written

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

When assembling a menu, the agent SHALL round out each main that is not an already-complete plate by surfacing or sourcing a savory side (starch, vegetable, salad, or bread), reasoned in the **same compose pass** as the mains, not a separate post-hoc phase. Whether a main is an already-rounded plate (a one-pot dish, a composed grain bowl, a protein-plus-vegetable sheet-pan dinner) SHALL be **inferred by the agent at plan time** from the recipe's content — there is no persisted `standalone` flag to gate on, and the agent SHALL NOT prompt for a side when it judges the main already stands alone. For a non-standalone main, side sourcing SHALL follow the shared cheapest-first side-resolution ladder (defined by the `recipe-sides` capability): curated `pairs_with` corpus sides first; otherwise a `search_recipes` spec whose **vibe is the main's `side_search_terms`** (the AI-memoized phrases describing the desired side) with `facets: { course: "side" }`, folded into the main retrieval call when the mains are known or issued as a small second search when they are not; otherwise an open-world side. A chosen side MAY instead be an **open-world side** (a trivial preparation named from world knowledge — "white rice", "a simple arugula salad" — that needs no recipe file). Drink, wine, and dessert pairings are out of scope for this capability.

#### Scenario: Already-rounded main is not prompted for a side

- **WHEN** the agent judges a chosen main to be an already-rounded one-pot plate
- **THEN** the agent does not propose or source a side for it and proceeds to assemble the proposal — without writing or reading any persisted standalone flag

#### Scenario: Remembered corpus pairing is surfaced

- **WHEN** a non-standalone main's `pairs_with` already names a corpus side recipe
- **THEN** the agent surfaces that remembered side for the user to accept rather than searching for a new one

#### Scenario: Side retrieved via side_search_terms in the same compose pass

- **WHEN** a non-standalone main has no remembered pairing and warrants a corpus side
- **THEN** the agent retrieves candidates with a `search_recipes` spec using the main's `side_search_terms` as the vibe and `facets: { course: "side" }`, reasoned together with the mains rather than in a separate later phase

#### Scenario: Open-world side rounds out a main

- **WHEN** a non-standalone main has no remembered pairing and the natural companion is a trivial preparation (e.g. steamed rice)
- **THEN** the agent MAY propose it as an open-world side, without minting a recipe for it

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

### Requirement: Perishable-ingredient waste callout

When assembling a menu proposal, for each perishable that a proposed recipe uses in **less than a typical purchase unit** (a partial-package amount — judged by the agent from the recipe body plus its own knowledge of how the item is sold, e.g. 2 tbsp of cilantro from a bunch; **no Kroger lookup**), the agent SHALL determine whether another recipe in the proposal also uses that perishable. If none does, it SHALL offer either to add a recipe that uses up the remainder or to swap the recipe. The agent SHALL make this determination by **reasoning over the `perishable_ingredients` already present on the candidate rows** it holds (every `search_recipes` row carries `perishable_ingredients`) — it SHALL NOT require a dedicated perishable-search or filter tool; a use-up recipe is found with a targeted `search_recipes` spec (a vibe naming the item, or `boost_ingredients`). A perishable consumed in roughly a full purchase unit (no meaningful leftover), or already shared by another proposed recipe, SHALL NOT trigger a callout.

#### Scenario: Partial-unit, unshared perishable triggers a callout

- **WHEN** a proposed recipe uses a partial purchase unit of cilantro (e.g. a few tablespoons from a bunch) and no other proposed recipe lists cilantro in its `perishable_ingredients`
- **THEN** the agent flags the likely leftover and offers to add a recipe that uses cilantro up (via a targeted `search_recipes` spec), or to swap the recipe

#### Scenario: Full-unit use does not trigger a callout

- **WHEN** a proposed recipe uses roughly a whole purchase unit of a perishable (no meaningful remainder)
- **THEN** no waste callout is raised for that item, even if it is the only recipe using it

#### Scenario: Shared perishable does not trigger a callout

- **WHEN** a perishable appears in the `perishable_ingredients` of two or more proposed recipes
- **THEN** no waste callout is raised for that item

#### Scenario: Determination is reasoning over candidate rows, not a dedicated tool

- **WHEN** the agent evaluates leftover perishables for the proposal
- **THEN** it reasons over the `perishable_ingredients` already present on the `search_recipes` rows it holds, with no dedicated perishable-search tool and no Kroger lookup

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

### Requirement: Distill context into searches, retrieve, then compose

The flow SHALL keep the bounded context pre-pass (pantry, preferences, taste, diet, retrospective, weather, staples, discoveries, and flyer when Kroger), then **distill that context plus the user message into an ephemeral vibe set** (`{ vibe, facets }` entries) and pass it to `propose_meal_plan`, which retrieves candidates and **composes the week deterministically** (MMR diversify + facet spread + plate composition, the `meal-plan-proposal` capability) — rather than loading the whole active corpus or having the agent select recipes by hand. Each vibe entry SHALL separate a semantic `vibe` phrase from structured `facets`, because contrast/variety is anti-similarity and cannot be expressed as a similarity query. Anti-similarity constraints derived from the retrospective (e.g. avoid recently-repeated proteins/cuisines) SHALL be expressed as facets, never as the vibe phrase. When the caller supplies no intent, the agent MAY call `propose_meal_plan` with no ephemeral set, letting the saved night-vibe palette shape the week by cadence-debt.

#### Scenario: Whole corpus is not dumped and the agent does not hand-compose

- **WHEN** the flow runs against a large corpus
- **THEN** it distills an ephemeral vibe set and calls `propose_meal_plan`, which retrieves and composes; the agent does NOT load every recipe into context nor select the week's recipes itself

#### Scenario: Variety is a facet, not a vibe phrase

- **WHEN** the retrospective shows chicken cooked three times this week
- **THEN** the relevant vibe entries carry a facet excluding chicken, and "different from chicken" is not phrased as a semantic vibe

#### Scenario: A bare request lets the palette shape the week

- **WHEN** the user says only "plan me a meal" with no further intent
- **THEN** the agent MAY call `propose_meal_plan` with no ephemeral vibe set, and the saved palette + cadence-debt shape the week

### Requirement: Recall is engineered into the search set

The distilled ephemeral vibe set SHALL be diverse — the vibes implied by the request, a variety/wildcard vibe, a novelty vibe (never-cooked × taste), and use-it-up intent (passing at-risk on-hand items as `boost_ingredients`) — but **recall and cross-slot diversity are the engine's job**: `propose_meal_plan` retrieves a generous candidate pool per vibe and runs the MMR + facet-spread diversify over the week, so the agent SHALL NOT engineer recall by hand-selecting across a retrieved union. Side selection runs inside the engine's compose pass (driven by the chosen mains' `pairs_with` / `side_search_terms`), not as a separate agent round. When the returned proposal misses a good recipe the agent knows should fit, the agent SHALL adjust the ephemeral vibe set (add a vibe, widen intent) or re-invoke with a different seed rather than silently accepting the gap.

#### Scenario: Diverse vibes cover the space, the engine diversifies

- **WHEN** the flow distills an open-ended request
- **THEN** the ephemeral vibe set includes at least one variety/wildcard vibe and one never-cooked novelty vibe alongside the request-driven vibes, and `propose_meal_plan` performs the cross-slot diversify

#### Scenario: A recall gap is closed by adjusting intent, not hand-selecting

- **WHEN** the returned proposal omits a recipe the agent judges a good fit
- **THEN** the agent adds or widens a vibe (or re-seeds) and re-invokes `propose_meal_plan`, rather than composing the week by hand

### Requirement: An exploration allowance keeps the loop from over-tightening

Because both the background matcher and retrieval pull toward established taste, the flow SHALL permit a deliberate "a bit outside your usual" pick — surfacing an occasional candidate (from the new-for-me set or a wildcard retrieval spec) that is adjacent to, but not squarely inside, the member's established taste — so the corpus and rotation do not collapse into a filter bubble. (The complementary allowance on the import side — the sweep importing the occasional adjacent recipe — is the `discovery-sweep` capability's concern.)

#### Scenario: An adjacent pick is offered

- **WHEN** the flow assembles a proposal
- **THEN** it MAY include a clearly-flagged "a bit outside your usual" option alongside the squarely-on-taste picks

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

### Requirement: Sale-steering as a soft selection pull

When the caller's primary store surfaced a sale (Kroger via `kroger_flyer`, or a satellite-scanned store via `store_flyer`), the agent MAY let a genuine deal act as a **soft pull** toward recipes that use the discounted ingredient — weaker than expiry-matching but real. Before a flyer sale steers the menu, the agent SHALL verify the deal is actually cheap: for a **Kroger** store it SHALL call `kroger_prices` on a small set of standard alternatives, rank by `compare_unit_price`, and count the deal as real only if the sale item wins on **unit price** (not just on its own percent-off discount, which may merely bring a premium brand in line with a standard brand's everyday price); for a **satellite-scanned** store — where no live cross-brand price API is available — it SHALL rely on the Worker-re-derived saving already reflected in `store_flyer` (the raw `{ regular, promo }` markdown clearing the deal floor), steering more conservatively and never on a percent-off figure it did not itself observe. Any `kroger_prices` use here is a **targeted deal-check on a handful of comparable items** — it SHALL NOT be a price-the-whole-proposed-list pass.

#### Scenario: A Kroger sale is verified against comparable unit prices before steering the menu

- **WHEN** a Kroger flyer item shows a percent-off discount
- **THEN** the agent checks it against comparable-item unit prices via `kroger_prices` before treating the sale as a selection pull, and does not steer on discount percentage alone

#### Scenario: A satellite-scanned sale steers on the re-derived markdown

- **WHEN** a satellite-scanned store's `store_flyer` surfaces a sale (no `kroger_prices` API available for that store)
- **THEN** the agent steers only on the Worker-re-derived saving that already cleared the deal floor, conservatively, without a cross-brand unit-price check it cannot perform

#### Scenario: Sale check is targeted, not a full-cart price pass

- **WHEN** the agent verifies a Kroger sale claim during selection
- **THEN** the `kroger_prices` call covers only the handful of items being compared — not the entire proposed grocery list

