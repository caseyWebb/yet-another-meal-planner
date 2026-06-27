## Context

The hosted cookbook (`src/cookbook.ts`) is an open, cross-tenant browse surface: `/cookbook/<slug>` renders one recipe's R2 body under a **strict no-script `Content-Security-Policy`** (the body is untrusted author/agent markdown). Each recipe also carries a derived embedding in `recipe_derived.embedding` — a 768-float `bge-base-en-v1.5` vector over the AI-written `description` — produced by the recipe-derived reconcile cron (`src/recipe-embeddings.ts`) and consumed today only by the agent-facing `search_recipes` tool, via `loadRecipeEmbeddings(env)` (`src/recipe-index.ts`) + `cosineSimilarity` (`src/embedding.ts`).

The cookbook-keyword-search change removed the cookbook's only calls to Workers AI and `loadRecipeEmbeddings`, because the **query**-embedding path cost an AI call per uncached visitor query for a marginal, unpredictable win. This change is a different shape: a **recipe→recipe** "Similar Recipes" section on the body page. The viewed recipe's vector already exists, so neighbors are found by cosine over **already-stored** vectors — no query, no AI call. It reuses the embedding stack the keyword change deliberately left intact, without reintroducing the cost that motivated that change.

## Goals / Non-Goals

**Goals:**

- A "more like this" affordance on the recipe page, built from vectors that already exist, at **zero new AI cost** (request-time or index-time).
- Request-time computation reusing `loadRecipeEmbeddings` + `cosineSimilarity`, mirroring how `search_recipes` resolves embeddings live.
- A pure, I/O-free selection module (like `src/cookbook-search.ts`) so the math is unit-testable without bindings.
- Preserve the body page's strict no-script CSP; degrade gracefully (omit the section, never error).

**Non-Goals:**

- Re-introducing query / semantic search to the cookbook — that is what keyword search replaced; this is recipe→recipe, not query→recipe.
- Precomputing or persisting neighbor lists — no D1 migration, no cron change (see D2).
- An approximate-nearest-neighbor / Vectorize index — brute-force cosine is right at friend-group scale; the written-down Vectorize promotion trigger covers eventual scale-out.
- Per-tenant personalization of the neighbors — the surface is anonymous and cross-tenant.
- Client-side interactivity — the section is static, server-rendered links.

## Decisions

### D1 — Recipe→recipe cosine over stored vectors, at request time

The viewed recipe's vector is `embeddings.get(slug)`; cosine it against every other entry in the map, drop self, drop anything below the floor, sort descending (tie-break on slug), take the top N. This reuses the exact primitives `search_recipes` already uses. Because there is no query, there is **no embedding call** — the load-bearing distinction from the removed semantic search.

- **Alternative — query-style semantic search on the body page:** rejected; it needs a query to embed and is precisely what the keyword change removed.
- **Alternative — "similar" by shared facets/tags (keyword, no vectors):** rejected; the description embedding captures dish-level similarity that discrete facets miss, and the vectors are already maintained — using them costs nothing extra.

### D2 — On-request, not precomputed

Compute neighbors while rendering the (already `max-age=300`-cached) body page, rather than persisting a neighbor list in the reconcile.

