## ADDED Requirements

### Requirement: Plate-rounding with side pairings

When assembling a menu, the agent SHALL round out each main that is not an already-complete plate by surfacing or sourcing a savory side (starch, vegetable, salad, or bread) and treating that side as a recipe. A main SHALL be treated as already-rounded when its frontmatter declares `standalone: true`; the agent SHALL NOT prompt for a side in that case. When `standalone` is unset, the agent SHALL infer at plan time whether the main is already a rounded plate (e.g. a one-pot dish, a composed grain bowl, a protein-plus-vegetable sheet-pan dinner); if it concludes the main stands alone, it MAY offer to persist `standalone: true` via `update_recipe` but SHALL NOT write that flag without the user's assent. For a non-standalone main, if its `pairs_with` already names one or more sides, the agent SHALL surface those remembered sides for the user to choose from rather than sourcing a new one. The plate-rounding judgment SHALL run after the mains are tentatively chosen and before the parallel context-gathering batch, so any chosen side's ingredients are included in pantry verification and in the `kroger_prices` call. Drink, wine, and dessert pairings are out of scope for this capability.

#### Scenario: Standalone main is not prompted for a side

- **WHEN** a chosen main declares `standalone: true`
- **THEN** the agent does not propose or source a side for it and proceeds to assemble the proposal

#### Scenario: Unset standalone triggers inference and an offer

- **WHEN** a chosen main has no `standalone` flag and the agent judges it an already-rounded one-pot plate
- **THEN** the agent treats it as standalone for this menu and offers to persist `standalone: true`, writing the flag only if the user agrees

#### Scenario: Remembered pairing is surfaced

- **WHEN** a non-standalone main's `pairs_with` already names a side recipe
- **THEN** the agent surfaces that remembered side for the user to accept rather than searching for a new one

#### Scenario: Chosen side joins the pantry and pricing pass

- **WHEN** the user accepts a side for a main before the context batch runs
- **THEN** the agent verifies the side's pantry needs and includes the side's ingredients in the `kroger_prices` call alongside the mains' ingredients

### Requirement: Side pairing bootstrap when the edge is empty

When a non-standalone main has an empty `pairs_with`, the agent SHALL bootstrap a pairing at plan time: it SHALL search for a suitable savory side, preferring existing corpus recipes (via `list_recipes`), then the RSS discovery pool (`fetch_rss_discoveries`), then a web import (`import_recipe`); it SHALL propose at most two candidate sides in chat; and on the user accepting a side it SHALL ensure the side exists as a recipe (importing it as a `status: draft` recipe via the discovery path when it does not already exist) and SHALL record the pairing by adding the side's slug to the main's `pairs_with` through `update_recipe`. The recorded edge is shared content, so a later menu request for the same main SHALL find the pairing already present and surface it without re-bootstrapping. The bootstrap SHALL select sides by plate fit and SHALL NOT read or reason over the `produces_components` / `uses_components` graph; component-based (bidirectional) batch/sequencing suggestion is out of scope here and deferred to `suggest_sequencing` (Change 13).

#### Scenario: Empty pairs_with bootstraps a side

- **WHEN** a non-standalone main has an empty `pairs_with` and the user requests a menu including it
- **THEN** the agent searches corpus-then-RSS-then-web, proposes one or two savory sides, and asks the user to choose

#### Scenario: Accepted bootstrap imports the side and records the edge

- **WHEN** the user accepts a proposed side that is not yet in the corpus
- **THEN** the agent imports it as a `status: draft` recipe and adds its slug to the main's `pairs_with` in the same commit

#### Scenario: Recorded pairing is reused next time

- **WHEN** a later menu request includes the same main whose `pairs_with` now names the previously-recorded side
- **THEN** the agent surfaces the recorded side and does not re-run the bootstrap search

## MODIFIED Requirements

### Requirement: Capture to grocery list, never flush to cart

On agreement, the agent SHALL persist the menu's to-buy items to `grocery_list.toml` via `commit_changes`/`add_to_grocery_list` (ingredient-level, SKU-free), and SHALL record the agreed recipes as `[[planned]]` rows in `meal_plan.toml` (committed cook intent), setting `planned_for` to the intended cooking night when known, along with side effects such as pantry verifications. Agreed **sides** are recipes and SHALL be captured the same way: each chosen side earns its own `[[planned]]` row, its to-buy ingredients are added to `grocery_list.toml`, and any side draft imported during plate-rounding plus any new `pairs_with` edge or persisted `standalone` flag SHALL be committed in the same operation. The agent SHALL NOT bump `last_cooked` on menu agreement — `last_cooked` moves only when a cook is asserted and logged (see the cooking-history capability). The menu flow SHALL NOT call `place_order` or otherwise write the Kroger cart. Cart population SHALL occur only on an explicit order request (Change 06b).

#### Scenario: Agreed menu captures intent without touching the cart

- **WHEN** the user agrees to a proposed menu
- **THEN** the agent commits the to-buy items to `grocery_list.toml`, writes the agreed recipes to `meal_plan.toml`, and does NOT call `place_order` or write the Kroger cart

#### Scenario: Agreed side captures as its own planned recipe

- **WHEN** the user agrees to a menu in which a main was rounded out with a side
- **THEN** the agent writes a `[[planned]]` row for the side, adds the side's to-buy ingredients to `grocery_list.toml`, and commits any new `pairs_with` edge or imported side draft in the same commit

#### Scenario: Agreement does not record a cook

- **WHEN** the user agrees to a proposed menu
- **THEN** no `cooking_log.toml` entry is appended and no recipe's `last_cooked` is changed

#### Scenario: Empty-cart case is stated explicitly

- **WHEN** the pantry already covers everything the agreed menu needs
- **THEN** the agent says so explicitly, commits any pantry verifications, writes the agreed recipes to `meal_plan.toml`, and adds nothing to `grocery_list.toml`
