# shared-corpus Specification

## Purpose
TBD - created by archiving change multi-tenant-friend-group. Update Purpose after archive.
## Requirements
### Requirement: Shared recipe corpus of objective content

Recipe **content** — the objective frontmatter (title, tags, protein, cuisine, style, times, servings, difficulty, dietary, season, veg_forward, ingredients_key, `perishable_ingredients`, meal_preppable, `pairs_with`, `course`, source, discovered_at, discovery_source) and the markdown body — SHALL live under `recipes/` in the R2 corpus bucket as one shared corpus. A recipe SHALL exist once regardless of how many households can see it; discovery/import SHALL be idempotent by source URL or slug, and importing an already-present recipe SHALL create a visibility grant for the importing household (a `recipe_imports` row), never a second copy. Which households SEE a recipe is the visibility lens's concern (the `recipe_imports` structure); the content itself SHALL NOT carry any per-tenant subjective field. Derived fields are objective content too: `perishable_ingredients`, `pairs_with`, and `course` are shared, computed once, and visible wherever the recipe is — distinct from the per-tenant subjective fields. The objective frontmatter SHALL NOT include `standalone`: whether a main is an already-rounded plate is inferred by the agent at plan time, not persisted.

#### Scenario: A recipe is shared, not duplicated per household

- **WHEN** a recipe is imported and it already exists in the corpus (same source URL or slug)
- **THEN** the existing recipe is reused — the importing household gains a visibility grant and no second copy is created

#### Scenario: Course is shared objective content

- **WHEN** a recipe is classified with `course: [main]` at import
- **THEN** that `course` is shared derived content riding the index, identical for every household that can see the recipe, and stored in no tenant overlay

#### Scenario: Derived artifacts are computed once across lens boundaries

- **WHEN** two households that are not friends both hold grants on the same recipe
- **THEN** its parse, facets, description, and embedding exist once, identity-keyed — visibility scoping never forks derived artifacts

### Requirement: Per-tenant overlay of disposition fields

Each tenant SHALL carry a per-tenant **overlay** for the disposition boolean fields `favorite` and `reject`, stored as rows in the D1 `overlay` table keyed by `(tenant, recipe)`. There is no `status` lifecycle and no `rating` field in the overlay — the retired `active`/`draft`/`rejected`/`archived` status and numeric rating have been superseded by the `favorite`/`reject` disposition model. `last_cooked` is NOT stored in the overlay: it is **derived** by query from that tenant's own D1 `cooking_log` rows (the max cook date for the slug). Read tools MAY join shared content with the caller's overlay (`favorite`/`reject`) and the caller's cooking-log-derived `last_cooked`. Disposition is per-tenant: one tenant marking a recipe as a favorite or rejecting it SHALL NOT change any other tenant's overlay for it. `favorite` and `reject` are mutually exclusive; setting one clears the other on the same row.

#### Scenario: Overlay joined at read time

- **WHEN** tenant A reads a shared recipe for which A has `favorite: true` in the overlay
- **THEN** the recipe is returned with A's disposition merged onto the shared content

#### Scenario: Absent overlay is neutral

- **WHEN** a recipe exists in the shared corpus but the caller has no overlay row for it
- **THEN** the recipe is returned as neutral (no favorite, no reject) — there is no default `status` to apply

#### Scenario: Disposition is per-tenant

- **WHEN** tenant A rejects a shared recipe and tenant B favorites the same recipe
- **THEN** both states coexist in separate overlay rows; A sees it rejected and B sees it as a favorite

### Requirement: Shared, location-tagged SKU cache

The Kroger SKU cache SHALL live in the shared corpus as rows in the D1 `sku_cache` table (read by all tenants) and each cached entry SHALL be tagged with the Kroger `locationId` it was resolved at. A cache lookup SHALL still revalidate the SKU against the caller's preferred location before use (price + curbside/delivery availability), so a shared cache cannot serve an entry that is unavailable at the caller's store. A resolution by one tenant SHALL be available as a cache candidate to others, subject to that per-location revalidation.

#### Scenario: Cross-tenant cache hit revalidated per location

- **WHEN** tenant A resolved an ingredient to a SKU at location L1, and tenant B (preferred location L2) looks up the same ingredient
- **THEN** the shared entry is a candidate but is revalidated against L2, and is used only if available there (otherwise it falls through to search)

