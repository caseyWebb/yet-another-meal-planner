## ADDED Requirements

### Requirement: search_recipes ranks vibe-bearing specs by facet-prefilter then cosine

A `search_recipes` spec that carries a `vibe` SHALL be served in **ranked mode**: the tool SHALL first apply the spec's `facets` as the SAME gate the membership mode uses (the `filterRecipes` constraint over the index — dietary, makeability, recency), then rank the surviving rows **that have an embedding** by cosine similarity between their vector and the embedded `vibe` query, returning the top-`k` (default `DEFAULT_K`, max `MAX_K`) as compact rows (slug, title, description, key facets, score, raw similarity). Survivors with no embedding (e.g. just-imported, not yet reconciled) SHALL be dropped from the ranked group — they remain returnable by a vibe-less membership spec. Hard constraints (dietary, makeability, and anti-similarity/variety facets) SHALL be enforced by the facet filter, never overridden by semantic rank. The `vibe` SHALL be embedded in the Worker so callers ship only a query string, and all vibe-bearing specs in one call SHALL be embedded in a single Workers AI request (one subrequest for the batch, not one per spec); a batch containing only vibe-less specs SHALL make no AI request at all. The tool contract SHALL be backend-agnostic: callers SHALL NOT depend on whether ranking is served by a brute-force cosine over the embedding table or an approximate-nearest-neighbor index.

#### Scenario: Facets gate, vibe ranks

- **WHEN** a spec requests vibe "cozy, warming, braise" with facets `{ course: main, protein NOT IN [chicken], makeable: true }`
- **THEN** only main-course, non-chicken, makeable recipes are candidates, and among those the warmest/most-braise-like rank first by cosine

#### Scenario: Compact candidate shape

- **WHEN** a ranked group is returned
- **THEN** each row carries the slug, title, brief description, key facets, and a score — not the full recipe body or full metadata — so the candidate set stays token-cheap

#### Scenario: Unembedded survivor dropped from a ranked group

- **WHEN** a vibe-bearing spec's facets admit a recipe that has no embedding yet
- **THEN** that recipe is absent from the ranked group, but a sibling vibe-less spec with the same facets still returns it

#### Scenario: Batched specs in one call, one embed request

- **WHEN** the caller submits several vibe-bearing specs in one `search_recipes` call
- **THEN** all are served in a single tool round-trip, returning results grouped by spec, with their vibes embedded in one Workers AI request

#### Scenario: Vibe-less batch makes no AI request

- **WHEN** every spec in a `search_recipes` call omits `vibe`
- **THEN** no embedding/Workers AI request is made and every group is the unranked membership set

## MODIFIED Requirements

### Requirement: Retrieval boosts recipes that use the caller's at-risk ingredients

Each vibe-bearing `search_recipes` spec SHALL accept an optional `boost_ingredients: string[]` — normalized item names the caller wants the ranker to bias toward (the at-risk perishables / on-hand items the agent judged worth using up). Within a spec's ranked candidate set, the system SHALL add a bounded pantry-overlap term to each candidate's score, computed as a two-tier set-overlap between the spec's `boost_ingredients` and the candidate's `ingredients_key ∪ perishable_ingredients`: a boost item that matches the recipe's `perishable_ingredients` SHALL contribute MORE than one that matches only `ingredients_key`, because consuming an at-risk perishable is the waste-prevention win. Boost items SHALL be normalized through the same alias table the index uses before matching, so synonym collapse is alias-driven; the system SHALL NOT embed individual ingredients. The total pantry-overlap boost SHALL be small relative to cosine and SHALL saturate, so it nudges ordering without overriding semantic relevance, can never admit a recipe the facet gate rejected, and never excludes a candidate that has zero overlap. The boost SHALL be a no-op when a spec omits `boost_ingredients`, when a spec is vibe-less (membership mode does not rank), or when no candidate ingredient matches. Each returned ranked row SHALL carry a `pantry_overlap` field listing which boost items that recipe hit, so the caller can explain a surfaced pick.

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

## REMOVED Requirements

### Requirement: recipe_semantic_search retrieves by facet-prefilter then cosine

**Reason**: `recipe_semantic_search` is merged into the unified `search_recipes` tool; its facet-prefilter-then-cosine behavior is now the vibe-present (ranked) mode of `search_recipes`, specified by "search_recipes ranks vibe-bearing specs by facet-prefilter then cosine".
**Migration**: Replace `recipe_semantic_search(specs)` with `search_recipes({ specs })` where each spec carries a `vibe`; the return envelope (`{ results: [{ label, recipes }] }`) and per-row shape are unchanged.
