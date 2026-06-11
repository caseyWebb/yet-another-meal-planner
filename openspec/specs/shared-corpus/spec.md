# shared-corpus Specification

## Purpose
TBD - created by archiving change multi-tenant-friend-group. Update Purpose after archive.
## Requirements
### Requirement: Shared recipe corpus of objective content

Recipe **content** — the objective frontmatter (title, tags, protein, cuisine, style, times, servings, difficulty, dietary, season, veg_forward, ingredients_key, meal_preppable, uses/produces_components, `pairs_with`, `standalone`, `requires_equipment`, source, discovered_at, discovery_source) and the markdown body — SHALL live under `recipes/` at the **root** of the single shared data repository, read by all tenants. A recipe SHALL exist once in the shared corpus regardless of how many tenants reference it; discovery/import SHALL be idempotent by source URL or slug so a recipe already present is not duplicated. The shared content SHALL NOT carry any per-tenant subjective field. `pairs_with` (an array of recipe slugs naming plate-companion sides), `standalone` (an optional boolean marking an already-rounded plate), and `requires_equipment` (an array of controlled-vocabulary equipment slugs naming the gear a dish is genuinely impossible without) are objective content shared by all tenants, distinct from the per-tenant subjective fields. `requires_equipment` SHALL be carried into `_indexes/recipes.json` so the makeability gate can read it without opening each recipe file, and SHALL be settable by `create_recipe` and `update_recipe` (the latter being the path to backfill an existing recipe).

#### Scenario: A recipe is shared, not duplicated per tenant

- **WHEN** a recipe is imported and it already exists in the shared corpus (same source URL or slug)
- **THEN** the existing shared recipe is reused rather than a second copy being created

#### Scenario: Shared content excludes subjective fields

- **WHEN** a shared corpus recipe's frontmatter is inspected
- **THEN** it contains only objective fields and carries no per-tenant `rating`, `last_cooked`, or `status`

#### Scenario: Pairing edges are shared content

- **WHEN** one tenant records a `pairs_with` edge or a `standalone` flag on a shared recipe
- **THEN** that edge and flag are part of the shared recipe content and are visible to every tenant, not stored in any tenant's overlay

#### Scenario: Required equipment is shared content carried into the index

- **WHEN** a recipe declares `requires_equipment: ["pressure-cooker"]`
- **THEN** that array is part of the shared recipe content, is carried into `_indexes/recipes.json`, and is visible to every tenant, not stored in any tenant's overlay

#### Scenario: update_recipe backfills required equipment

- **WHEN** `update_recipe` sets `requires_equipment` on a recipe that previously had none
- **THEN** the shared recipe content and the rebuilt index reflect the new requirement for every tenant

### Requirement: Per-tenant overlay of subjective fields

Each tenant SHALL carry a per-tenant **overlay** for the subjective single-value fields `rating` and `status`, stored as a single `users/<username>/overlay.toml` keyed by recipe slug. The third per-tenant subjective field, `last_cooked`, is NOT stored in the overlay: it is **derived** from that tenant's own `users/<username>/cooking_log.toml` (the max cook date for the slug), reconciling with the cooking-log capability. Read tools SHALL join shared content with the caller's overlay (rating/status) and the caller's cooking-log-derived last_cooked, so each tenant sees their own subjective view of shared recipes. When a tenant has no overlay row for a shared recipe, its effective `status` for that tenant SHALL default to `draft`. Disposition SHALL be per-tenant: one tenant marking a recipe `active`, `rejected`, or `archived` SHALL NOT change any other tenant's status for it.

#### Scenario: Overlay joined at read time

- **WHEN** tenant A reads a shared recipe for which A has an overlay rating of 5 and `status: active`
- **THEN** the recipe is returned with A's rating and active status merged onto the shared content

#### Scenario: Absent overlay defaults to draft

- **WHEN** a recipe exists in the shared corpus but the caller has no overlay row for it
- **THEN** the recipe's effective status for that caller is `draft`

#### Scenario: Disposition is per-tenant

- **WHEN** tenant A sets `status: rejected` on a shared recipe and tenant B sets `status: active` on the same recipe
- **THEN** both states coexist; A sees it rejected and B sees it active

### Requirement: Private-recipe escape hatch

A tenant SHALL be able to keep personal recipes in their own repo that are not part of the shared corpus. A tenant's effective recipe set SHALL be the union of the shared corpus and that tenant's personal recipes. A personal recipe SHALL be visible only to its owning tenant and SHALL NOT appear in any other tenant's corpus.

#### Scenario: Personal recipe visible only to owner

- **WHEN** tenant A creates a personal (unshared) recipe in A's repo
- **THEN** it appears in A's recipe set and does not appear for tenant B

#### Scenario: Effective set is shared union personal

- **WHEN** tenant A lists recipes
- **THEN** the results include both shared corpus recipes (with A's overlay) and A's personal recipes

### Requirement: Shared, location-tagged SKU cache

The Kroger SKU cache SHALL live in the shared corpus and each cached entry SHALL be tagged with the Kroger `locationId` it was resolved at. A cache lookup SHALL still revalidate the SKU against the caller's preferred location before use (price + curbside/delivery availability), so a shared cache cannot serve an entry that is unavailable at the caller's store. A resolution by one tenant SHALL be available as a cache candidate to others, subject to that per-location revalidation.

#### Scenario: Cross-tenant cache hit revalidated per location

- **WHEN** tenant A resolved an ingredient to a SKU at location L1, and tenant B (preferred location L2) looks up the same ingredient
- **THEN** the shared entry is a candidate but is revalidated against L2, and is used only if available there (otherwise it falls through to search)

#### Scenario: Cache entries are location-tagged

- **WHEN** a resolved mapping is written to the shared SKU cache
- **THEN** it records the `locationId` at which it was resolved

### Requirement: Shared reference data

The reference-data files `aliases.toml` and `ingredients.toml` SHALL live in the shared corpus and be read by all tenants. `substitutions.toml` SHALL default to the shared corpus, with an optional per-tenant override layer so a tenant can carry personal substitution rules; where a tenant override exists it SHALL take precedence over the shared rule for that tenant only.

#### Scenario: Shared aliases apply to all tenants

- **WHEN** any tenant normalizes an ingredient term
- **THEN** the shared `aliases.toml` is consulted, identically for every tenant

#### Scenario: Per-tenant substitution override wins for that tenant

- **WHEN** a tenant has a personal substitution rule for an ingredient that also has a shared rule
- **THEN** the tenant's override is applied for that tenant, while other tenants still see the shared rule