#### Scenario: Cache entries are location-tagged

- **WHEN** a resolved mapping is written to the shared SKU cache
- **THEN** it records the `locationId` at which it was resolved

### Requirement: Shared reference data

The ingredient identity layer SHALL live in the shared corpus, read by all tenants, as a small set of D1 tables: an `ingredient_alias` front-door (variant → canonical id, with a `source` of `auto` or `human`), an `ingredient_identity` node registry (canonical id → base, detail, reconstructed `search_term`, a `representative` pointer for union-find synonym merges, a `concrete` flag distinguishing concept nodes, and a cron-owned embedding), an `ingredient_edge` table of directed `satisfies` edges (from_id → to_id, kind), and the `novel_ingredient_terms` capture queue plus the `ingredient_normalization_log` audit/evaluated-set. Normalizing a term SHALL resolve it through the alias front-door and follow the `representative` pointer to the surviving canonical id, identically for every tenant. The layer SHALL grow **organically** via the scheduled capture job with no required human action (see the `ingredient-normalization` capability); `update_aliases` remains a `human`-sourced authoritative write into the same store. There are no shared `substitutions` and no per-tenant substitution-override layer — ingredient substitution is LLM reasoning (over the loaded pantry for inventory subs, and over enumerated Kroger searches for sale subs), not a curated rules file. (There is likewise no shelf-life `ingredients` reference — freshness is LLM-judged, not driven by a table.)

#### Scenario: Shared identity resolution applies to all tenants

- **WHEN** any tenant normalizes an ingredient term
- **THEN** the shared alias front-door + identity registry are consulted (resolving through the representative pointer), identically for every tenant

#### Scenario: Existing aliases remain valid after generalization

- **WHEN** the current `aliases` rows are migrated
- **THEN** each existing `canonical` becomes a base-level id (no qualifier) in the identity registry and the alias front-door points at it, so pre-change reads resolve unchanged

#### Scenario: No substitutions reference data is present

- **WHEN** the shared corpus reference data is enumerated
- **THEN** there is no substitutions table and no per-tenant substitution override; substitution candidates are produced by agent reasoning, not read from a file

### Requirement: Shared corpus artifacts live in D1 and R2

