## Why

The hosted cookbook (`/cookbook`) is the browse-everything surface onboarding points members at, but it only offers an alphabetical list — to find "something cozy for a rainy night", or even just "tacos", a visitor has to eyeball the entire corpus. The semantic machinery that would fix this (query embedding, per-recipe vectors, cosine ranking) already exists for the agent-facing `search_recipes` tool; it is simply not wired to the open web surface.

## What Changes

- Add search to the cookbook: a server-rendered `<form method="GET">` and a `?q=` branch on the `/cookbook` route. No client JavaScript — the existing strict CSP (`default-src 'none'`) is unchanged; an empty query renders today's alphabetical index.
- **Two-tier hybrid results.** An exact-intent **substring tier** (title + tags — the same match the MCP membership mode already runs) is pinned on top, then a **semantic tier** (query embedding + cosine over the existing recipe vectors) fills in neighbours not already shown, down to a **similarity floor**, deduped by slug.
- A nonsense query returns only its substring hits (typically none) — a clean "no matches" — rather than the whole corpus weakly ranked.
- **Graceful degradation.** The query embed is never load-bearing: if Workers AI is unavailable the semantic tier is skipped and the substring results still render. The open endpoint can downgrade to free keyword search but can never break the page. This also covers the reconcile gap — a just-imported, not-yet-embedded recipe is invisible to cosine but caught by substring, so named dishes never vanish.
- **Cache the query vector, not the result list,** in KV. Repeat queries skip the AI call, while a corpus reconcile is reflected on the very next search with no cache invalidation (the vector is stable unless the embedding model changes).
- **Anonymous ranking is pure cosine** — none of the MCP tool's per-tenant favourite / freshness / pantry boosts, because the open cookbook has no caller identity.

Out of scope: abuse hardening (rate-limit / WAF, Cloudflare Access, per-user auth) is deferred to Cloudflare edge primitives — neuron cost is negligible at friend-group scale (~0.06 neurons per query; the free 10k/day allocation covers ~150k searches/day).

## Capabilities

### New Capabilities

- `cookbook-search`: hybrid (substring + semantic) search on the open `/cookbook` site — the `?q=` request handling, the two-tier merge with a similarity floor, graceful degradation when embeddings are unavailable, the query-vector cache, and the anonymous pure-cosine ranking.

### Modified Capabilities

_None._ Search is additive on the same base URL: `recipe_site_url` still resolves `<origin>/cookbook` (`data-read-tools`), and onboarding still points members there (`guided-onboarding`) — no existing requirement changes.

## Impact

- **Code**: `src/cookbook.ts` gains the `?q=` branch + results render; a small cookbook-search module owns the two-tier merge, the floor, and the query-vector cache. Reuses `embedText` / `cosineSimilarity` (`src/embedding.ts`), `loadRecipeEmbeddings` (`src/recipe-index.ts`), and `filterRecipes`'s `query` facet (`src/recipes.ts`).
- **Storage**: query-vector cache in `KROGER_KV` (the existing ephemeral-infra namespace; key `cookbook:qvec:<hash(model+q)>`). **No new D1 table, no migration, no new cron** — `recipe_derived` embeddings already exist.
- **Workers AI**: one query embed per *uncached* search, on an open route; cost negligible, abuse mitigation deferred to edge primitives.
- **Docs**: `docs/ARCHITECTURE.md` (the `/cookbook` route description) and `docs/SCHEMAS.md` (the new `cookbook:qvec:` KV key family, alongside the flyer/health caches). `docs/TOOLS.md` unaffected (not an MCP tool); no D1 shape change.
