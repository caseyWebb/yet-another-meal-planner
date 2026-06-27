## Context

The hosted cookbook (`src/cookbook.ts`) is an open, cross-tenant browse surface: `/cookbook` lists the D1 `recipes` index alphabetically, `/cookbook/<slug>` renders one recipe's R2 body. It currently answers `?q=` with a **two-tier hybrid** (substring + semantic) ranker: `filterRecipes({ query })` for exact-intent hits, then a Workers AI query embedding cosine-ranked against `loadRecipeEmbeddings`, merged below a similarity floor, with the query vector cached in `KROGER_KV` (`cookbook:qvec:*`). The whole page ships a strict `Content-Security-Policy` (`default-src 'none'; style-src 'unsafe-inline'`) — **no script** — because the body page renders untrusted author/agent markdown.

That semantic machinery is shared with the agent-facing `search_recipes` tool (`src/tools.ts` → `loadRecipeEmbeddings` + `rankCandidates`), and **stays**. This change only unwires the *cookbook* from it. What the cookbook keeps and reuses:

- `loadRecipeIndex(env)` (`src/recipe-index.ts`) — the `slug → entry` map, every entry carrying `title`, `tags`, `protein`, `cuisine`, `course`, `dietary`, `season`, `ingredients_key`, and the derived `description`.
- `queryTokens(q)` (`src/recipes.ts`) — lowercase, whitespace-split, stopword-dropped tokenization.
- The `marked` sanitizing renderer, the `esc`/`safeUrl` helpers, and the `recipeListItem` markup in `src/cookbook.ts`.

What goes away: the query embed, the cosine merge, the floor, the `cookbook:qvec:` cache, and the cookbook's only calls to the `AI` binding and `loadRecipeEmbeddings`.

## Goals / Non-Goals

**Goals:**

- Keyword ranking the visitor can predict and we can explain, over the metadata the index already carries — no Workers AI, no KV, no D1 migration.
- A debounced, in-place search UX: type and the list updates without a full-page reload.
- Keep the recipe-body render strict no-script; introduce script only where it's needed and only first-party.
- Preserve a no-JS / shareable-URL path: `/cookbook?q=` still renders ranked results server-side.

**Non-Goals:**

- Re-litigating semantic search for the agent-facing `search_recipes` tool — its embedding stack and ranking are untouched.
- Faceted filter UI (protein/cuisine/time chips that filter) — this is free-text keyword search.
- Client-side ranking / shipping the corpus to the browser — ranking stays server-authoritative.
- Fuzzy matching, stemming, synonyms, or a full inverted index — explicitly "not terribly sophisticated".
- Pagination — a single ranked list suffices at friend-group scale.

## Decisions

### D1 — Keyword field-weighted ranking, not semantic cosine

Replace the two-tier hybrid with a single field-weighted token scorer over indexed metadata.

| Query | Semantic (today) | Keyword (chosen) | Verdict |
| --- | --- | --- | --- |
| "tacos" (named dish) | good (substring tier) | great (title weight) | parity-or-better |
| "chicken" / "thai" (facet) | good | great (facet weight) | parity |
| "quick weeknight" (tags/course) | ok | good (tags/course/desc) | parity |
| "cozy rainy night" (pure vibe) | good | weak unless tokens hit metadata | **regression, accepted** |

The pure-vibe regression is the deliberate trade: the surface is a browseable few-hundred-recipe corpus, the wins were marginal, and the cost (per-query AI call, KV cache, floor tuning, degradation path) was not. **Alternative:** keep the hybrid — rejected as the thing we're removing. **Alternative:** a tiny client-side fuzzy lib (lunr/Fuse) — rejected: ships the corpus, moves ranking off the server (Non-Goal), and is more machinery than a hand scorer.

### D2 — The scoring model

For a tokenized query, each token contributes a **field-weighted** match against each recipe; the per-token contributions sum, then scale by **coverage** (the fraction of distinct query tokens the recipe matched anywhere), so an all-token match outranks a partial one:

```
score = ( Σ_token  Σ_field  weight(field) · matchKind(token, field) ) · (matchedTokens / totalTokens)
        + titlePrefixBonus            // whole normalized query is a prefix of the title (typeahead)
```

