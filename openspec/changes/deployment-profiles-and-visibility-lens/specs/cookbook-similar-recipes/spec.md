## MODIFIED Requirements

### Requirement: Anonymous, identical-for-every-visitor neighbors

Because the cookbook is an open surface with no caller identity, the neighbor ranking SHALL use cosine similarity alone, with none of the per-tenant favorite, freshness, or pantry-overlap boosts applied by the agent-facing `search_recipes` tool — and both the viewed recipe and every listed neighbor SHALL be inside the **anonymous lens position** (curated-only under SaaS; the full attached corpus under self-hosted), resolved through the shared lens enforcement point. A recipe outside the anonymous lens SHALL never appear as a neighbor, be counted toward the neighbor cap, or influence the rendered list, so the similar list cannot leak the existence of lens-scoped recipes. Every visitor SHALL see the same similar recipes for the same recipe on a given deployment.

#### Scenario: Same neighbors for every visitor

- **WHEN** two different visitors view the same anonymously-visible recipe page
- **THEN** they see the same Similar Recipes, independent of any household's favorites, cooking history, or pantry

#### Scenario: Lens-scoped recipes never appear as neighbors

- **WHEN** a SaaS deployment holds a household-only recipe whose embedding is the nearest vector to a curated recipe being viewed anonymously
- **THEN** the Similar Recipes section lists only curated-tier neighbors — the household-only recipe is absent and does not occupy a neighbor slot

#### Scenario: Self-hosted neighbors are unchanged

- **WHEN** a recipe page renders on a self-hosted deployment after attachment convergence
- **THEN** the neighbor list is computed over the full attached corpus, exactly as before this change
