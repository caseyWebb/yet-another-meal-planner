## ADDED Requirements

### Requirement: Cookbook search entry point

The `/cookbook` route SHALL accept an optional `q` query parameter. When `q` is absent or empty after trimming, the route SHALL render the existing alphabetical index unchanged. When `q` is non-empty, the route SHALL render a results page for that query. The route SHALL remain open (no authentication) and read-only (GET/HEAD only), and the search control SHALL be a server-rendered `<form method="GET">` requiring no client-side script, leaving the page's restrictive `Content-Security-Policy` (no script) unchanged.

#### Scenario: Empty query renders the full index

- **WHEN** `/cookbook` is requested with no `q`, or an all-whitespace `q`
- **THEN** the full alphabetical recipe index is rendered, as it is today

#### Scenario: Non-empty query renders results

- **WHEN** `/cookbook?q=tacos` is requested
- **THEN** a results page for "tacos" is rendered, reusing the recipe-list UI

#### Scenario: Search adds no script

- **WHEN** any `/cookbook` page is rendered
- **THEN** the response carries the same restrictive CSP, contains no `<script>`, and the search form submits via GET

### Requirement: Two-tier hybrid ranking

A non-empty query SHALL be answered by merging two tiers: a **substring tier** — every recipe whose title or tags contain every query token as a case-insensitive substring (the same text match the membership mode of `search_recipes` applies) — and a **semantic tier** — recipes ranked by cosine similarity between the embedded query and the recipe's stored embedding. Substring-tier matches SHALL be ordered ahead of semantic-only matches, and the two tiers SHALL be deduplicated by slug so no recipe appears twice.

#### Scenario: Exact-intent match is surfaced first

- **WHEN** a query names a dish that exists by title, e.g. "tacos"
- **THEN** the recipe whose title matches appears ahead of merely semantically-related recipes

#### Scenario: Semantic neighbours fill in

- **WHEN** a query expresses a vibe with no literal title or tag match, e.g. "cozy rainy night"
- **THEN** recipes are returned ranked by semantic similarity to the query

#### Scenario: A recipe matching both tiers appears once

- **WHEN** a recipe matches the query by both substring and embedding
- **THEN** it appears exactly once, in the substring tier

### Requirement: Similarity floor and empty results

Semantic-tier candidates whose cosine similarity is below a configured floor SHALL be excluded, so a query that matches nothing meaningful does not return the whole corpus weakly ranked. When neither tier yields a result, the route SHALL render a clean "no matches" state with HTTP 200 and a link back to the full index.

#### Scenario: Weak matches are excluded

- **WHEN** a query has no substring hit and its closest recipe is below the similarity floor
- **THEN** that recipe is not returned

#### Scenario: No matches renders an empty state

- **WHEN** a query yields no substring hits and no above-floor semantic matches
- **THEN** a "no matches" page is rendered with a link back to the full cookbook, not an error

### Requirement: Graceful degradation without embeddings

The semantic tier SHALL NOT be load-bearing. When the query embedding cannot be produced or the recipe embeddings cannot be loaded — e.g. Workers AI is unavailable or the embed index is empty — the route SHALL render the substring-tier results alone and SHALL NOT return a server error. A recipe that has no stored embedding (e.g. imported since the last reconcile) SHALL remain findable through the substring tier.

#### Scenario: Embedding failure falls back to substring

- **WHEN** the query embed call fails
- **THEN** the substring-tier results are rendered and the response is not a 5xx

#### Scenario: Not-yet-embedded recipe is still findable

- **WHEN** a recipe has been imported but not yet embedded, and the query matches its title
- **THEN** it appears in the results via the substring tier

### Requirement: Query-vector cache

A query's embedding vector SHALL be cached, keyed by the embedding model and the normalized query text, so repeated queries reuse the vector without a new Workers AI call. The cache SHALL store the query **vector**, not the result list, so that a corpus reconcile is reflected on the next search with no cache invalidation, and a change of embedding model SHALL produce a different key so no stale-dimension vector is reused.

#### Scenario: Repeat query skips the embed call

- **WHEN** the same normalized query is searched again while its vector is cached
- **THEN** the cached vector is used and no new embed call is made

#### Scenario: Reconcile reflected without invalidation

- **WHEN** the recipe corpus is re-embedded after a query's vector was cached
- **THEN** the next search for that query ranks against the updated recipe embeddings using the still-valid cached query vector

### Requirement: Anonymous relevance-only ranking

Because the cookbook is an open, cross-tenant surface with no caller identity, cookbook search ranking SHALL use semantic relevance (cosine) alone, with none of the per-tenant favourite, freshness, or pantry-overlap boosts applied by the agent-facing `search_recipes` tool.

#### Scenario: No per-tenant boosts

- **WHEN** two different visitors search the same query
- **THEN** they receive the same ranking, independent of any tenant's favourites, cooking history, or pantry
