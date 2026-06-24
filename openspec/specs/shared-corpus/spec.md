# shared-corpus Specification

## Purpose
TBD - created by archiving change multi-tenant-friend-group. Update Purpose after archive.
## Requirements
### Requirement: Shared corpus lives in D1, not GitHub TOML

The shared corpus artifacts — ingredient aliases, the store registry, store notes, recipe notes, RSS feeds, the newsletter sender/member allowlist, the discovery inbox, the SKU resolution cache, and flyer terms — SHALL be stored in D1 tables, written and validated by the Worker write tools, and read by query. GitHub SHALL hold only `recipes/*.md` (recipe content). Attributed notes (`store_notes`, `recipe_notes`) SHALL carry an `author` (the writing tenant) and a `private` flag; `read_recipe_notes` SHALL return the caller's own private notes plus everyone's shared notes via a single query, joined with the D1 overlay ratings.

#### Scenario: GitHub holds only recipes

- **WHEN** the corpus is enumerated after the migration
- **THEN** no shared-corpus TOML remains in the data repo, the Worker reads/writes these artifacts in D1, and the only data the Worker reads from GitHub is recipe markdown

#### Scenario: read_recipe_notes is fully D1

- **WHEN** `read_recipe_notes(slug)` is called
- **THEN** notes (own-private + group-shared) and group ratings both come from D1 queries, with no GitHub read

#### Scenario: Attribution and privacy preserved

- **WHEN** a member writes a private note
- **THEN** it is stored with their `author` and `private=1`, and other members do not see it in `read_recipe_notes`

### Requirement: Shared recipe corpus of objective content

Recipe **content** — the objective frontmatter (title, tags, protein, cuisine, style, times, servings, difficulty, dietary, season, veg_forward, ingredients_key, `perishable_ingredients`, meal_preppable, `pairs_with`, `course`, source, discovered_at, discovery_source) and the markdown body — SHALL live under `recipes/` at the **root** of the single shared data repository, read by all tenants. A recipe SHALL exist once in the shared corpus regardless of how many tenants reference it; discovery/import SHALL be idempotent by source URL or slug so a recipe already present is not duplicated. The shared content SHALL NOT carry any per-tenant subjective field. Derived fields are objective content too: `perishable_ingredients` (a normalized list of the recipe's perishable ingredients, classified at import) is shared by all tenants, as are `pairs_with` (an array of recipe slugs naming plate-companion sides) and `course` (an open-vocabulary classification — one or more of `main`, `side`, `dessert`, `breakfast`, … — of what kind of dish the recipe is, classified at import), distinct from the per-tenant subjective fields. The objective frontmatter SHALL NOT include `standalone`: whether a main is an already-rounded plate is inferred by the agent at plan time, not persisted.

#### Scenario: A recipe is shared, not duplicated per tenant

- **WHEN** a recipe is imported and it already exists in the shared corpus (same source URL or slug)
- **THEN** the existing shared recipe is reused rather than a second copy being created

#### Scenario: Course is shared objective content

- **WHEN** a recipe is classified with `course: [main]` at import
- **THEN** that `course` is shared by all tenants (it rides the shared index), not stored in any tenant overlay

### Requirement: Per-tenant overlay of subjective fields

Each tenant SHALL carry a per-tenant **overlay** for the subjective single-value fields `rating` and `status`, stored as rows in the D1 `overlay` table keyed by `(tenant, recipe)`. The third per-tenant subjective field, `last_cooked`, is NOT stored in the overlay: it is **derived** by query from that tenant's own D1 `cooking_log` rows (the max cook date for the slug), reconciling with the cooking-log capability. Read tools SHALL join shared content with the caller's overlay (rating/status) and the caller's cooking-log-derived last_cooked, so each tenant sees their own subjective view of shared recipes. When a tenant has no overlay row for a shared recipe, its effective `status` for that tenant SHALL default to `draft`. Disposition SHALL be per-tenant: one tenant marking a recipe `active`, `rejected`, or `archived` SHALL NOT change any other tenant's status for it.

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

The Kroger SKU cache SHALL live in the shared corpus as rows in the D1 `sku_cache` table (read by all tenants) and each cached entry SHALL be tagged with the Kroger `locationId` it was resolved at. A cache lookup SHALL still revalidate the SKU against the caller's preferred location before use (price + curbside/delivery availability), so a shared cache cannot serve an entry that is unavailable at the caller's store. A resolution by one tenant SHALL be available as a cache candidate to others, subject to that per-location revalidation.

#### Scenario: Cross-tenant cache hit revalidated per location

- **WHEN** tenant A resolved an ingredient to a SKU at location L1, and tenant B (preferred location L2) looks up the same ingredient
- **THEN** the shared entry is a candidate but is revalidated against L2, and is used only if available there (otherwise it falls through to search)

#### Scenario: Cache entries are location-tagged

- **WHEN** a resolved mapping is written to the shared SKU cache
- **THEN** it records the `locationId` at which it was resolved

### Requirement: Shared reference data

The ingredient aliases SHALL live in the shared corpus as rows in the D1 `aliases` table, read by all tenants. There are no shared `substitutions` and no per-tenant substitution-override layer — ingredient substitution is LLM reasoning (over the loaded pantry for inventory subs, and over enumerated Kroger searches for sale subs), not a curated rules file. (There is likewise no shelf-life `ingredients` reference — freshness is LLM-judged, not driven by a table.)

#### Scenario: Shared aliases apply to all tenants

- **WHEN** any tenant normalizes an ingredient term
- **THEN** the shared `aliases` table is consulted, identically for every tenant

#### Scenario: No substitutions reference data is present

- **WHEN** the shared corpus reference data is enumerated
- **THEN** there is no substitutions table and no per-tenant substitution override; substitution candidates are produced by agent reasoning, not read from a file

