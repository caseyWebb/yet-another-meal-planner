## Why

Band 5's social layer replaces "every tenant sees the whole corpus" with recipe visibility as a lens over one monolithic corpus (D2/D11/D12), and D9 makes that shift safe for existing deployments by introducing two long-lived deployment profiles: **self-hosted** (implicit all-to-all friendship — today's shared-corpus experience, byte-for-byte) and **SaaS** (scoped visibility, empty corpus on join, a curated floor). Today nothing in the Worker can express any of that: there is no provenance record of which household brought a recipe in, every corpus read path (tools, member `/api`, propose pools, trending, and the anonymous `/cookbook` site) renders the full index unconditionally, and the deployment-profile accessor in `whoami` is a stub that hardcodes `"self-hosted"` and claims no configuration channel. This change lands the substrate — the profile flag with its channel and flip guards, the `recipe_imports` provenance rows, ONE lens enforcement point over every enumerated consumer, the legacy-attachment reconcile, the curated system tenant with the D13-amendment household hide, the D31 profile-conditioned trend guard, and the cookbook cold-start onboarding — building directly on `member-identity-split`'s landed `(tenantId, memberId)` resolution contract, and sequenced after it.

## What Changes

- **The D9 deployment-profile flag ships with a real channel**: a `deployment_profile` value (`"self-hosted" | "saas"`) on the existing `operator_config` D1 singleton (the `discovery_config`/`operator_config` precedent — the channel 00-overview §Routing (8) prefers), read through the single Worker-side accessor `member-app-core`'s whoami requirement already reserves. Absent/NULL resolves to `"self-hosted"` — zero data or config surgery for existing deployments. A wrangler-var channel is rejected with evidence: `scripts/merge-wrangler-config.mjs` copies `vars` from the **operator's** config only and silently drops code-repo `vars`, so a code-authored var would never reach a deployment (the allowlist trap). Flip guards ride the config write path (the `validateOperatorConfig` validate-plus-confirm idiom): self-hosted→SaaS proceeds with an explicit confirm (implicit edges drop; the operator may later bulk-create real friendships); SaaS→self-hosted is **refused** unless at most one household has a non-empty own cookbook (the consent-inversion guard). The admin Config area gains the operator control.
- **`recipe_imports` provenance rows (D12)**: migration `0059` creates `recipe_imports(recipe, tenant, member, via, imported_at)`, PRIMARY KEY `(recipe, tenant)` — one row per (recipe, household), `via ∈ {agent, feed:<url>, satellite, curated}`. Visibility(H, R) is computed at read time — own import ∨ friend-of-H import ∨ curated import — the imports×friendship join IS the grant; nothing per-viewer is ever materialized, and implicit self-hosted edges are computed from the flag at read time, never stored.
- **ONE lens enforcement point (D11)**: a single shared predicate module through which every enumerated consumer resolves visibility — `search_recipes`, `read_recipe`/`display_recipe`, `read_recipe_notes`, `list_new_for_me`, the propose pools, similar-recipes, trending/picked-for-you, the member cookbook `/api` reads, the anonymous `/cookbook` route, and `recipe_site_url`. Under SaaS the anonymous position holds only the curated tier and `/cookbook/<slug>` outside the lens 404s indistinguishably from a nonexistent slug (no slug-probing oracle; same for `read_recipe`). Under self-hosted, implicit all-to-all reproduces today's full-corpus behavior exactly — one implementation, both profiles. The friendship input is a well-defined seam: under self-hosted it is the computed all-to-all relation; under SaaS it reads a friend relation that is **empty until `households-friends-and-people-page` lands its `friendships` table** — that change swaps the real subquery into this one seam.
- **`recipe_site_url` becomes lens-aware**: it gains an optional `slug` — anonymously-visible recipes get the `/cookbook/<slug>` link; lens-scoped recipes get the member app's `/recipe/<slug>` detail link; the no-argument call still returns the cookbook root.
- **`create_recipe` dedup becomes dedup-to-grant (D12)**: importing a source URL that already exists in the corpus mints a visibility grant for the caller's household (via `agent`, the resolved member) and returns `already_exists` with the existing slug — a second import creates a grant, not a row. All import paths record attribution at creation so the unattached class never regrows.
- **Sweep imports enter the lens as ordinary imports (D13)**: the confirmed-match write and the household's grant are minted together in one write path, so attribution and visibility cannot drift; `discovery_matches` gains a `member` key (backfilled to the founding member) and `list_new_for_me` filters by matched member while visibility is per-household.
- **Idempotent legacy-attachment reconcile (D12)**: a new bounded `scheduled()` phase attaches every existing corpus row to ≥1 household through the same `recipe_imports` primitive — rows with discovery attribution get a grant per attributed tenant (via from the discovery-log origin); all others attach to the operator's household (`OWNER_TENANT_ID`, the `dup-scan` idiom — a recorded no-op when unset); no NULL-owner sentinel, no profile code-path bypass. Production attached/unattached counts are the acceptance fixture, captured by an operator-gated pre-merge task (production reads were permission-denied during planning).
- **Curated set = reserved system tenant (D12/D13/D13-amendment)**: a product-maintained public source (a pinned public feed URL, defaulted in deployment config, operator-adjustable) is consumed by the existing sweep pipeline on the SaaS profile only, landing grants on the reserved curated tenant (`~curated`, syntactically outside the username space) with `via = 'curated'` and no member matches. A household-level `curated_hide` setting (a `profile` column, the household-scoped settings tier) suppresses the whole curated tier from that household's lens — one lens rule + one setting — alongside the existing per-member `toggle_reject`.
- **D31 min-signal trend guard, profile-parameterized**: one trending implementation; under self-hosted the existing member-app-differentiators guard (≥2 cooks OR ≥2 distinct cooking tenants) stands verbatim over the deployment-wide log; under SaaS the aggregation is friend-lens-scoped and a cook signal renders only when its contributing set spans ≥2 distinct non-caller households. The promoted panel's reserved "Popular with Friends" reason ships from this guarded read with household-counted copy under SaaS; self-hosted keeps the "Trending" label (D9: no relabel needed).
- **D27 whole-cookbook friend scope**: friend-tier visibility is derived from the friendship edge + the owning household's imports — no per-recipe share-grant rows, no favorites-only mode.
- **Cookbook cold-start onboarding (SaaS)**: the member cookbook gains the new-household state — an onboarding panel selling add-friends / import-with-the-agent / browse-curated, a "Curated" provenance badge on RecipeRow, and the true-zero variant (curated hidden, no recipes) — dismissed permanently once the household has own recipes or on explicit dismiss. Local design per design-requests #10/#11 (operator-authorized; see design.md).
- **Vestigial GitHub-era cleanup (story 01 §4)**: `shared-corpus`'s private-recipe escape hatch (zero such recipes exist; the code path never existed off GitHub) and `multi-tenancy`'s GitHub-App-installation-token requirement (the Worker has no GitHub App code path — verified) are removed; isolation wording becomes tenant = household.
- **Docs lockstep**: TOOLS.md lens notes on every corpus read + `create_recipe` dedup-to-grant + `recipe_site_url`; SCHEMAS.md `recipe_imports`/`discovery_matches.member`/`operator_config.deployment_profile`/`profile.curated_hide`; ARCHITECTURE.md gets the full multi-tenant identity rewrite (deferred to this change by `member-identity-split`) plus the cron-phase and deployment-profiles account; SELF_HOSTING.md documents the profile flag; the persona's corpus-tier "for everyone" phrasing is neutralized (lens guarantees live in tool descriptions, not skills) with `aubr build:plugin --check`.

