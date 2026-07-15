# semantic-recipe-search Specification

## Purpose

Defines semantic retrieval over the recipe corpus: an AI-written `description` and memoized `side_search_terms` on each recipe, fixed-dimension embeddings reconciled Worker-side into a sibling `recipe_embeddings` table, and the vibe-present (ranked) mode of `search_recipes(specs[])` that facet-prefilters then ranks survivors by cosine similarity to an embedded `vibe` query. Retrieval re-ranks toward the caller's nearest favorited recipe (multimodal-safe k-NN, not a single centroid) and boosts never-cooked / not-recently-cooked recipes on a configurable rotation window.
## Requirements
### Requirement: Recipes carry an AI-written brief description

Each recipe SHALL carry a **mandatory, non-empty** `description` frontmatter field: a
brief (≈1–2 sentence) summary written by the agent at import in a consistent,
craving-aligned register, describing the dish's identity, flavor/texture, and when one
would want it. The `description` SHALL NOT be the scraped marketing copy from the source
site. It is human-editable (it lives in authored markdown frontmatter); the derived
embedding is rebuilt from whatever the description currently says. Because `description`
is a required field (the `recipe-metadata-contract` capability), a recipe with **no**
description SHALL NOT be writable or buildable — so the only recipe excluded from semantic
ranking is one whose embedding has not **yet** been reconciled (a transient
just-imported state), not a permanent description-less recipe.

#### Scenario: Description is generated at import, not scraped

- **WHEN** a recipe is imported and the source page carries SEO marketing copy
- **THEN** the persisted `description` is the agent's own concise summary, not the source marketing text

#### Scenario: A description-less recipe cannot be persisted

- **WHEN** a recipe write or build presents a recipe with an empty or absent `description`
- **THEN** it is rejected as non-compliant (no permanent description-less, facet-only recipe exists in the corpus)

#### Scenario: Only the pre-reconcile state is excluded from ranking

- **WHEN** a recipe has been imported with a valid `description` but its embedding has not yet been reconciled by the cron
- **THEN** it is transiently excluded from semantic ranking (still returned by facet filters) until the next reconcile fills its embedding

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

### Requirement: search_recipes ranks vibe-bearing specs by facet-prefilter then cosine

A `search_recipes` spec that carries a `vibe` SHALL be served in **ranked mode**: the tool SHALL first apply the caller's visibility lens and the spec's `facets` as the SAME gate the membership mode uses (the lens-visible universe from the shared enforcement point, then the `filterRecipes` constraint over the index — dietary, makeability, recency), then rank the surviving rows **that have an embedding** by cosine similarity between their vector and the embedded `vibe` query, returning the top-`k` (default `DEFAULT_K`, max `MAX_K`) as compact rows (slug, title, description, key facets, score, raw similarity). Survivors with no embedding (e.g. just-imported, not yet reconciled) SHALL be dropped from the ranked group — they remain returnable by a vibe-less membership spec. Hard constraints (the visibility lens, dietary, makeability, and anti-similarity/variety facets) SHALL be enforced by the gate, never overridden by semantic rank — rank reorders gate survivors and can never admit a recipe the lens or a facet rejected. The `vibe` SHALL be embedded in the Worker so callers ship only a query string, and all vibe-bearing specs in one call SHALL be embedded in a single Workers AI request (one subrequest for the batch, not one per spec); a batch containing only vibe-less specs SHALL make no AI request at all. The tool contract SHALL be backend-agnostic: callers SHALL NOT depend on whether ranking is served by a brute-force cosine over the embedding table or an approximate-nearest-neighbor index.

#### Scenario: Facets gate, vibe ranks

- **WHEN** a spec requests vibe "cozy, warming, braise" with facets `{ course: main, protein NOT IN [chicken], makeable: true }`
- **THEN** only lens-visible, main-course, non-chicken, makeable recipes are candidates, and among those the warmest/most-braise-like rank first by cosine

#### Scenario: Rank can never admit an out-of-lens recipe

- **WHEN** the nearest-cosine recipe to a SaaS caller's vibe is held only by a non-friend household
- **THEN** it is not a candidate and cannot appear in any ranked group, regardless of similarity

#### Scenario: Compact candidate shape

- **WHEN** a ranked group is returned
- **THEN** each row carries the slug, title, brief description, key facets, and a score — not the full recipe body or full metadata — so the candidate set stays token-cheap

#### Scenario: Unembedded survivor dropped from a ranked group

- **WHEN** a vibe-bearing spec's facets admit a visible recipe that has no embedding yet
- **THEN** that recipe is absent from the ranked group, but a sibling vibe-less spec with the same facets still returns it

#### Scenario: Batched specs in one call, one embed request

- **WHEN** the caller submits several vibe-bearing specs in one `search_recipes` call
- **THEN** all are served in a single tool round-trip, returning results grouped by spec, with their vibes embedded in one Workers AI request

#### Scenario: Vibe-less batch makes no AI request

- **WHEN** every spec in a `search_recipes` call omits `vibe`
- **THEN** no embedding/Workers AI request is made and every group is the unranked membership set

