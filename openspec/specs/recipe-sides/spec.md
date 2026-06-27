# recipe-sides Specification

## Purpose
TBD - created by archiving change add-recipe-sides. Update Purpose after archive.
## Requirements
### Requirement: Standalone sides flow decoupled from planning

The agent SHALL expose a `recipe-sides` flow that answers "what sides go with X" as a corpus-building activity, independent of meal planning. The flow SHALL NOT write to the meal plan and SHALL NOT touch the cart; its only persistent effects are recipe imports (`create_recipe`) and plating-edge writes (`update_recipe` of `pairs_with`). Its skill description SHALL match free-form side questions ("good sides for grilled swordfish?", "what should I serve with the short-rib ragù?") so the agent routes them here rather than into a menu request. The flow SHALL depend on the `corpus` and `discovery` depth tiers.

#### Scenario: Free-form side question routes to recipe-sides

- **WHEN** the user asks "what are some good sides for X?" without requesting a meal plan
- **THEN** the agent runs the `recipe-sides` flow and proposes sides, and does NOT assemble a menu, write a meal plan, or add anything to the cart

#### Scenario: No persistent planning side effects

- **WHEN** the `recipe-sides` flow completes
- **THEN** the only writes it may have made are recipe imports and `pairs_with` edges — no `update_meal_plan`, no grocery-list or cart writes

### Requirement: Two entry modes resolve the main

The flow SHALL resolve its subject X through one of two entry modes. When X resolves to an existing corpus main, the agent SHALL use that main's `side_search_terms` and `pairs_with` as the basis for side resolution. When X is a bare dish concept not in the corpus, the agent SHALL reason the kind of complementary side from world knowledge and use that as the basis. In both modes the agent SHALL then run the shared side-resolution ladder. For a main just imported in the same session, the agent SHALL use the `side_search_terms` it holds from that import's parse rather than waiting for the new recipe to become semantically retrievable.

#### Scenario: Corpus main drives resolution from its memoized terms

- **WHEN** X names a main already in the corpus
- **THEN** the agent uses that main's `side_search_terms` and existing `pairs_with` to drive side resolution

#### Scenario: Bare concept drives resolution from world knowledge

- **WHEN** X is a dish concept with no corpus recipe
- **THEN** the agent reasons the complementary side profile from world knowledge and runs the ladder, without requiring a corpus main to exist

#### Scenario: Just-imported main uses in-session terms

- **WHEN** the subject main was imported earlier in the same session and is not yet semantically retrievable
- **THEN** the agent uses the `side_search_terms` held from that import rather than re-searching for the main

### Requirement: Shared cheapest-first side-resolution ladder

Side resolution SHALL follow a single cheapest-first, highest-confidence-first ladder, defined once and referenced by the `meal-plan` flow: (1) surface curated `pairs_with` corpus sides when present; (2) otherwise retrieve corpus sides with a `search_recipes` spec whose vibe is the subject's side terms and `facets: { course: "side" }`; (3) otherwise propose new sides to source and, on confirmation, import them; (4) otherwise propose a trivial open-world side named from world knowledge. The agent SHALL stop at the first rung that satisfies the request and SHALL NOT search the web when curated or corpus sides already answer it.

#### Scenario: Curated pairing short-circuits the ladder

- **WHEN** the subject main's `pairs_with` already names suitable corpus sides
- **THEN** the agent surfaces those and does not run corpus retrieval or web import

#### Scenario: Corpus retrieval before web import

- **WHEN** `pairs_with` is empty but the corpus holds matching `course: side` recipes
- **THEN** the agent surfaces those corpus sides and does not propose a speculative web import

#### Scenario: Trivial companion stays open-world

- **WHEN** the natural companion is a one-line preparation (steamed rice, dressed greens)
- **THEN** the agent proposes it as an open-world side, imports no recipe, and records no `pairs_with` edge

### Requirement: Propose-then-confirm gate for speculative side import

When the corpus has no or only a few matching sides and the agent would source new ones from outside the corpus, it SHALL first propose a short list of candidate sides and obtain the user's confirmation before importing any of them. The confirmation SHALL be at the granularity of which sides to pursue, not a per-recipe re-confirmation; once the user picks, each chosen side imports on sight via the standard import mechanics. This propose-then-confirm gate is the deliberate exception to importing on sight, because these are agent-proposed speculative additions to the shared corpus, not a recipe the user handed over. The agent SHALL propose only a few candidates, never a bulk import.

#### Scenario: Corpus thin, agent asks before web import

- **WHEN** corpus retrieval yields no or only a few suitable sides and the agent intends to source new ones
- **THEN** the agent proposes a short list of candidate sides and waits for the user to choose before calling `parse_recipe` or `create_recipe`

#### Scenario: Confirmation is per-selection, not per-recipe

- **WHEN** the user picks which proposed sides to pursue
- **THEN** the agent imports each chosen side on sight without a further per-recipe confirmation prompt

### Requirement: Recipe-sides is the primary author of plating edges

When the user accepts a corpus side for a corpus main, the agent SHALL record the plating edge by adding the side's slug to the main's `pairs_with` via `update_recipe`. The `recipe-sides` flow SHALL be the primary author of `pairs_with`; the planning flows record the edge only as opportunistic backfill. Open-world sides have no slug and SHALL NOT be written to `pairs_with`. A side imported through this flow SHALL be classified `course: [side]` and, having no `side_search_terms`, SHALL NOT trigger a further round of side resolution — the recursion is one level deep.

#### Scenario: Accepted corpus side records the edge

- **WHEN** the user accepts a corpus side for a corpus main
- **THEN** the agent adds the side's slug to the main's `pairs_with` via `update_recipe`

#### Scenario: Imported side does not recurse

- **WHEN** a chosen side is imported and classified `course: [side]`
- **THEN** the agent does not run side resolution on that side, because a side carries no `side_search_terms`

#### Scenario: Open-world side is not recorded

- **WHEN** the accepted companion is an open-world trivial side with no recipe
- **THEN** the agent records no `pairs_with` edge for it

### Requirement: Import-recipe hands off to recipe-sides

After successfully importing a recipe classified as a `main`, the `import-recipe` flow SHALL end with a light, single offer to line up sides for it, handing off to the `recipe-sides` flow when the user accepts. The offer SHALL NOT block the import or place anything on a plan, and SHALL NOT fire for an import that is not a main.

#### Scenario: Main import offers sides

- **WHEN** `import-recipe` finishes importing a recipe with `course` including `main`
- **THEN** it offers once to line up sides and runs `recipe-sides` only if the user accepts

#### Scenario: Non-main import makes no side offer

- **WHEN** `import-recipe` finishes importing a side, dessert, or sauce
- **THEN** it makes no side-pairing offer
