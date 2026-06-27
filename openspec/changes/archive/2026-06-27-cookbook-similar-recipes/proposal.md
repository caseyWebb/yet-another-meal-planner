## Why

A cookbook recipe page (`/cookbook/<slug>`) is a dead end: a visitor reading one recipe has no path to related ones short of going back to the index or search. The corpus already carries a per-recipe embedding in `recipe_derived` (maintained by the reconcile cron for the agent-facing `search_recipes` tool), so a recipe→recipe "Similar Recipes" section turns vectors that already exist into a browse affordance — at **zero new compute cost**. This is distinct from the query-embedding semantic search removed in the cookbook-keyword-search change: that paid a Workers AI call per visitor query; this needs no query and makes no AI call, because both vectors are already stored.

## What Changes

- **New "Similar Recipes" section on `/cookbook/<slug>`**: up to N other recipes nearest to the viewed recipe by cosine similarity over the stored `recipe_derived` embeddings, computed **at request time** — a D1 read of stored vectors plus pure arithmetic, **no Workers AI call**.
- **Minimum-similarity floor.** Neighbors below the floor are dropped. When none clear it — including when the viewed recipe has no embedding yet (just imported, not yet reconciled) or no other recipe is embedded — the section is **omitted entirely**: no header, no error, no empty state. The floor and N are tunable constants, kept OUT of the spec'd contract (as the old cosine floor and the keyword weights are).
- **Pure selection module.** The nearest-neighbor selection is an I/O-free module (mirroring `src/cookbook-search.ts`) that reuses `cosineSimilarity`; the route supplies the loaded vectors, so the scoring is unit-testable without any binding.
- **Strict CSP preserved.** The section is server-rendered static links (reusing the existing `recipeListItem` markup), needing no client script, so `/cookbook/<slug>` keeps its strict no-script `Content-Security-Policy` unchanged.
- **Anonymous, shared-corpus determinism.** Pure recipe↔recipe cosine over the shared corpus, self-excluded, tie-broken on slug — every visitor sees the same neighbors. None of `search_recipes`'s per-tenant favorite / freshness / pantry-overlap signal applies (mirroring `cookbook-search`'s anonymous-relevance stance).
- The cookbook body page reads `recipe_derived` embeddings (one D1 read) — the single thing the cookbook-keyword-search change removed from this surface — but does **not** reintroduce any `AI` binding call.

## Capabilities

### New Capabilities

- `cookbook-similar-recipes`: the request-time nearest-neighbor "Similar Recipes" section on the open, anonymous cookbook recipe page — cosine over stored recipe embeddings, a tunable similarity floor with graceful omission, no Workers AI call, and preservation of the recipe-body page's strict no-script CSP.

### Modified Capabilities

_None._ The `cookbook-search` keyword-ranking contract and the recipe-body page's CSP posture are preserved unchanged; this is additive and lives in its own capability so that surface's "keyword query search, no query embedding" contract stays pristine.

## Impact

- **Code**: `src/cookbook.ts` — `renderRecipe` loads the embedding map + index, selects neighbors, and renders the section below the recipe body; a new pure module (e.g. `src/cookbook-similar.ts`) holds the neighbor selection, reusing `cosineSimilarity` from `src/embedding.ts` and `loadRecipeEmbeddings` from `src/recipe-index.ts`.
- **Storage**: none. Reuses the existing `recipe_derived.embedding` column. **No D1 migration.**
- **Cron / bindings**: none. **No new Workers AI cost** at request time or index time — the reconcile that fills the vectors already runs for `search_recipes`. No new binding.
- **Tests**: a pure unit test for the neighbor selector (floor, self-exclusion, deterministic ties, unembedded-recipe omission) plus a `test/cookbook.test.ts` render assertion (section present/absent, links escaped, no script).
- **Docs**: `docs/ARCHITECTURE.md` — the `/cookbook` route description (the body page now reads `recipe_derived` embeddings). No `docs/TOOLS.md` change (not an MCP tool); no `docs/SCHEMAS.md` change (no file/D1 shape change).
