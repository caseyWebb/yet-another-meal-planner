## Context

The hosted cookbook (`src/cookbook.ts`) is a server-rendered, open, cross-tenant browse surface: `/cookbook` lists the D1 `recipes` index alphabetically, `/cookbook/<slug>` renders one recipe's R2 body. It ships a deliberately strict `Content-Security-Policy` (`default-src 'none'; style-src 'unsafe-inline'`) — **no script at all** — and has no `runTool` boundary, so its handler maps structured `ToolError`s to clean 404/503s itself.

The semantic pieces this change needs already exist, built for the agent-facing `search_recipes` MCP tool:

- `embedText(env, q)` / `cosineSimilarity` (`src/embedding.ts`) — embed a query string via Workers AI (`@cf/baai/bge-base-en-v1.5`, 768-dim) and compare vectors; AI failures already map to a structured `storage_error`.
- `loadRecipeEmbeddings(env)` (`src/recipe-index.ts`) — whole-table `slug → vector` map from `recipe_derived` (skips NULLs).
- `filterRecipes(index, { query })` (`src/recipes.ts`) — the title+tags tokenized substring match (stopword-dropped) that the MCP membership mode uses.

What is missing is purely the open-web entry point: a `?q=` branch, a merge, a cache, and rendering. No new D1 table, migration, or cron — recipe embeddings are already reconciled.

## Goals / Non-Goals

**Goals:**

- A search box on the cookbook that handles both named-dish lookups ("tacos") and vibe queries ("cozy rainy night").
- Reuse the existing embedding / cosine / substring primitives; add only the entry point, merge, cache, and render.
- Never break the page: an embedding outage degrades to keyword search, not a 5xx.
- Keep the surface script-free (CSP unchanged) and anonymous (no per-tenant ranking).

**Non-Goals:**

- Abuse hardening (rate-limit / WAF / Access / per-user auth) — deferred to Cloudflare edge primitives; neuron cost is negligible at friend-group scale.
- Faceted filtering UI (protein/cuisine/time) on the site — out of scope; this change is text search.
- Re-embedding recipe bodies or changing the embedding model / `recipe_derived` shape.
- Pagination — the friend-group corpus is hundreds of recipes; a single ranked list suffices.

## Decisions

### D1 — Server-rendered GET form, not client-side search

The search is a `<form method="GET">` that reloads `/cookbook?q=…`; the Worker embeds, ranks, and renders. **Alternative considered:** ship a client-side index (e.g. lunr/embeddings in JS). Rejected — it requires script (the CSP forbids it and the no-script CSP is a security property of this untrusted-content surface), and it would ship the whole corpus to the browser. The server-rendered branch also fits the existing "rendered on request, always reflects the latest reconcile" model: `?q=` is just another render branch.

### D2 — Two-tier hybrid: substring pinned, semantic below a floor

A dumb form has no agent to choose membership vs. ranked mode, so we run both and merge: substring (exact-intent) hits first, then semantic neighbours not already shown, deduped by slug.

| Option | "tacos" | "cozy rainy night" | Verdict |
| --- | --- | --- | --- |
| Semantic only | mediocre | great | named-dish lookups regress |
| Substring only | great | useless | no vibe search |
| Single blended score | ok | ok | title-hit vs tag-hit strengths hard to tune |
| **Two-tier (chosen)** | great | great | exact intent honoured, vibe works, explainable |

Substring is free and always runs; it also is the graceful-degradation path (D4) and the not-yet-embedded fallback. The substring tier reuses `filterRecipes({ query })` verbatim so the cookbook and the MCP membership mode stay byte-for-byte identical.

### D3 — A similarity floor to cut the long tail

Cosine ranks *all* embedded recipes, so without a cutoff every query returns the whole corpus weakly ordered ("asdf" → 200 recipes). The semantic tier drops candidates below a configured floor; a query with no substring hit and nothing above the floor renders a clean "no matches". The MCP ranked tool needs no floor because the agent supplies a facet prefilter and interprets the rows; the open form has neither, so the floor is what keeps nonsense queries honest. The exact value is a tuning constant (see Open Questions), not a spec'd number; the substring tier is unaffected, so named lookups never regress regardless of the floor.

