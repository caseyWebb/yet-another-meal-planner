# semantic-recipe-search Specification

## Purpose

Defines semantic retrieval over the recipe corpus: an AI-written `description` and memoized `side_search_terms` on each recipe, fixed-dimension embeddings reconciled Worker-side into a sibling `recipe_embeddings` table, and the `recipe_semantic_search(specs[])` tool that facet-prefilters then ranks survivors by cosine similarity to an embedded `vibe` query. Retrieval re-ranks toward the caller's nearest favorited recipe (multimodal-safe k-NN, not a single centroid) and boosts never-cooked / not-recently-cooked recipes on a configurable rotation window.

## Requirements

### Requirement: Recipes carry an AI-written brief description

Each recipe SHALL carry a `description` frontmatter field: a brief (≈1–2 sentence) summary written by the agent at import in a consistent, craving-aligned register, describing the dish's identity, flavor/texture, and when one would want it. The `description` SHALL NOT be the scraped marketing copy from the source site. It is human-editable (it lives in authored markdown frontmatter); the derived embedding is rebuilt from whatever the description currently says. A recipe with no `description` SHALL still index and be retrievable by facet, but SHALL be excluded from semantic ranking until a description exists.

#### Scenario: Description is generated at import, not scraped

- **WHEN** a recipe is imported and the source page carries SEO marketing copy
- **THEN** the persisted `description` is the agent's own concise summary, not the source marketing text

#### Scenario: Description is the embed source

- **WHEN** the recipe-embedding reconcile runs over the index
- **THEN** the recipe's embedding is computed from its `description`, and a recipe lacking a `description` is omitted from semantic ranking but still returned by facet filters

### Requirement: Recipes carry memoized side search terms

A main-course recipe SHALL support a `side_search_terms` frontmatter field: AI-written-at-import terms describing the *kind of side that complements this main* (e.g. "bright acidic salad, crusty bread, simple green vegetable"). These terms are the query used for semantic side retrieval, so the complementarity judgment is captured once and the retrieval is plain similarity. `side_search_terms` is additive and does not replace curated `pairs_with`.

#### Scenario: Side terms drive complementary retrieval

- **WHEN** a rich braised main is selected and side retrieval runs
- **THEN** the search uses the main's `side_search_terms` (describing the desired side) rather than the main's own embedding, and returns `course: side` recipes that complement it

### Requirement: Recipe embeddings are reconciled Worker-side into a sibling table

Each recipe's embedding SHALL be a fixed-dimension vector (Workers AI `@cf/baai/bge-base-en-v1.5`, 768-dim) derived from its `description`, stored in a sibling `recipe_embeddings` table keyed by recipe `slug` — NOT a column on the projected recipe-index row. Because the embedding is generated through the `AI` binding, which the Node index build cannot use, it SHALL be reconciled **Worker-side on the existing cron**: each tick embeds recipes whose description is new or changed (gated on a description hash so a steady corpus does ~no work) and prunes embeddings whose slug no longer has a description. The embedding is a derived projection, never authored or hand-edited. The query embedding SHALL be computed in the Worker so that callers ship only a query string.

#### Scenario: A changed description re-embeds on the next reconcile

- **WHEN** a recipe's `description` changes
- **THEN** the cron reconcile re-embeds that recipe into `recipe_embeddings` on a later tick (detected by the description-hash gate), with no separate authored vector and no second managed vector store

#### Scenario: A just-imported recipe is not yet semantically retrievable

- **WHEN** a recipe is imported and its embedding has not yet been reconciled
- **THEN** the recipe is treated as "not yet indexed" for semantic ranking (excluded, not an error) until the reconcile fills its embedding, while remaining retrievable by facet

### Requirement: recipe_semantic_search retrieves by facet-prefilter then cosine

The system SHALL expose `recipe_semantic_search(specs[])` where each spec carries a semantic `vibe` query and structured `facets`. For each spec it SHALL first apply the facets as the SAME gate `list_recipes` uses (the `filterRecipes` constraint over the index — dietary, makeability, recency), then rank the surviving rows that have an embedding by cosine similarity between their vector and the embedded `vibe` query, returning the top-K as compact rows (slug, title, description, key facets, score, raw similarity). Hard constraints (dietary, makeability, and anti-similarity/variety facets) SHALL be enforced by the facet filter, never overridden by semantic rank. The tool contract SHALL be backend-agnostic: callers SHALL NOT depend on whether ranking is served by a brute-force cosine over the embedding table or an approximate-nearest-neighbor index.

#### Scenario: Facets gate, vibe ranks

- **WHEN** a spec requests vibe "cozy, warming, braise" with facets `{ course: main, protein NOT IN [chicken], makeable: true }`
- **THEN** only main-course, non-chicken, makeable recipes are candidates, and among those the warmest/most-braise-like rank first by cosine

#### Scenario: Compact candidate shape

- **WHEN** `recipe_semantic_search` returns candidates
- **THEN** each row carries the slug, title, brief description, key facets, and a score — not the full recipe body or full metadata — so the candidate set stays token-cheap

#### Scenario: Batched specs in one call

- **WHEN** the caller submits K specs
- **THEN** all K are served in a single tool round-trip, returning results grouped by spec

### Requirement: Retrieval re-ranks by nearest favorited recipe

Within a spec's candidate set, the system SHALL apply a taste re-rank that boosts candidates by their maximum cosine similarity to any of the caller's favorited recipes (nearest-liked), NOT by distance to a single averaged taste centroid. When the caller has no favorites, the re-rank SHALL be a no-op and ranking falls back to vibe similarity plus the stated taste/diet profile.

#### Scenario: Nearest-liked boosts, multimodal-safe

- **WHEN** a caller has favorited both delicate Japanese dishes and hearty BBQ, and a candidate is close to one cluster
- **THEN** that candidate is boosted by its similarity to the nearest favorite, and is not penalized for being far from the average of the two clusters

#### Scenario: Cold start falls back

- **WHEN** a caller has no favorited recipes
- **THEN** the taste re-rank is a no-op and candidates rank by vibe similarity and the stated profile

### Requirement: Retrieval boosts never-cooked and not-recently-cooked recipes

The system SHALL boost candidates that the caller has never cooked, or has not cooked within a configurable window, so that imported-but-untried recipes surface. The window and boost strength SHALL be user-configurable via the preferences schema (`rotation.resurface_after_days`, `rotation.novelty_boost`). The freshness boost composes with the favorites re-rank: favorites set the taste direction, freshness rotates among similar candidates.

#### Scenario: A never-made favorite-adjacent recipe surfaces

- **WHEN** the caller loves braises and a braise they have never cooked is a candidate
- **THEN** it is boosted by the freshness signal and surfaces ahead of a braise they cooked last week

#### Scenario: Rotation window is configurable

- **WHEN** the caller sets `rotation.resurface_after_days`
- **THEN** retrieval treats recipes cooked within that window as recently-cooked for the freshness boost

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