The shared corpus artifacts — ingredient aliases, the store registry, store notes, recipe notes, RSS feeds, the newsletter sender/member allowlist, the discovery inbox, the SKU resolution cache, flyer terms, and the recipe visibility grants (`recipe_imports`) — SHALL be stored in D1 tables, written and validated by Worker operations, and read by query. Authored recipe and guidance markdown SHALL live in the R2 corpus bucket, read and written through the corpus store; no shared-corpus data SHALL live in GitHub and the Worker SHALL make no GitHub API call on any data path. Attributed notes (`store_notes`, `recipe_notes`) SHALL carry an `author` (the writing member's id); recipe notes carry a visibility `tier` (`public | friends | private`, default `friends`) while store notes keep the binary `private` flag. `read_recipe_notes` SHALL return the caller's own notes plus the notes the tier rules admit (per the `recipe-notes` capability) via a single query, joined with the D1 overlay ratings — and SHALL be reachable only for recipes inside the caller's visibility lens: a notes read for a slug outside the caller's lens SHALL return the same structured `not_found` a nonexistent slug returns.

#### Scenario: Corpus enumeration finds only D1 and R2

- **WHEN** the corpus storage is enumerated
- **THEN** structured shared artifacts (including `recipe_imports`) are D1 tables, authored markdown is in the R2 corpus bucket, and no data path reads or writes GitHub

#### Scenario: Notes are lens-bound

- **WHEN** `read_recipe_notes(slug)` is called for a recipe outside the caller's visibility lens
- **THEN** it returns the same structured `not_found` a nonexistent slug produces, and no note content is disclosed

#### Scenario: Attribution and tier preserved

- **WHEN** a member writes a `private`-tier note on a recipe inside their lens
- **THEN** it is stored with their `author` and `tier = 'private'`, and no other member — including their own household — sees it in `read_recipe_notes`

### Requirement: The deployment profile is long-lived configuration with guarded flips

The Worker SHALL expose a deployment profile — `"self-hosted"` or `"saas"` — resolved through ONE accessor that is the only site naming the profile source. The source SHALL be a `deployment_profile` column on the `operator_config` D1 singleton (the deployment-global config channel); a NULL/absent value SHALL resolve to `"self-hosted"`, so existing deployments need no configuration or data change. The profile SHALL NOT be carried by a code-repo wrangler var (the operator deploy merge drops code-repo `vars`; the D1 channel is also what makes flip guards enforceable). Profiles are long-lived deployment configuration, not migration scaffolding. Implicit self-hosted friend edges SHALL be computed from the flag at read time and SHALL NOT be materialized anywhere.

Profile flips SHALL be guarded at the config write path:

- self-hosted → SaaS SHALL require an explicit confirmation acknowledging that the implicit all-to-all edges disappear and households immediately stop seeing each other's recipes.
- SaaS → self-hosted SHALL be refused with a structured error — and no write — unless at most ONE household has a non-empty own cookbook (≥1 `recipe_imports` row owned by that tenant, excluding the reserved curated tenant): the consent-inversion guard.

#### Scenario: Absent flag resolves to self-hosted

- **WHEN** a deployment has never written `deployment_profile`
- **THEN** the accessor resolves `"self-hosted"` and every profile-conditioned surface behaves exactly as before this change

#### Scenario: Flipping to SaaS requires the confirm and drops implicit edges

- **WHEN** the operator flips a deployment self-hosted → SaaS with the explicit confirmation
- **THEN** the flag is written, and on the next read implicit all-to-all visibility is gone — each household sees only its own imports plus the curated tier (the friend relation being empty until real friendships exist) — with no stored edge ever created or deleted

#### Scenario: The consent-inversion guard refuses an unsafe flip

- **WHEN** the operator attempts SaaS → self-hosted while two or more households own non-empty cookbooks
- **THEN** the write is refused with a structured error naming the guard, and the profile remains `"saas"`

#### Scenario: A single-household deployment may flip back

- **WHEN** the operator attempts SaaS → self-hosted and at most one household owns any non-curated `recipe_imports` row
- **THEN** the flip is accepted

### Requirement: Recipe visibility is a lens computed from provenance import rows

Recipe visibility SHALL be an overlay over one monolithic corpus, never segmentation: a recipe exists once (one R2 body, one index row, one set of derived artifacts) regardless of how many households can see it. The grant structure SHALL be the D1 `recipe_imports` table — `recipe` (slug), `tenant` (owning household or the reserved curated tenant), `member` (importing member; the founding member for reconciled and curated rows — never NULL, no NULL-owner sentinel), `via` (`agent`, `feed:<url>`, `satellite`, or `curated`), `imported_at` — with PRIMARY KEY `(recipe, tenant)`: one provenance row per (recipe, household). Visibility SHALL be computed at read time as: the viewer's household owns an import row, OR a friend household of the viewer owns one, OR the curated tenant owns one (subject to the household's curated-hide setting) — the imports×friendship join IS the grant; per-viewer visibility rows SHALL never be materialized. Under the self-hosted profile the friend input is the computed all-to-all relation, so any household's import row grants visibility (curated rows excluded — the curated tier is SaaS-only); under SaaS the friend input is the deployment's real friendship relation, read through ONE named seam provider — which, until the friendships table ships, is the empty relation. Terminology: "visibility lens"/"lens" exclusively for visibility; "overlay" stays reserved for the favorites/rejects table.

#### Scenario: A friend household's import grants visibility through the join

- **WHEN** household A imports a recipe and household B is A's friend under the SaaS profile
- **THEN** the recipe is visible to B's members via the imports×friendship join, with no per-viewer row written for B

#### Scenario: Self-hosted reproduces the full shared corpus

- **WHEN** any member reads the corpus under the self-hosted profile after legacy attachment has converged
- **THEN** every non-curated corpus recipe is visible — exactly today's shared-corpus behavior — via the computed all-to-all relation, with zero stored edges

#### Scenario: A second import is a grant, not a row

- **WHEN** household B imports a source URL household A already brought into the corpus
- **THEN** no second recipe is created; B gains its own `recipe_imports` row and the recipe enters B's lens

#### Scenario: The friendship seam is empty until the People change lands

- **WHEN** the lens evaluates a SaaS viewer's friend clause before any friendships feature exists
- **THEN** the named friend-relation provider returns the empty relation and only own and curated imports grant visibility, and no consumer carries its own friendship logic

