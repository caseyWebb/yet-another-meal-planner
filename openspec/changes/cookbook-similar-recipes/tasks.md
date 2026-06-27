## 1. Pure nearest-neighbor selection module

- [ ] 1.1 Create `src/cookbook-similar.ts` as a pure, I/O-free module (mirroring `src/cookbook-search.ts`): export `nearestNeighbors(slug, embeddings, { k, floor })` that returns ordered neighbor slugs, reusing `cosineSimilarity` from `src/embedding.ts`.
- [ ] 1.2 Implement the selection semantics: exclude the viewed `slug` (self), drop neighbors with cosine below `floor`, sort by descending similarity tie-broken on slug, cap at `k`. Return `[]` when the viewed recipe has no vector in the map or nothing clears the floor.
- [ ] 1.3 Define the tunable constants in the module (default `k` ≈ 4–5 and the similarity `floor`), documented as out-of-contract tuning values (as `WEIGHTS` are in `cookbook-search.ts`).

## 2. Wire the section into the recipe page

- [ ] 2.1 In `src/cookbook.ts` `renderRecipe`, resolve neighbors best-effort: load `loadRecipeEmbeddings(env)` + `loadRecipeIndex(env)` (alongside the existing R2 body read via `Promise.all`), wrapped so any embeddings/D1 failure yields no neighbors rather than throwing.
- [ ] 2.2 Map the neighbor slugs to `CookbookHit` rows via the existing `toHit`, and render a "Similar Recipes" section below the recipe body reusing `recipeListItem` (escaped, static `<a>` links).
- [ ] 2.3 Omit the section entirely (no heading, no placeholder) when there are no neighbors — unembedded recipe, none above floor, or load failure.
- [ ] 2.4 Confirm the body page keeps `CSP_STRICT` (no `script-src`) and adds no `<script>`; verify `renderRecipe` makes no `env.AI` call.

## 3. Tests

- [ ] 3.1 Add `test/cookbook-similar.test.ts` unit tests for `nearestNeighbors` over an in-memory map: nearest-first ordering, self-exclusion, floor cutoff, deterministic slug tie-break, `k` cap, and empty result when the viewed recipe is unembedded.
- [ ] 3.2 Extend `test/cookbook.test.ts`: the section renders with neighbors when vectors exist; it is omitted for an unembedded recipe and when an embeddings load fails (body still renders); neighbor titles are escaped; the page contains no `<script>` and keeps the strict CSP.

## 4. Docs

- [ ] 4.1 Update `docs/ARCHITECTURE.md` `/cookbook` route description: the recipe-body page now reads `recipe_derived` embeddings to render a request-time, no-AI "Similar Recipes" section. (No `docs/TOOLS.md` or `docs/SCHEMAS.md` change — not an MCP tool, no file/D1 shape change.)

## 5. Validation

- [ ] 5.1 Run `openspec validate "cookbook-similar-recipes" --strict` and resolve any issues.
- [ ] 5.2 Run `aubr typecheck` and `aubr test` (at least `test/cookbook.test.ts` and `test/cookbook-similar.test.ts`) green.
