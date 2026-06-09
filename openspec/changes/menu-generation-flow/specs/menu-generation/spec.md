## ADDED Requirements

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

On agreement, the agent SHALL persist the menu's to-buy items to `grocery_list.toml` via `commit_changes`/`add_to_grocery_list` (ingredient-level, SKU-free), along with side effects such as `last_cooked` and pantry verifications. The menu flow SHALL NOT call `place_order` or otherwise write the Kroger cart. Cart population SHALL occur only on an explicit order request (Change 06b).

#### Scenario: Agreed menu captures intent without touching the cart

- **WHEN** the user agrees to a proposed menu
- **THEN** the agent commits the to-buy items to `grocery_list.toml` and does NOT call `place_order` or write the Kroger cart

#### Scenario: Empty-cart case is stated explicitly

- **WHEN** the pantry already covers everything the agreed menu needs
- **THEN** the agent says so explicitly, commits any pantry verifications, and adds nothing to `grocery_list.toml`

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