- **Field weights (tunable constants, NOT spec'd):** title ≫ tags ≈ protein ≈ cuisine > course > ingredients_key ≈ dietary/season > description. Exact facet equality (`protein === tok`) scores above a substring hit.
- **Match kinds:** whole-word > prefix/substring (partial credit powers typeahead — "chick" reaches "Chicken").
- **Match mode:** OR + coverage (a recipe is eligible on *any* token hit; coverage pushes full matches up). Recall-friendly for a small corpus and a type-as-you-go box. A score of 0 (no token matched) is dropped. Ordering is by descending score, tie-broken **title then slug** for determinism.

This mirrors the repo's existing shape: a **pure, I/O-free ranking module** (like `src/semantic-search.ts`) the route feeds the index into. Weights stay out of the spec'd contract exactly as the cosine floor did. **Alternative:** strict token-AND membership (precise but misses "chicken broccoli" when broccoli isn't named) — the module structure supports flipping to it by dropping partial-coverage rows, so this is a tuning call, not an architectural one (Open Questions).

### D3 — Server-side ranking, debounced client fetch

Ranking runs in the Worker; the browser only debounces input and patches the DOM. **Alternative:** rank client-side over a shipped index — rejected (Non-Goal: server-authoritative ranking; don't ship the corpus). **Alternative:** keep the full-page-reload GET form — rejected as clunky (the UX we're improving). The debounce (~250 ms) plus an `AbortController` that cancels the in-flight request bounds server load to roughly one rank per typing pause; ranking a few-hundred-recipe index in pure JS is microseconds, and the per-request `loadRecipeIndex` is the same D1 read today's `?q=` already does.

### D4 — JSON endpoint, client renders rows via `textContent`

`GET /cookbook/search?q=` returns the ranked rows as JSON; the client builds each `<li>` with `textContent` (no `innerHTML`). **Alternative:** return a server-rendered HTML fragment and `innerHTML`-swap it (DRY — reuses `recipeListItem`) — rejected for the safer pairing: a JSON data API plus `textContent` means even a hypothetical bad escape in a title/description can't inject markup client-side. The cost — the small row markup is expressed twice (server `recipeListItem` for the no-JS page, JS builder for the enhanced path) — is accepted; both render the same fields.

### D5 — CSP split: strict body page, first-party-only search page

Relax CSP **only** on the index/search page; keep the body page locked.

```
/cookbook, /cookbook?q=   →  default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src https: data:
/cookbook/<slug>          →  default-src 'none'; style-src 'unsafe-inline'; img-src https: data:   (UNCHANGED — no script)
```

The search script is served first-party at `/cookbook/search.js`, so `script-src 'self'` admits it with **no `'unsafe-inline'`** and no third-party origin; `connect-src 'self'` is the minimum to let `fetch()` reach the endpoint. The untrusted-markdown render keeps the strongest posture (no script at all). **Alternative:** an inline `<script>` pinned by a CSP `'sha256-…'` hash — rejected: the hash must be recomputed on every script edit (a build-step coupling) for no benefit over a cacheable static asset. **Alternative:** relax CSP globally — rejected: needlessly weakens the body page, the one surface that renders untrusted content.

### D6 — Progressive enhancement over a server `?q=` page

`/cookbook?q=` still renders a complete keyword-ranked results page (no-JS users, shareable/bookmarkable URLs); `/cookbook/search.js` enhances that page into debounced, no-reload search. Both paths call the **same** ranking function — only serialization differs (full HTML page vs JSON rows). **Alternative:** pure client search (drop the server `?q=` page) — rejected: it strands no-JS visitors and makes `?q=` deep links inert.

### D7 — Repurpose the module; retire the cache; keep the stack

`src/cookbook-search.ts` is repurposed from the cosine merge into the pure keyword ranker. The `cookbook:qvec:` KV helpers and the embedding/AI calls leave `src/cookbook.ts`. `src/embedding.ts`, `src/semantic-search.ts`, the reconcile cron, the `recipe_derived.embedding` column, and `loadRecipeEmbeddings` are untouched — `search_recipes` still depends on all of them.

## Risks / Trade-offs

- **Pure-vibe queries regress** (D1) → Accepted by design; mitigated by ranking across many fields including the prose `description`, so a vibe phrase that shares words with a description still surfaces it. The corpus is browseable in full as a fallback.
- **Weights mis-tuned** (D2) → They're deterministic constants; eyeball against real queries during apply. The structure also lets us flip OR→AND if recall is too noisy.
- **A previously script-free surface now runs script** (D5) → Contained: body page unchanged, `script-src 'self'` (no inline), `connect-src 'self'` (same-origin only), JSON + `textContent` rendering (no `innerHTML`).
- **Per-keystroke server requests** (D3) → Debounce + `AbortController` + small corpus; no worse than today's per-`?q=` D1 read. A short-TTL edge/KV cache of the index JSON is a deferred optimization if it ever matters.
- **Markup expressed twice** (D4) → Small and low-churn; the no-JS page and the enhanced path render identical fields.

## Migration Plan

Net-simpler and purely behavioral. No D1 migration, no cron change, no new binding (the `AI` binding simply stops being called from this path; `KROGER_KV`/`DB`/`CORPUS` usage shrinks). Ships on the normal `main` → deploy path. The `cookbook:qvec:*` KV keys stop being written and expire via their existing 30-day TTL — no cleanup job. Rollback is a revert: the empty-`q` index path is unchanged, so reverting restores the prior `?q=` behavior with nothing to undo.

## Open Questions

- **Starting field weights** — settle empirically against the live corpus during apply (begin with title ≫ tags/facets > course > ingredients/dietary/season > description).
- **Match mode** — OR + coverage (leaning) vs strict token-AND; decide with real queries during apply. The module supports either.
- **Minimum query length before the endpoint fires** — 1 char (leaning) vs 2, to avoid ranking the whole corpus for a single letter; trivial to change.
- **Debounce interval** — ~250 ms starting point; tune for feel.
