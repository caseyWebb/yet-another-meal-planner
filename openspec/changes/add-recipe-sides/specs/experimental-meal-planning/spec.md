## ADDED Requirements

### Requirement: Side composition defers to shared side-resolution mechanics

When the semantic planner composes sides for the mains it selects, it SHALL follow the shared cheapest-first side-resolution ladder defined by the `recipe-sides` capability — curated `pairs_with` first, then a `recipe_semantic_search` spec using the main's `side_search_terms` as the vibe with `facets: { course: "side" }`, then a sourced import, then an open-world side — rather than encoding its own variant. As with classic menu planning, the planner records a `pairs_with` edge only as opportunistic backfill for a pairing it confirms while planning; the `recipe-sides` flow remains the primary author of `pairs_with`. Open-world trivial sides have no slug and are not recorded.

#### Scenario: Side terms drive a course-gated side search

- **WHEN** the planner needs a side for a selected main whose `pairs_with` is empty
- **THEN** it issues a `recipe_semantic_search` spec using the main's `side_search_terms` as the vibe with `facets: { course: "side" }`, consistent with the shared ladder

#### Scenario: Confirmed pairing is backfilled, not authored as primary

- **WHEN** the planner confirms a corpus side for a main while composing the plate
- **THEN** it records the `pairs_with` edge as backfill via `update_recipe`, and does not duplicate a separate side-resolution variant of its own
