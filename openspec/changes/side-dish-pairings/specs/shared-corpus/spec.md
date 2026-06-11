## MODIFIED Requirements

### Requirement: Shared recipe corpus of objective content

Recipe **content** — the objective frontmatter (title, tags, protein, cuisine, style, times, servings, difficulty, dietary, season, veg_forward, ingredients_key, meal_preppable, uses/produces_components, `pairs_with`, `standalone`, source, discovered_at, discovery_source) and the markdown body — SHALL live under `recipes/` at the **root** of the single shared data repository, read by all tenants. A recipe SHALL exist once in the shared corpus regardless of how many tenants reference it; discovery/import SHALL be idempotent by source URL or slug so a recipe already present is not duplicated. The shared content SHALL NOT carry any per-tenant subjective field. `pairs_with` (an array of recipe slugs naming plate-companion sides) and `standalone` (an optional boolean marking an already-rounded plate) are objective content shared by all tenants, distinct from the per-tenant subjective fields.

#### Scenario: A recipe is shared, not duplicated per tenant

- **WHEN** a recipe is imported and it already exists in the shared corpus (same source URL or slug)
- **THEN** the existing shared recipe is reused rather than a second copy being created

#### Scenario: Shared content excludes subjective fields

- **WHEN** a shared corpus recipe's frontmatter is inspected
- **THEN** it contains only objective fields and carries no per-tenant `rating`, `last_cooked`, or `status`

#### Scenario: Pairing edges are shared content

- **WHEN** one tenant records a `pairs_with` edge or a `standalone` flag on a shared recipe
- **THEN** that edge and flag are part of the shared recipe content and are visible to every tenant, not stored in any tenant's overlay
