# menu-generation Specification

## Purpose

Defines the agent-side orchestration of a menu request end-to-end: the parallel context pre-pass (Kroger flyer/prices, ready-to-eat, preferences, taste, pantry verification), exhaustive named-dish enumeration via `list_recipes` `query`, full proposal assembly (freeform constraints, meal-prep, sale substitutions, ready-to-eat, staples/stockup, sized to `default_cooking_nights`), capture-not-flush to `grocery_list.toml`, the deferral of sequencing to Change 13, and the smoke-test rubric that validates the flow. Behavioral requirements are realized in `AGENT_INSTRUCTIONS.md` and validated conversationally.
## Requirements
### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather context by calling `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, `read_preferences`, and `read_taste`, in addition to the Change 08 pantry verification (`verify_pantry_for_recipe` for recipe-seeded requests, `verify_pantry_for_candidates` for open-ended). These context reads SHALL be issued together (in parallel) before the agent assembles a proposal, so that sale data, ready-to-eat availability, preferences, and taste all inform the same proposal.

#### Scenario: Open-ended request gathers full context before proposing

- **WHEN** the user says "make me a menu"
- **THEN** the agent calls `read_preferences`, `read_taste`, `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, and `verify_pantry_for_candidates` before presenting any menu proposal

#### Scenario: Pantry confirmation pass is not skipped

- **WHEN** any menu request is made
- **THEN** the agent runs the comprehensive pantry confirmation pass (including staples and spices) rather than proposing a menu without verifying pantry state

### Requirement: Named-dish exhaustive enumeration

When the user names a specific dish, the agent SHALL use `list_recipes` with the `query` filter to retrieve corpus matches and SHALL enumerate **all** genuine matches returned, rather than surfacing a partial subset from memory. The agent SHALL disambiguate among multiple genuine matches (or confirm the single match) with the user **before** walking the pantry for the chosen recipe.

#### Scenario: Named dish surfaces the exact-title recipe

- **WHEN** the user says "let's make chicken and rice this week" and the corpus contains a recipe titled "Chicken and Rice" plus other chicken-and-rice dishes
- **THEN** the agent calls `list_recipes({ query: "chicken rice" })`, lists every returned match including the recipe titled "Chicken and Rice," and asks which one (or confirms) before verifying the pantry

#### Scenario: No silent under-counting

- **WHEN** `list_recipes` returns N genuine matches for a named dish
- **THEN** the agent presents all N (not a vibe-matched couple) and does not claim a smaller count than the tool returned

### Requirement: Full proposal assembly

The agent SHALL assemble a menu proposal that reasons over the gathered context and the user's original message, and SHALL incorporate, when applicable: freeform constraints (mood/cuisine/effort such as "comfort food," "something Italian," "I'm feeling lazy"); meal-prep callouts for `meal_preppable` recipes on the menu; sale-based substitution opportunities (surfaced only after flyer/price data is available, never before); ready-to-eat opportunity buys; a staples restock list; and stockup alerts for bulk-buy items on sale. The proposal SHALL be sized to the user's cooking frequency (`default_cooking_nights`) unless the user specified otherwise.

#### Scenario: Freeform constraint shapes selection

- **WHEN** the user says "something comforting, I'm feeling lazy this week"
- **THEN** the proposal biases toward comforting and low-effort/meal-preppable recipes while still running the pantry pass and proposing a restock list

#### Scenario: Sale substitutions appear with the proposal, not during pantry verify

- **WHEN** a menu recipe calls for an ingredient whose substitute is on sale
- **THEN** the sale-based substitution is surfaced alongside the menu proposal (after flyer data), not during the pantry confirmation pass

#### Scenario: Proposal sized to cooking frequency

- **WHEN** the user makes an open-ended request and `default_cooking_nights` is 3
- **THEN** the agent proposes 3 cooking nights (not 5 with extras), unless the user asked for a different count

### Requirement: Capture to grocery list, never flush to cart

On agreement, the agent SHALL persist the menu's to-buy items to `grocery_list.toml` via `commit_changes`/`add_to_grocery_list` (ingredient-level, SKU-free), and SHALL record the agreed recipes as `[[planned]]` rows in `meal_plan.toml` (committed cook intent), setting `planned_for` to the intended cooking night when known, along with side effects such as pantry verifications. The agent SHALL NOT bump `last_cooked` on menu agreement — `last_cooked` moves only when a cook is asserted and logged (see the cooking-history capability). The menu flow SHALL NOT call `place_order` or otherwise write the Kroger cart. Cart population SHALL occur only on an explicit order request (Change 06b).

#### Scenario: Agreed menu captures intent without touching the cart

- **WHEN** the user agrees to a proposed menu
- **THEN** the agent commits the to-buy items to `grocery_list.toml`, writes the agreed recipes to `meal_plan.toml`, and does NOT call `place_order` or write the Kroger cart

#### Scenario: Agreement does not record a cook

- **WHEN** the user agrees to a proposed menu
- **THEN** no `cooking_log.toml` entry is appended and no recipe's `last_cooked` is changed

#### Scenario: Empty-cart case is stated explicitly

- **WHEN** the pantry already covers everything the agreed menu needs
- **THEN** the agent says so explicitly, commits any pantry verifications, writes the agreed recipes to `meal_plan.toml`, and adds nothing to `grocery_list.toml`

### Requirement: Sequencing deferred to Change 13

The menu-request flow SHALL tolerate the absence of `suggest_sequencing` and SHALL NOT block on component-based recipe pairing. AGENT_INSTRUCTIONS.md SHALL note that sequencing arrives with Change 13. The agent MAY note an obvious shared-perishable pairing conversationally, but SHALL NOT depend on a sequencing tool call in this change.

#### Scenario: Menu proposes without a sequencing call

- **WHEN** a menu request is made before Change 13 ships
- **THEN** the agent produces a complete proposal without calling `suggest_sequencing` and without leaving a gap where sequencing would have been

### Requirement: Menu-generation smoke-test validation

The menu-generation flow SHALL be validated by a scripted smoke test of three seeded requests — open-ended ("make me a menu"), recipe-seeded ("let's make chicken and rice this week"), and freeform-constraint ("something comforting, I'm feeling lazy") — each run from a fresh conversation against live data, with a per-seed rubric of required behaviors. The flow is considered correct when each seed's response satisfies its rubric, the user can iterate with a revision, and agreement lands items in `grocery_list.toml` with the cart untouched.

#### Scenario: Recipe-seeded smoke test passes its rubric

- **WHEN** the recipe-seeded seed "let's make chicken and rice this week" is run
- **THEN** the response uses `list_recipes({ query: "chicken rice" })`, enumerates all genuine matches including the exact-title recipe, disambiguates before verifying the pantry, then runs verification and a proposal

#### Scenario: Capture-not-flush holds across all seeds

- **WHEN** any smoke-test seed reaches agreement
- **THEN** to-buy items are written to `grocery_list.toml` and the Kroger cart is not written

### Requirement: Discovery surfaced during menu requests

On a menu request, the agent SHALL surface a small number of new discoveries — roughly one to two candidate recipes (from `fetch_rss_discoveries`) and one to two ready-to-eat candidates (from on-sale items in the existing `kroger_flyer` pre-pass call). Recipe discoveries the user shows no objection to SHALL be imported immediately in draft state (`import_recipe` → agent enrichment → `create_recipe`), not deferred until the user expresses interest in this conversation. Ready-to-eat candidates SHALL be deduped against the caller's own `users/<username>/ready_to_eat.toml` catalog by the agent and drafted via `add_draft_ready_to_eat` (which writes that per-tenant catalog). Discovery SHALL NOT block or dominate the menu proposal — it is a side channel, surfaced as 1–2 callouts.

#### Scenario: Menu request surfaces and drafts recipe discoveries

- **WHEN** the agent assembles a menu proposal and `fetch_rss_discoveries` returns fresh candidates
- **THEN** the agent surfaces ~1–2 of them and imports the chosen ones in draft via `import_recipe` + `create_recipe`, without waiting for the user to ask

#### Scenario: On-sale ready-to-eat item not already cataloged is drafted

- **WHEN** the `kroger_flyer` pre-pass surfaces an on-sale ready-to-eat item absent from the caller's `users/<username>/ready_to_eat.toml`
- **THEN** the agent surfaces it as an opportunity buy and drafts it via `add_draft_ready_to_eat` into the caller's per-tenant catalog

#### Scenario: Already-cataloged ready-to-eat sale is not re-drafted

- **WHEN** an on-sale ready-to-eat item already exists in the caller's `users/<username>/ready_to_eat.toml`
- **THEN** the agent does not create a duplicate draft for it

### Requirement: Discoveries are dispositioned conversationally

The agent SHALL let the user disposition draft discoveries in any later conversation through natural requests, mapping them to the existing write tools: a "rate the <source> one N stars" request SHALL promote the recipe draft to `status: active` with that rating via `update_recipe`; a "remove that one" request SHALL set the draft to `status: rejected`; ready-to-eat drafts SHALL be dispositioned analogously via `update_ready_to_eat` against the caller's per-tenant catalog (addressed by `slug`, optionally setting a `rating`). Drafts SHALL remain de-prioritized in subsequent proposals but accessible on explicit request.

#### Scenario: Ready-to-eat draft promoted to active with a rating

- **WHEN** the user says to rate or keep a drafted ready-to-eat item
- **THEN** the agent calls `update_ready_to_eat(slug, …)` to set it `active` with the given `rating` in the caller's catalog

#### Scenario: Ready-to-eat draft rejected

- **WHEN** the user says to stop suggesting a drafted ready-to-eat item
- **THEN** the agent calls `update_ready_to_eat(slug, …)` to set its `status` to `rejected` in the caller's catalog, affecting no other member

### Requirement: Soft variety honoring backed by real history

Menu generation SHALL honor the variety targets and restrictions in `diet_principles.md` **softly**: it SHALL bias proposals toward satisfying the principles, and SHALL explain the tradeoff when it cannot satisfy all of them rather than silently violating or rigidly enforcing them. The agent SHALL ground variety reasoning in real cooking history via `retrospective` (e.g. recent protein/cuisine mix, cadence) rather than intent alone. Restrictions declared as hard exclusions SHALL be treated as gates; variety targets SHALL be treated as soft preferences.

#### Scenario: Variety target shapes the proposal with explanation

- **WHEN** `diet_principles.md` targets fish at least once a week and `retrospective` shows no fish cooked recently
- **THEN** the proposal favors including a fish dish, and if it cannot, the agent explains why

#### Scenario: Hard restriction is not violated

- **WHEN** `diet_principles.md` declares a hard exclusion
- **THEN** the proposal never includes a recipe violating that exclusion

#### Scenario: Variety reasoning uses cooked history, not plans

- **WHEN** the agent reasons about recent protein/cuisine balance
- **THEN** it derives the balance from `retrospective` over `cooking_log.toml` (cooked events), not from `meal_plan.toml` intent

### Requirement: Favored ready-to-eat re-order suggestions

During a menu request, the agent SHALL cross-reference `retrospective`'s `ready_to_eat_favorites` against on-hand stock in `pantry.toml` and surface a restock suggestion for favored ready-to-eat items that are low or out. The suggestion SHALL be a prompt, never an automatic add. On the user's agreement, the agent SHALL write the item to `grocery_list.toml` (committed buy intent) or to `stockup.toml` (a conditional bulk-buy), per the user's choice.

#### Scenario: Favored-but-out item is suggested for restock

- **WHEN** a ready-to-eat item appears frequently in `ready_to_eat_favorites` and its `pantry.toml` stock is low or zero
- **THEN** the agent suggests restocking it during the menu request and adds it to `grocery_list.toml` only on agreement

#### Scenario: Well-stocked favorite is not pushed

- **WHEN** a favored ready-to-eat item still has adequate on-hand stock in `pantry.toml`
- **THEN** the agent does not surface a restock suggestion for it

#### Scenario: Suggestion never auto-adds

- **WHEN** the agent surfaces a restock suggestion
- **THEN** nothing is written to `grocery_list.toml` or `stockup.toml` until the user agrees

