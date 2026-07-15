## MODIFIED Requirements

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