### Explicit non-goals

- **No `friendships` table, no People page, no friend requests/invites/blocks** (D24), no member-move (D23), no self-service-signup fork — all `households-friends-and-people-page`. The lens's friend relation is designed as a seam and reads empty under SaaS until then.
- **No note visibility tiers** (D30-final lands with `note-visibility-tiers`); `read_recipe_notes` changes only in that notes are unreachable for a recipe outside the caller's lens (it is an enumerated D11 consumer).
- **No overlay/member re-keying**: `overlay`, `cooking_log`, taste, and vibes stay tenant-keyed; the only domain-table member key added here is `discovery_matches.member` (D13 names it).
- **No new Worker-owned HTTP route**: every touched surface rides existing `run_worker_first` coverage (`/cookbook`, `/cookbook/*`, `/api`, `/api/*`) — no `wrangler.jsonc` change.
- **No satellite trust rework** (D14 is band 6); satellite-pushed candidates already ride the sweep, so their grants fall out of the sweep's import-path change (`via` from the push origin).
- **No group-insights redesign**: the operator dashboard keeps its deployment-wide counts-only stance, restated explicitly as an operator surface outside the member lens.
- **No empty-corpus-on-join enforcement change**: joining already inherits nothing (grants are per-household by construction); D3's cold start is cushioned by the curated floor and, later, friends.

