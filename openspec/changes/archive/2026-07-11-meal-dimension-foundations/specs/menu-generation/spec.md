## MODIFIED Requirements

### Requirement: Full proposal assembly

The agent SHALL assemble a menu proposal by **driving `propose_meal_plan`** with an ephemeral vibe set distilled from the gathered context and the user's original message (the `meal-plan-proposal` capability), then layering narration over the returned proposal — it SHALL NOT hand-compose the week by selecting recipes over a retrieved union itself. The distillation SHALL incorporate, when applicable, freeform constraints (mood/cuisine/effort such as "comfort food," "something Italian," "I'm feeling lazy") as vibe phrases, hard exclusions as facets, and each entry's **`meal`** when the request is meal-specific (an omitted `meal` defaults to dinner). The narration layered over the proposal SHALL incorporate, when applicable: recipe notes surfaced from `read_recipe_notes` (tweaks worth baking in, warnings, group ratings); meal-prep callouts for `meal_preppable` recipes; **inventory substitutions** spotted by reasoning over the loaded pantry (a stand-in the member already has for a missing ingredient, surfaced during the pantry pass for confirmation before the item reaches the buy list); a **staples-backed restocking callout** (cross-referencing the `staples` array from `read_user_profile()` against pantry — missing or low staples are surfaced and confirmed before being added to the list; perishable staples with a stale `last_verified_at` are batched into a staleness nudge); and — **Kroger sessions only** — sale-based substitution opportunities (surfaced after flyer/price data is available, substitute candidates enumerated from world knowledge and verified via `kroger_prices`/`kroger_flyer`) and stockup alerts for bulk-buy items on sale. The proposal SHALL be sized from the member's **per-meal `cadence` map** (from `read_user_profile().preferences.cadence`) unless the user specified otherwise — passed as the `meals` input to `propose_meal_plan` (a meal the user didn't ask about and whose cadence is 0 gets no slots). When a requested meal comes back as explicit empty slots (`empty_reason: "no_palette_for_meal"`), the agent SHALL surface the nudge — offer to add a meal vibe for that meal (`add_meal_vibe`) or author an `ephemeral_vibes` entry carrying that `meal` — rather than silently re-proposing dinner. Ready-to-eat options, on-sale RTE discovery, and restock-of-RTE-favorites are **not** part of the proposal.

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

#### Scenario: Proposal sized from the cadence map

- **WHEN** the user makes an open-ended request and their cadence is `{ breakfast: 0, lunch: 2, dinner: 3 }`
- **THEN** the agent passes `meals: { lunch: 2, dinner: 3 }` to `propose_meal_plan` (not a padded count), unless the user asked for different counts

#### Scenario: An empty meal palette becomes a nudge, not a silent fallback

- **WHEN** the returned proposal's lunch slots are explicit empty slots with `empty_reason: "no_palette_for_meal"`
- **THEN** the agent offers to add a lunch meal vibe or authors a lunch-mealed ephemeral entry, and never fills the lunch request from the dinner palette

### Requirement: Capture to grocery list, never flush to cart

