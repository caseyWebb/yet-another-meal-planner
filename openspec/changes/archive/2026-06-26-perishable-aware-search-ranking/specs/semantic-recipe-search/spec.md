# semantic-recipe-search Specification

## ADDED Requirements

### Requirement: Retrieval boosts recipes that use the caller's at-risk ingredients

Each `recipe_semantic_search` spec SHALL accept an optional `boost_ingredients: string[]` — normalized item names the caller wants the ranker to bias toward (the at-risk perishables / on-hand items the agent judged worth using up). Within a spec's candidate set, the system SHALL add a bounded pantry-overlap term to each candidate's score, computed as a two-tier set-overlap between the spec's `boost_ingredients` and the candidate's `ingredients_key ∪ perishable_ingredients`: a boost item that matches the recipe's `perishable_ingredients` SHALL contribute MORE than one that matches only `ingredients_key`, because consuming an at-risk perishable is the waste-prevention win. Boost items SHALL be normalized through the same alias table the index uses before matching, so synonym collapse is alias-driven; the system SHALL NOT embed individual ingredients. The total pantry-overlap boost SHALL be small relative to cosine and SHALL saturate, so it nudges ordering without overriding semantic relevance, can never admit a recipe the facet gate rejected, and never excludes a candidate that has zero overlap. The boost SHALL be a no-op when a spec omits `boost_ingredients` or when no candidate ingredient matches. Each returned row SHALL carry a `pantry_overlap` field listing which boost items that recipe hit, so the caller can explain a surfaced pick.

#### Scenario: Perishable overlap outranks key-only overlap

- **WHEN** a spec passes `boost_ingredients: ["bok choy"]` and two otherwise equally-relevant candidates survive — one listing `bok choy` in its `perishable_ingredients`, the other listing it only in `ingredients_key`
- **THEN** both are boosted, but the recipe that treats `bok choy` as a perishable receives the larger boost and ranks ahead of the key-only match

#### Scenario: Overlap nudges but does not override relevance

- **WHEN** a candidate matches several `boost_ingredients` but is semantically far from the spec's `vibe`
- **THEN** the saturated pantry-overlap boost is too small to lift it above genuinely on-vibe candidates, and a recipe the facets rejected is never admitted by overlap

#### Scenario: Synonyms collapse via the alias table

- **WHEN** a spec passes `boost_ingredients: ["scallions"]` and an alias maps `scallions` to `green onions`, which a candidate lists
- **THEN** the normalized boost item matches the candidate's normalized ingredient and the recipe is boosted, with no per-ingredient embedding involved

#### Scenario: Overlap is reported per row

- **WHEN** a candidate is boosted because it uses two of the spec's `boost_ingredients`
- **THEN** its returned row carries `pantry_overlap` listing those two items, and a candidate with zero overlap is still returned (unboosted) rather than excluded

#### Scenario: Absent boost_ingredients is a no-op

- **WHEN** a spec omits `boost_ingredients`
- **THEN** ranking is unchanged from the cosine + favorite + freshness blend and every row's `pantry_overlap` is empty