## Capabilities

### New Capabilities

None. Visibility is a property of the existing shared-corpus contract, not a parallel capability; the profile flag is deployment configuration inside it.

### Modified Capabilities

- `shared-corpus`: wholesale rewrite — R2/D1 storage wording, the deployment-profile flag with channel and flip guards, the `recipe_imports` lens structure and predicate, the single enforcement point, the curated tier + household hide, the legacy-attachment reconcile, import-path attribution at creation; the private-recipe escape hatch is removed.
- `multi-tenancy`: the GitHub-App-installation-token isolation requirement is replaced by household-boundary isolation wording (tenant = household; member is attribution within it; corpus visibility crosses tenants only through the lens).
- `cookbook-search`: the anonymous index/search rank over the anonymous lens position; out-of-lens slugs 404 indistinguishably.
- `cookbook-similar-recipes`: neighbors are computed within the anonymous lens; no out-of-lens leak through the similar list.
- `data-read-tools`: `search_recipes` membership is the lens-visible corpus minus rejects; `read_recipe` returns `not_found` for out-of-lens slugs indistinguishably; the group-signal read aggregates within the caller's lens; `recipe_site_url` gains the lens-aware `slug` parameter.
- `semantic-recipe-search`: ranked mode gates candidates on the same lens before cosine — rank can never admit an out-of-lens recipe.
- `member-app-differentiators`: the trending guard is profile-parameterized (D31) and lens-scoped; picked-for-you candidates are lens-visible; the promoted panel's "Popular with Friends" reason ships (SaaS copy) replacing its "SHALL NOT be rendered" reservation.
- `member-app-core`: cookbook browse/search/new-for-me read lens-visible rows and carry row provenance; the whoami profile accessor reads the shipped channel; the cookbook cold-start onboarding states are added.
- `group-insights`: stance restated — a deliberately deployment-wide, counts-only operator surface outside the member lens; the curated tenant contributes no activity.
- `recipe-discovery`: `create_recipe`'s duplicate-source path becomes dedup-to-grant and creation records the importing household's grant.
- `discovery-sweep`: auto-import mints the match row and the household grant together; `discovery_matches` gains the member key; new-for-me filters by matched member; the curated source is consumed as a provenance-tagged SaaS-only floor.
- `operator-admin`: the Config area exposes the deployment profile with the flip guards.

## Impact

### Dependency map

```text
                 operator_config.deployment_profile (D1 singleton; NULL => self-hosted)
                          |  loadDeploymentProfile(env) — the ONE accessor
                          v
   recipe_imports(recipe, tenant, member, via, imported_at)   friendships (SEAM —
     ^            ^                ^            (0059)         empty under SaaS
     |            |                |                           until band-5 People)
 create_recipe  sweep import   legacy reconcile                     |
 dedup-to-grant + curated tier  (scheduled(), OWNER_TENANT_ID)      |
                          \               |                        /
                           v              v                       v
                    ONE lens predicate: visible(viewer, recipe)
                    viewer ∈ { (tenant,member), anonymous }
        ______________________________|_______________________________
       |          |           |            |             |            |
 search_recipes  read_recipe  list_new_   propose      trending/    anonymous /cookbook
 (+ ranked mode) display_     for_me      pools        picked-for-  index/search/detail/
                 recipe,      (member-    (household   you (D31     similar + recipe_site_url
                 notes read   filtered)   union)       guard)       (404 indistinguishable)
                          |
                   member /api cookbook reads + cold-start onboarding (SaaS)
```

