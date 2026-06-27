## MODIFIED Requirements

### Requirement: Plate-rounding with side pairings

When assembling a menu, the agent SHALL round out each main that is not an already-complete plate by surfacing or sourcing a savory side (starch, vegetable, salad, or bread). Whether a main is an already-rounded plate (a one-pot dish, a composed grain bowl, a protein-plus-vegetable sheet-pan dinner) SHALL be **inferred by the agent at plan time** from the recipe's content — there is no persisted `standalone` flag to gate on, and the agent SHALL NOT prompt for a side when it judges the main already stands alone. For a non-standalone main, side sourcing SHALL follow the shared cheapest-first side-resolution ladder (defined by the `recipe-sides` capability): curated `pairs_with` corpus sides first, then corpus retrieval, then a sourced import, then an open-world side. Within a menu request this resolution SHALL be part of the single holistic reasoning pass over the faceted load and loaded pantry (see "Holistic plate reasoning over one faceted load"), not a separate phase that issues its own recipe-search calls — i.e. the menu flow draws corpus sides from the faceted load already in hand rather than re-querying. A chosen side MAY be either a **corpus side** (a `course: side` recipe) or an **open-world side** (a trivial preparation named from world knowledge — "white rice", "a simple arugula salad" — that needs no recipe file). Drink, wine, and dessert pairings are out of scope for this capability.

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

When a non-standalone main has an empty `pairs_with` and the natural companion warrants a saved recipe (a side with technique worth keeping, not a one-line preparation), the menu flow MAY bootstrap a **corpus** pairing at plan time as opportunistic backfill — the `recipe-sides` flow is the primary author of `pairs_with`, and the menu flow records an edge only for a pairing it confirms in the course of planning. The bootstrap SHALL follow the shared side-resolution ladder: prefer existing `course: side` recipes (already in hand from the faceted load), then the RSS discovery pool (`fetch_rss_discoveries`), then a web parse (`parse_recipe`); it SHALL propose at most two candidate sides in chat; and on the user accepting such a side it SHALL ensure the side exists as a recipe (importing it via `parse_recipe` → `create_recipe` when it does not already exist, classified with `course: [side]`) and SHALL record the pairing by adding the side's slug to the main's `pairs_with` through `update_recipe`. The recorded edge is shared content, so a later menu request for the same main SHALL find the pairing already present and surface it. When the natural companion is instead a **trivial open-world side**, the agent SHALL NOT import a recipe or record a `pairs_with` edge — it proposes the open-world side directly (re-derived by reasoning each time, since it has no slug to remember). The bootstrap SHALL select sides by plate fit.

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