#### Scenario: Household purge removes the household's grants

- **WHEN** the operator purges a household (the `recipe_imports` table joins the household-purge table set; member-revoke deliberately does NOT touch it — the household keeps its recipes when one member leaves)
- **THEN** every `recipe_imports` row for that tenant is deleted, recipes visible to others only through the purged household's grants leave their lenses, and corpus rows and shared derived artifacts are not deleted

### Requirement: One lens enforcement point serves every corpus read surface

Visibility SHALL resolve at ONE shared enforcement point — a single Worker module owning the lens predicate for whole-index reads and point reads — through which every corpus read consumer resolves visibility; per-surface reimplementation is a defect class. The enumerated consumers: `search_recipes` (membership and ranked modes), `read_recipe`/`display_recipe`, `read_recipe_notes`, `list_new_for_me`, the propose candidate pools, similar-recipes, trending and picked-for-you, the member cookbook `/api` reads, the anonymous `/cookbook` routes, and `recipe_site_url`. The whole-index read SHALL require an explicit viewer (member or anonymous) so no consumer can read the corpus without choosing a lens position. Derivation pipelines (index projection, embedding reconcile, facet classification, dup-scan) SHALL remain corpus-wide — derived artifacts are identity-keyed and computed once regardless of visibility — and are not lens consumers.

#### Scenario: An out-of-lens recipe is invisible on every consumer

- **WHEN** a recipe is outside a SaaS member's lens
- **THEN** it appears in none of the enumerated consumers for that member — not in search (either mode), browse, new-for-me, propose pools, similar lists, trending/picked rows, or detail reads

#### Scenario: Derivation stays corpus-wide

- **WHEN** the projection, embedding, facet, or dup-scan job runs on a SaaS deployment
- **THEN** it processes the whole corpus once, identity-keyed, regardless of which households can see each recipe

### Requirement: The anonymous reader is the bottom lens position

The anonymous `/cookbook` surface SHALL hold the bottom lens position, resolved through the same enforcement point. Under SaaS the anonymous lens SHALL contain exactly the curated tier: the index, keyword search ranking, and Similar Recipes compute over that set only, and `/cookbook/<slug>` for any recipe outside the anonymous lens SHALL 404 indistinguishably from a nonexistent slug — same status, page, and response class, with no body read performed — so no slug-probing oracle exists (`read_recipe` gives the same guarantee on the tool surface). Under self-hosted the anonymous lens SHALL be the full attached corpus, reproducing today's public site exactly. The household curated-hide setting SHALL NOT affect the anonymous position (it scopes one household's lens; the anonymous reader has no household).

#### Scenario: SaaS anonymous surface is curated-only

- **WHEN** an unauthenticated visitor browses or searches `/cookbook` on a SaaS deployment
- **THEN** only curated-tier recipes appear in the index, search results, and Similar Recipes

#### Scenario: No slug-probing oracle

- **WHEN** an unauthenticated visitor requests `/cookbook/<slug>` for a recipe that exists but is outside the anonymous lens, and for a slug that does not exist
- **THEN** the two responses are indistinguishable 404s

#### Scenario: Self-hosted public site is unchanged

- **WHEN** an unauthenticated visitor browses `/cookbook` on a self-hosted deployment after attachment convergence
- **THEN** the full corpus renders exactly as before this change

### Requirement: The curated tier is a reserved system tenant with a household-level hide

The curated set SHALL be grants owned by a reserved system tenant whose id is a code constant syntactically outside the tenant-username and handle space, so it can never be claimed, allowlisted, enrolled, or resolved to a session or token; it exists only as a `recipe_imports` value. Curated grants SHALL carry `via = 'curated'` and SHALL be sourced from a product-maintained public curated source: a pinned public feed URL held in deployment config (`operator_config.curated_source_url`), compiled-default to the product's published curated feed, operator-adjustable (repoint) and operator-disableable (clear). The curated source SHALL be consumed by the existing sweep pipeline under the SaaS profile only — the curated tier is the SaaS cold-start floor and does not exist under self-hosted. A household-level `curated_hide` setting SHALL suppress the entire curated tier from that household's lens — one lens rule plus one setting — in addition to the existing per-member `toggle_reject`; hiding is reversible and deletes nothing.

