## 1. Keyword ranker module (pure, testable first)

- [x] 1.1 Repurpose `src/cookbook-search.ts` into a pure, I/O-free keyword ranker: `rankByKeyword(index, q)` → ordered `CookbookHit[]`. Remove the cosine merge, the similarity floor, `EmbeddedCandidate`, `mergeCookbookResults`, `queryVectorCacheKey`, and the `embedding`/`hash` imports.
- [x] 1.2 Tokenize via the shared `queryTokens` (reuse `src/recipes.ts`, do not re-implement stopwords). Score each recipe by summing field-weighted token hits over `title`, `tags`, `protein`, `cuisine`, `course`, `dietary`, `season`, `ingredients_key`, `description`, then scale by query coverage (distinct tokens matched / total). Add the title whole-query prefix bonus.
- [x] 1.3 Express the field weights and match-kind multipliers (whole-word vs prefix/substring; exact-facet vs substring) as named exported constants with conservative starting values — kept OUT of the spec'd contract, to tune during review.
- [x] 1.4 Drop zero-score recipes; sort by descending score, tie-broken on title then slug for determinism. Keep the module free of `env`/I/O so it unit-tests without any binding.

## 2. Route: keyword results page + JSON endpoint, embedding/qvec removed

- [x] 2.1 In `src/cookbook.ts`, delete `getCachedQueryVector` / `putCachedQueryVector` / `resolveQueryVector`, the `QVEC_TTL_SECONDS` constant, the embeddings load in `renderSearch`, and the `embedText` / `EMBED_DIM` / `loadRecipeEmbeddings` imports.
- [x] 2.2 Rewrite `renderSearch` to run `rankByKeyword(index, q)` over the full `loadRecipeIndex` result (no `filterRecipes`) and render the existing results page (reusing `recipeListItem`, the "N results"/empty-state headers, and the back link).
- [x] 2.3 Add a `GET /cookbook/search?q=` branch returning the ranked rows as JSON (`application/json`), an empty list for a no-match or empty `q`, sharing `rankByKeyword` with the server page so ordering agrees.
- [x] 2.4 Serve the client script first-party at `GET /cookbook/search.js` (`text/javascript`, cacheable) from a module-level string constant.

## 3. Client enhancement + CSP split

- [x] 3.1 Add the vanilla-JS client (`/cookbook/search.js` body): on input, debounce (~250 ms), `fetch('/cookbook/search?q=…')` with an `AbortController` that cancels the prior request, ignore stale/out-of-order responses, and patch the results `<ul>` building each row with `textContent` (no `innerHTML` for recipe values). Restore the index view when the query is cleared.
- [x] 3.2 Wire the index/search page to load the script (`<script src="/cookbook/search.js">`) and give the input + results container stable hooks (ids) the script binds to; keep the `<form method="GET" action="/cookbook">` as the no-JS fallback.
- [x] 3.3 Split the CSP: index/search responses get `script-src 'self'; connect-src 'self'` (no `'unsafe-inline'` for script); `/cookbook/<slug>` keeps the strict no-script CSP. Thread the per-page CSP through `htmlResponse`/`page`/`notice` rather than the single shared constant.
- [x] 3.4 Confirm `q` is still escaped everywhere it is echoed into server HTML, and that the JSON endpoint emits valid JSON (no HTML-escaping of values that the client will render as text).

## 4. Tests

- [x] 4.1 Rewrite `test/cookbook-search.test.ts` for `rankByKeyword`: title-before-description weighting, exact-facet match, coverage orders full above partial, prefix/typeahead hit, zero-match exclusion, deterministic title-then-slug tie-break.
- [x] 4.2 Update `test/cookbook.test.ts`: empty `q` renders the index; a title `q` ranks that recipe first; a facet `q` (e.g. cuisine) surfaces the match; a no-match `q` renders the 200 empty state.
- [x] 4.3 Test the JSON endpoint: `/cookbook/search?q=` returns ranked JSON for a match and an empty list (200) for a no-match; the server `?q=` page and the endpoint return the same ordering for a query.
- [x] 4.4 Assert the CSP split: `/cookbook` and `/cookbook?q=` carry `script-src 'self'` + `connect-src 'self'`; `/cookbook/<slug>` carries no `script-src` and no `<script>`; `/cookbook/search.js` is served with a JS content-type.
- [x] 4.5 Confirm no remaining cookbook references to `embedText` / `loadRecipeEmbeddings` / `cookbook:qvec:` (grep gate); `search_recipes`' use of the embedding stack is untouched.

## 5. Docs + validation

- [x] 5.1 Update `docs/ARCHITECTURE.md` where the `/cookbook` route is described: keyword ranking over indexed metadata, the `/cookbook/search` JSON endpoint, debounced client-side search with the no-JS `?q=` fallback, and the CSP split. Remove the semantic/hybrid description.
- [x] 5.2 Update `docs/SCHEMAS.md`: remove the `cookbook:qvec:` KV key family from the KV key catalogue (note it self-expires). Confirm no `docs/TOOLS.md` change (not an MCP tool) and no D1 shape change.
- [x] 5.3 Run `openspec validate cookbook-keyword-search --strict` and resolve any issues.
- [x] 5.4 Run `aubr typecheck` and `aubr test` green (plus `aubr test:tooling` if touched).
- [ ] 5.5 Run `/code-review` over the full branch diff and fill the PR template before opening the PR.
