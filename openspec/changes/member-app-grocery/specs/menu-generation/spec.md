## MODIFIED Requirements

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

### Requirement: Menu-generation smoke-test validation

The meal-plan flow SHALL be validated by a scripted smoke test of three seeded requests — open-ended ("make me a menu"), recipe-seeded ("let's make chicken and rice this week"), and freeform-constraint ("something comforting, I'm feeling lazy") — each run from a fresh conversation against live data, with a per-seed rubric of required behaviors. The flow is considered correct when each seed's response satisfies its rubric, the user can iterate with a revision, and agreement lands planned rows in the D1 meal plan (via `update_meal_plan`) whose ingredient needs appear in the derived to-buy read — with only open-world-side ingredients, extras, and materializations written as grocery rows, and the cart untouched.

#### Scenario: Recipe-seeded smoke test passes its rubric

- **WHEN** the recipe-seeded seed "let's make chicken and rice this week" is run
- **THEN** the response uses a vibe-less `search_recipes({ specs: [{ facets: { query: "chicken rice", include_unmakeable: true } }] })`, enumerates all genuine matches including the exact-title recipe, disambiguates before verifying the pantry, then runs verification and a proposal

#### Scenario: Open-ended smoke test uses bounded retrieval

- **WHEN** the open-ended seed "make me a menu" is run
- **THEN** the response selects recipes via bounded vibe-bearing `search_recipes` specs (not a whole-corpus dump), folding the `list_new_for_me` discoveries into selection rather than polling/importing discovery sources in-flow

#### Scenario: Capture-not-flush holds across all seeds

- **WHEN** any smoke-test seed reaches agreement
- **THEN** planned rows land in the meal plan, the derived to-buy read reflects their needs, only open-world-side/extra/materialization items are written via `add_to_grocery_list`, and the Kroger cart is not written