#### Scenario: The curated tenant cannot authenticate

- **WHEN** any signup, onboarding, invite, or token path presents the reserved curated tenant id
- **THEN** it is rejected — the id is outside the claimable username space, holds no allowlist entry, and never resolves to a session or tool context

#### Scenario: Curated recipes floor a new SaaS household

- **WHEN** a new household with zero imports browses its cookbook on a SaaS deployment
- **THEN** the curated tier is visible (with curated provenance), and nothing else

#### Scenario: The household hide suppresses the whole tier

- **WHEN** a household sets `curated_hide` and any of its members reads any lens consumer
- **THEN** no curated-tier recipe appears for that household, other households are unaffected, and clearing the setting restores the tier unchanged

#### Scenario: The curated source is operator-adjustable

- **WHEN** the operator repoints or clears `curated_source_url`
- **THEN** subsequent sweep ticks consume the new source or stop consuming entirely; already-granted curated rows are unaffected

### Requirement: Import paths record attribution at creation

Every path that brings a recipe into the corpus or re-imports an existing one SHALL record the importing household's `recipe_imports` row at creation time, in the same operation: agent import (`create_recipe`, fresh or dedup-to-grant, `via = 'agent'` with the resolved member), sweep auto-import (one row per confirmed-matched household, `via = 'feed:<url>'` or `'satellite'` per the origin, written together with the match row), and curated landing (`via = 'curated'` on the reserved tenant). No import path SHALL create a corpus recipe without at least one grant, so the unattached-recipe class never regrows.

#### Scenario: An agent import is attributed at creation

- **WHEN** a member's agent calls `create_recipe` for a new source
- **THEN** the recipe row, R2 body, and the caller household's `recipe_imports` row (`via 'agent'`, the resolved member id, today's date) are written in the same operation

#### Scenario: No import path leaves a recipe unattached

- **WHEN** any import path (agent, sweep, satellite push, curated) completes
- **THEN** the recipe has ≥1 `recipe_imports` row the moment it becomes readable

### Requirement: An idempotent reconcile attaches every legacy corpus row

Because the lens join alone passes NO legacy recipe (zero import rows predate this change), the Worker's scheduled handler SHALL run an idempotent, bounded lens reconcile that attaches every corpus recipe with zero `recipe_imports` rows to at least one household through the same primitive: a recipe with discovery attribution receives one grant per attributed tenant (`via` resolved from the discovery-log origin — `feed:<url>`, `satellite`, else `agent`; member from the match row; `imported_at` from the match date, else `discovered_at`, else the run date); every other unattached recipe attaches to the operator's household (`OWNER_TENANT_ID`) with `via = 'agent'` and the founding member. There SHALL be no NULL-owner sentinel and no profile-conditioned code-path bypass — one predicate serves both profiles. With no `OWNER_TENANT_ID` configured, attribution-derived grants still run and the operator-fallback step records a skipped no-op (so configuring the operator later converges the remainder). Each tick SHALL process a bounded batch, record `job_health`/`job_runs` counts like sibling jobs, and plan zero writes over a converged corpus. The reconcile is permanent — it is the guard that heals any future attachment gap (including a match row missing its grant). Production attached/unattached counts are the acceptance fixture, captured by the operator-gated pre-merge verification task.

#### Scenario: Attribution-derived attachment

- **WHEN** the reconcile processes a legacy recipe with `discovery_matches` rows for two tenants
- **THEN** each of those tenants gains a `recipe_imports` row with `via` from the discovery-log origin, and re-running the reconcile changes nothing

#### Scenario: Operator fallback attachment

- **WHEN** the reconcile processes a legacy recipe with no discovery attribution and `OWNER_TENANT_ID` is configured
- **THEN** the operator's household gains the grant (`via 'agent'`, founding member), and the recipe is visible under self-hosted exactly as before

#### Scenario: Unconfigured operator is a recorded no-op that converges later

- **WHEN** the reconcile runs with no `OWNER_TENANT_ID` set
- **THEN** attribution-derived grants are still written, unattributed recipes are left for a later run with a recorded skip summary, and setting the var later converges them without manual surgery

#### Scenario: A converged corpus plans zero writes

- **WHEN** the reconcile ticks over a corpus where every recipe has ≥1 grant
- **THEN** it writes nothing and records a zero-work healthy run