### Affected code (forecast)

Concentrated in `packages/worker/`; roughly 35–45 changed files:

- 1 migration: `packages/worker/migrations/d1/0059_recipe_imports.sql` (`recipe_imports` + `discovery_matches.member` + backfill + `operator_config.deployment_profile`/curated-source columns + `profile.curated_hide`). 0058 is owned by `member-identity-split`; the historical duplicate numbers 0018/0045/0047 are not repeated.
- Lens + profile core: new `src/visibility.ts` (predicate + viewer types + friend-relation seam), new accessor in `src/deployment.ts` (replacing the whoami stub), `src/operator-config.ts` (+ flip-guard validation), `src/recipe-index.ts` (viewer-scoped reads), `src/recipes.ts`/`src/tools.ts` (search/read/site-url), `src/discovery-tools.ts` (create_recipe grant, list_new_for_me member filter), `src/discovery-db.ts`, `src/discovery-sweep.ts` (grant minting + curated source), new `src/lens-reconcile.ts` (legacy attachment job), `src/index.ts` (scheduled() phase — the serial `scheduled()` surface), `src/cookbook.ts`/`cookbook-search.ts`/`cookbook-similar.ts`/`cookbook-rows.ts` (anonymous lens + D31 guard), `src/meal-plan-proposal-tool.ts` (pool lens), `src/api/cookbook.ts`, `src/corpus-db.ts` (notes read bound by lens).
- Admin: `src/admin/config-api.ts` + `packages/admin-app` Config screen card + `admin/visual/` page object/spec.
- Member app: `packages/app` cookbook cold-start states + curated badge + Preferences curated-hide card, `packages/ui` RecipeRow provenance badge slot, `app/visual/` Playwright specs.
- Docs/persona: `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md` (multi-tenant identity full rewrite), `docs/SELF_HOSTING.md`, `packages/worker/AGENT_INSTRUCTIONS.md` (+ `aubr build:plugin --check`).
- Tests: worker migration/lens/tool/api/cookbook/sweep/reconcile suites, admin + app Playwright.

### Schema and scheduling impact

One migration (0059). One new `scheduled()` phase (the legacy-attachment reconcile, with `job_health`/`job_runs` records like sibling jobs) — this change is the only in-flight change touching `scheduled()`. No new binding, dependency, cron expression, or `wrangler.jsonc` change.

### Compatibility

- **Self-hosted deployments observe zero member-visible change**: the flag defaults to self-hosted; implicit all-to-all makes every lens read equal today's full-corpus read once the reconcile attaches legacy rows (and the reconcile plus at-creation grants guarantee attachment); the anonymous site renders identically; the trending guard keeps its existing thresholds verbatim.
- **Pre-existing tool contracts stay compatible**: `already_exists` keeps its error code and `slug` datum (it additionally mints the grant); `search_recipes`/`read_recipe` shapes are unchanged; `recipe_site_url`'s new `slug` parameter is optional.
- The production-fixture spike (attached/unattached counts, discovery-attribution coverage) could not be captured during planning — remote D1 reads are permission-denied in this session; shapes were derived from `migrations/d1/*` and the live read paths. The capture is an operator-gated pre-merge task with exact read-only queries in tasks.md (the `member-identity-split` task-8.1 precedent).
- Serial-surface collisions: lands after `member-identity-split` (identity contract, migration 0058, shared multi-tenancy/operator-admin spec files); cookbook specs shared with the landed `cookbook-unified-browse`; `scheduled()` wiring is exclusive to this change right now; `member-app-differentiators`/`recipe-notes`-adjacent surfaces precede `note-visibility-tiers` and `households-friends-and-people-page`, which build on this lens.
