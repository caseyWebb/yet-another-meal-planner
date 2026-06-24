## Why

Roadmap slice 1 of `cloudflare-storage-architecture`, building on `d1-foundation`. The recipe index is the **lowest-risk** thing to move to D1 and the highest-leverage for what's coming: it's a *derived projection* of `recipes/*.md` (rebuilt deterministically on every recipe push), so it needs **no data backfill** — just a new build target — and a queryable `recipes` table is exactly what the planned admin recipe browser needs.

Today the index is a single JSON blob in `DATA_KV` (`index:recipes`): the build serializes the whole map and the Worker `JSON.parse`s it whole on every `list_recipes` / `retrospective` / discovery call, then filters in JS. Moving it to a D1 table turns it into rows you can query and an admin UI can page/sort/filter — and lets the discovery source-URL check become an indexed lookup instead of loading the entire index.

Subjective per-tenant fields (`status`, `rating`, `last_cooked`) are already stripped from the shared index and merged at read time from the overlay (KV) and cooking log (GitHub). Those stay external until their own slices (4, 2); this slice moves only the **shared objective projection**. `recipes/*.md` content stays in git — only the derived index moves.

## What Changes

- **NEW** D1 schema migration `migrations/d1/0002_recipes.sql` — a `recipes` table: scalar columns for the promoted objective facets (`slug` PK, `title`, `protein`, `cuisine`, `time_total`, `ingredients_key`, `source_url`), JSON columns for the array facets (`tags`, `course`, `season`, `dietary`, `pairs_with`, `perishable_ingredients`, `requires_equipment`), and an `extra` JSON column carrying any other objective frontmatter (forward-compat, lossless without a schema change). Index on `source_url`. **No** `status`/`rating`/`last_cooked` (subjective, per-tenant).
- `scripts/build-indexes.mjs`: replace `publishToKv("index:recipes", …)` with a **D1 projection** — `DELETE FROM recipes; INSERT …` for the whole set in one transaction via the `d1-rest` client (a derived index is rebuilt wholesale, so replace-all matches today's whole-blob semantics). Also **stop writing `_indexes/recipes.json`** and delete the committed file — it is no longer a serving path (the Worker reads D1; the static site reads `recipes/*.md` + `_indexes/components.json` directly, never `recipes.json`).
- **NEW** `src/recipe-index.ts` (or extend `src/recipes.ts`): `loadRecipeIndex(env)` reconstructs the in-memory `RecipeIndex` from D1 rows (columns + JSON-parsed arrays + `extra`), plus targeted helpers — `recipeSourceMap(env)` (`source_url → slug`) and per-slug metadata — so discovery/retrospective query directly instead of loading the whole index.
- `src/tools.ts` `list_recipes`: load the index from D1 (`loadRecipeIndex`) instead of `DATA_KV.get("index:recipes")`; the overlay/last_cooked merge and `filterRecipes` are unchanged (same `RecipeIndex` shape, different source).
- `src/cooking-tools.ts` (`retrospective`) and `src/discovery-tools.ts` (idempotency / source-URL → slug): read from D1. Discovery's lookup becomes `SELECT slug FROM recipes WHERE source_url = ?` (indexed) rather than scanning the whole index.
- **Error semantics improve:** an *empty* `recipes` table is a valid empty corpus (returns no recipes), distinct from a *missing/unreachable* table (`index_unavailable` / `storage_error`). Today an absent KV key conflates the two.
- `src/env.ts`: `DATA_KV` no longer holds `index:recipes` — update its doc (it now holds only the profile/session keys, pending their own slices). The deploy's post-deploy `build-indexes` step now populates D1, preserving the "index present by end of first deploy" guarantee.
- `.github/workflows/data-build-indexes.yml`: `build-indexes` now needs D1 access (the operator's pinned `database_id` from `wrangler.jsonc` + the existing `CLOUDFLARE_API_TOKEN`); no new secret.

## Capabilities

### Renamed Capabilities

- `recipe-index-kv` → **`recipe-index`**: the name's `-kv` suffix is now wrong (the index is D1-served), so this change renames the capability. Applying it renames `openspec/specs/recipe-index-kv/` → `openspec/specs/recipe-index/` along with the requirement changes below.

### Modified Capabilities

- `recipe-index` (formerly `recipe-index-kv`): the recipe index is stored in and served from **D1**, not KV. Read sites query D1; the build projects rows; the deploy populates D1.

## Impact

- New `migrations/d1/0002_recipes.sql`, `src/recipe-index.ts`.
- `scripts/build-indexes.mjs` (D1 projection; drop KV index publish), `src/tools.ts`, `src/cooking-tools.ts`, `src/discovery-tools.ts`, `src/env.ts`.
- `.github/workflows/data-build-indexes.yml` (D1 access for the build).
- `docs/SCHEMAS.md` (the `recipes` D1 table shape), `docs/ARCHITECTURE.md` (index now D1-served).
- Tests: `tests/build-indexes.test.mjs` (projection rather than KV publish), `list_recipes`/discovery/retrospective read-path tests against a local D1.