On agreement, the agent SHALL record the agreed recipes as planned rows in the meal plan via `update_meal_plan` (committed cook intent) — threading each committed slot's **`meal`** and its `from_vibe` onto the row, setting `planned_for` to the intended cooking date when known, and **adopting the returned row ids** (including the surviving id of a `coalesced: true` add) as the addresses for any later row-level edit; the agent SHALL NOT pass `duplicate: true` unless the member explicitly asked to plan the same recipe twice. Side effects such as pantry verifications ride the same operation. The agent SHALL NOT hand-expand the planned recipes' ingredients into `add_to_grocery_list` calls: the plan's ingredient needs derive at read time (`read_to_buy`), following the plan automatically. `add_to_grocery_list` at this step SHALL be reserved for what derivation cannot produce: **open-world side** ingredients (world-knowledge-derived, `source = "menu"`, `for_recipes = []`, a `note` identifying the side), confirmed extras and optional-ingredient asks, and **materializations** — a derived line the user gave a quantity or note (e.g. the meal-prep doubling's scaled items carry their doubled `quantity` annotation and a "double batch" `note` as explicit `source = "menu"` rows, so the order-time quantity reconcile honors them). **Corpus sides** (`course: side` recipes) SHALL be captured as planned rows like mains — each chosen corpus side earns its own planned slug row (its ingredients then derive like any planned recipe), and any side draft imported during plate-rounding plus any new `pairs_with` edge SHALL be committed in the same operation. **Open-world sides** SHALL be captured as a `sides` array on their **accompanying main's** planned row. The agent SHALL NOT bump `last_cooked` on menu agreement — `last_cooked` moves only when a cook is asserted and logged (see the cooking-history capability). The menu flow SHALL NOT call `place_order` or otherwise write the Kroger cart. Cart population SHALL occur only on an explicit order request.

#### Scenario: Agreed menu captures the plan with meals, without expanding ingredients

- **WHEN** the user agrees to a proposed menu containing lunch and dinner slots whose ingredients the derivation covers
- **THEN** the agent records the recipes via `update_meal_plan` with each slot's `meal` and `from_vibe`, writes **no** per-ingredient `add_to_grocery_list` calls for them, does not call `place_order`, and the derived to-buy read immediately reflects the menu's needs

#### Scenario: A commit against an already-planned recipe converges

- **WHEN** a committed slot's recipe already has exactly one plan row
- **THEN** the add coalesces onto it (`coalesced: true`), the agent adopts the surviving row's id, and no duplicate row is created — `duplicate: true` is never sent by the commit

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

## ADDED Requirements

### Requirement: The meal dimension threads through the conversational flow

The agent's meal-plan and cook flows SHALL carry the meal dimension end-to-end (`AGENT_INSTRUCTIONS.md`, Appendix C band 1). **Attendance is settable conversationally** (D29-final): "the kids are gone this weekend" maps to `attendance: { away: [...] }` and "just the two of us" to `attendance: { only: [...] }` on the propose call — the agent captures it from natural mentions rather than requiring a form. When logging a cook, the agent SHALL pass **`meal`** — inferred from context or time of day, asked when ambiguous, and **omitted** for non-meal events (never guessing `project`) — and SHALL pass **`plan_row_id`** when the conversation is anchored on a specific slot or an explicit duplicate. Persona prose SHALL use the **meal-vibe** naming and the new tool names only (the `*_night_vibe` aliases exist for lagging plugins, never for new prose); retrospective narration SHALL phrase cadence per meal off `by_meal`; onboarding's cooking-rhythm question SHALL capture the per-meal `cadence` map and follow with a `suggest_meal_vibes` offer to seed lunch/breakfast vibes when those cadences are nonzero.

#### Scenario: Attendance is captured from a natural mention

- **WHEN** the member says "the kids are gone this weekend, plan the week"
- **THEN** the agent's `propose_meal_plan` call carries `attendance: { away: [...] }` naming the absent members, and the proposal's diagnostics echo the effective eating set

#### Scenario: A logged cook carries its meal, inferred or asked

- **WHEN** the member says "I made the frittata this morning"
- **THEN** the agent logs it with `meal: "breakfast"`; and when the meal is genuinely ambiguous, the agent asks rather than guessing — and omits `meal` entirely for a non-meal event like baking a loaf

#### Scenario: Onboarding captures the cadence map and offers seeds

- **WHEN** onboarding reaches the cooking-rhythm question and the member says they cook five dinners and want two lunches a week
- **THEN** the agent saves `cadence: { breakfast: 0, lunch: 2, dinner: 5 }` via `update_preferences` and offers `suggest_meal_vibes` to seed lunch vibes — it does not write `default_cooking_nights`