### D4 — Cache the query vector, not the result list

Cache `q → vector` in `KROGER_KV` (the existing ephemeral-infra namespace, alongside `flyer:*` / `health:*`), key `cookbook:qvec:<hash(EMBED_MODEL + normalized_q)>`.

- **Vector, not results:** the vector is stable unless the embedding model changes, so a corpus reconcile is reflected on the very next search with **no invalidation**. Caching results would force a bust on every reconcile.
- **Model in the key:** changing `EMBED_MODEL` (and thus the dimension) yields a new key — no stale-dimension reuse.
- **Why cache at all:** not cost (neurons are negligible) but latency and an abuse dampener for repeat queries ("chicken", "pasta") which dominate organic traffic. A cache miss is the only path that calls Workers AI.

**Alternatives:** cache nothing (fine on cost, no latency win); HTTP page cache via the Cache API (complementary, but per-colo and needs invalidation on reconcile — deferred). The existing `max-age=300` already absorbs same-user repeats in the browser.

### D5 — Pure-cosine ranking in a small dedicated function, not `rankCandidates`

The cookbook is anonymous, so the favourite / freshness / pantry boosts in `rankCandidates` have no inputs. Reusing it with empty favourites/boosts collapses to cosine (the freshness term becomes a uniform constant that cannot reorder), but it drags per-tenant parameters onto an anonymous surface. A small cookbook-search module that sorts survivors by cosine is clearer and keeps the agent-facing ranker and the public ranker from coupling. **Alternative:** reuse `rankCandidates` — rejected for the coupling/clarity cost, not for wrong results.

### D6 — Matching is against the derived description's embedding

Recipe vectors are built from the AI-generated `description` (facets → description → embed in the reconcile), not the raw body. Semantic recall therefore reflects how the description frames a dish. This is accepted as-is: it is the same vector the MCP tool ranks against, descriptions are written to read well, and the substring tier covers literal title/tag terms the description might omit.

## Risks / Trade-offs

- **Open, unauthenticated embed endpoint could be abused** → The vector cache absorbs repeats; neuron cost is sub-dollar even for a million-query day; graceful degradation (D4/D7) means a throttle/quota trip downgrades to free substring search rather than erroring. Hard abuse controls are left to Cloudflare rate-limiting / WAF (Non-Goal).
- **Floor mis-tuned** (too high hides good vibe matches; too low admits noise) → Start conservative and tune against the real corpus during apply; the substring tier is independent, so named-dish lookups never regress whatever the floor.
- **Embeddings reflect the description, not the body** (D6) → semantic recall bounded by description quality; mitigated by the always-on substring tier for literal terms.
- **Whole-table embedding load per uncached search** → fine at friend-group scale (hundreds × 768 floats) — the same load `search_recipes` already does. Vectorize is the written-down scale-out trigger if the corpus outgrows it.
- **Stale browser cache** → the existing `max-age=300` can show a ≤5-min-stale results page; acceptable for a browse surface.

## Migration Plan

Purely additive. No data migration, no schema change, no new binding (reuses `AI`, `KROGER_KV`, `DB`, `CORPUS`). Ships on the normal `main` → deploy path. Rollback is a revert: the empty-`q` path is byte-identical to today's index, so reverting the `?q=` branch restores current behaviour with no cleanup. The `cookbook:qvec:*` KV keys carry a TTL and expire on their own if the feature is rolled back.

## Open Questions

- **Floor value** — settle empirically against the live corpus during apply (start conservative, e.g. mid-range cosine, and adjust).
- **Search box placement** — index page only for v1, or also on each recipe page? Leaning index-only; recipe pages keep the existing "← Cookbook" nav.
- **Show a relevance hint?** — leaning no (consumer surface, not a debug view); reconsider if users can't tell why a result appears.