| | On-request (chosen) | Precompute in reconcile |
| --- | --- | --- |
| D1 migration / schema | none | new column or table |
| Reconcile change | none | all-pairs recompute (any embedding change ripples to many recipes' lists) |
| Freshness | always current | stale up to one cron tick |
| Render cost | whole-table cosine — microseconds at this scale | O(1) neighbor read… but still needs an index read to render titles |
| Consistency with repo | matches `search_recipes`' live cosine | a new persisted-derivation pattern |

Precompute buys almost nothing — the cosine math is microseconds for a few-hundred-recipe corpus, and the render still needs an index read for neighbor titles/chips — while costing a migration and breaking the reconcile's clean change-driven shape. **Alternative — precompute:** rejected for the reasons above; revisit only alongside the Vectorize promotion if the corpus outgrows a whole-table scan.

### D3 — Reuse `loadRecipeEmbeddings`; reintroduce one D1 read (not the AI binding)

The body page reintroduces the single thing the keyword change removed from the cookbook: a read of `recipe_derived` embeddings via `loadRecipeEmbeddings`. It does **not** reintroduce the `AI` binding. The body page today does one R2 read and no D1; it gains a whole-table embeddings read plus an index read (`loadRecipeIndex`, to turn neighbor slugs into render rows), runnable together via `Promise.all`. At friend-group scale (hundreds × 768 floats) this is the same whole-table load `search_recipes` already accepts (design option-B "runway"), and the page cache bounds it to roughly once per recipe per five minutes.

- **Alternative — a targeted SQL fetching only the neighbor vectors:** impossible by construction — you don't know which recipes are neighbors until you've compared against all of them. Whole-table load is inherent to brute-force kNN.

### D4 — Pure selection module; the route supplies the data

A new `src/cookbook-similar.ts` exports a pure `nearestNeighbors(slug, embeddings, { k, floor })` returning ordered neighbor slugs (or `[]`), reusing `cosineSimilarity`. The route (`renderRecipe`) loads the embeddings + index, calls it, maps slugs → `CookbookHit` via the existing `toHit`, and renders with the existing `recipeListItem`. This mirrors the `cookbook-search.ts` pure-ranker split: no I/O in the scorer, so floor / self-exclusion / determinism / unembedded-omission are unit-testable with an in-memory map.

### D5 — Graceful omission, best-effort, CSP unchanged

A viewed recipe with no vector, no neighbor above the floor, or an embeddings-load failure → the section is omitted (no heading, no placeholder) and the body still renders. `renderRecipe` isolates the similar-recipes resolution in its own `try/catch` (or `.catch(() => [])`) so an embeddings/D1 failure drops only the section, not the page — in contrast to an R2 body failure, which remains a real 404/503 because the body *is* the page. The section is static `<a>` links built from `recipeListItem` (escaped text, no raw HTML), so the strict no-script CSP on `/cookbook/<slug>` is preserved verbatim — no `script-src`, no relaxation.

### D6 — Floor and N as tunable constants, out of the contract

As with the keyword `WEIGHTS` and the removed cosine floor, the spec fixes the *semantics* (descending, self-excluded, floored, deterministic ties, graceful omission), not the numbers. The starting N (≈4–5) and the floor settle empirically against the live corpus during apply; the pure module makes either a one-line change.

## Risks / Trade-offs

- **Whole-table embedding load on the body page** (D3) → bounded by friend-group scale and the 5-minute page cache; it is the same load `search_recipes` already performs, and Vectorize promotion is the written-down scale-out.
- **Floor mis-tuned** → too high: the section rarely appears; too low: weak matches surface under "Similar Recipes". It is a deterministic constant — eyeball against the live corpus during apply; flipping it is one line.
- **Description-embedding signal quality** → "similar" means similar in the AI-`description` space (derived from facets), so near-duplicates (two taco variants) pair tightly. Acceptable for a "more like this" affordance.
- **Body page gains a D1 dependency** → previously it read only R2. Mitigated by D5: any D1/embedding trouble omits the section while the R2 body still renders, so the core page never regresses below today's behavior.

## Migration Plan

Purely additive and behavioral. **No D1 migration, no cron change, no new binding** — the `recipe_derived` vectors it reads are already maintained for `search_recipes`. Ships on the normal `main` → deploy path. Rollback is a revert: the section is additive to `renderRecipe`, so removing it restores today's body page with nothing to undo.

## Open Questions

- **Starting N and floor value** — settle empirically against the live corpus during apply (leaning N≈4–5; start the floor near the value the prior cookbook semantic tier used).
- **Section placement** — below the body after the source line (leaning) vs directly under the meta line. Cosmetic; decide during apply.
