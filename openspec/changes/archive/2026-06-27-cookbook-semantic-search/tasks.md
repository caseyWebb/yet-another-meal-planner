## 1. Search + ranking module (pure, testable first)

- [x] 1.1 Create `src/cookbook-search.ts` with a pure two-tier merge: given substring-tier survivors, embedded candidates (`slug → vector`), the query vector, a similarity floor, and `k`, return ordered result rows — substring hits first, then above-floor semantic neighbours by descending cosine, deduped by slug, tie-broken on slug for determinism.
- [x] 1.2 Add the similarity floor as a named exported constant with a conservative starting value (tune during review); keep it out of the spec'd contract.
- [x] 1.3 Add a pure cache-key helper: `cookbook:qvec:<hash(EMBED_MODEL + normalizeQuery(q))>`, reusing `hashText` and a shared query normalization (lowercase, trim, collapse whitespace) so the route and the cache agree.
- [x] 1.4 Keep the module I/O-free (no `env`), mirroring `src/semantic-search.ts`, so the ranking and key derivation are unit-testable without a Workers AI / KV binding.

## 2. Query-vector cache (thin KV layer)

- [x] 2.1 Add `getCachedQueryVector` / `putCachedQueryVector` over `KROGER_KV` using the 1.3 key, storing the vector as JSON with a TTL; a parse/shape mismatch is treated as a miss (self-healing), never a throw.
- [x] 2.2 On a cache miss, embed via `embedText` and write-through; on a hit, skip the Workers AI call entirely.

## 3. Wire search into the `/cookbook` route

- [x] 3.1 In `src/cookbook.ts`, branch `renderIndex` on a trimmed `q`: empty/absent → today's alphabetical index (unchanged); non-empty → the search path.
- [x] 3.2 Search path: load the index + embeddings, run `filterRecipes(index, { query: q })` for the substring tier, resolve the query vector (cache → `embedText`), cosine-rank the embedded survivors, and merge via the 1.1 function.
- [x] 3.3 Graceful degradation: wrap the embed + `loadRecipeEmbeddings` step so any failure (Workers AI down, empty embed index) falls back to substring-only results instead of surfacing an error — the existing try/catch must never turn a search into a 5xx.
- [x] 3.4 Anonymous ranking: pass no favourites / freshness / pantry inputs — pure cosine only (do not reach for `rankCandidates`).

## 4. Search form + results rendering

- [x] 4.1 Add a server-rendered `<form method="GET" action="/cookbook">` with a single `q` text input to the index page header; preserve the current `q` in the input on the results page.
- [x] 4.2 Render results by reusing the existing recipe `<li>` markup (title link + protein/cuisine chips + description), under an "N results for «q»" heading with a "← All recipes" link back to `/cookbook`.
- [x] 4.3 Render a clean "No recipes match «q»" empty state at HTTP 200 (with the back link) when both tiers are empty.
- [x] 4.4 Confirm the response keeps the existing restrictive CSP and contains no `<script>`; escape `q` everywhere it is echoed into HTML.

## 5. Tests

- [x] 5.1 Unit-test the two-tier merge (`src/cookbook-search.ts`): substring-before-semantic ordering, dedup of a both-tier match, floor exclusion, empty-in/empty-out, deterministic tie-break.
- [x] 5.2 Unit-test the cache-key helper: normalization (case/whitespace) collapses equivalent queries; a different `EMBED_MODEL` yields a different key.
- [x] 5.3 Extend `test/cookbook.test.ts`: empty `q` renders the index; a title-matching `q` lists that recipe first; a vibe `q` returns cosine-ranked results; a no-match `q` renders the 200 empty state.
- [x] 5.4 Test graceful degradation: with a failing AI fake, a query still renders substring results and is not a 5xx; and a not-yet-embedded recipe is found by title.
- [x] 5.5 Test the cache: a repeated query reuses the stored vector and makes no second embed call (assert against a call-counting AI fake).

## 6. Docs + validation

- [x] 6.1 Update `docs/ARCHITECTURE.md` where the `/cookbook` route is described to cover the `?q=` two-tier search, the graceful-degradation fallback, and the query-vector cache. (No `docs/TOOLS.md` change — not an MCP tool; no `docs/SCHEMAS.md` change — no D1 shape change.)
- [x] 6.2 Run `openspec validate cookbook-semantic-search --strict` and resolve any issues.
- [x] 6.3 Run `aubr typecheck` and `aubr test` (plus `aubr test:tooling` if touched) green.
- [x] 6.4 Run `/code-review` over the full branch diff and fill the PR template before opening the PR. (Review ran; the should-fix SCHEMAS.md gap + two nits were addressed. Opening the PR is left to the operator.)
