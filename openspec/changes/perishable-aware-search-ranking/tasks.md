## 1. Ranker core (`src/semantic-search.ts`)

- [ ] 1.1 Add `ingredients_key: string[]` and `perishable_ingredients: string[]` to `SearchCandidate` (normalized, possibly empty).
- [ ] 1.2 Add `pantry_overlap: string[]` to `ScoredRecipe` (matched boost items, normalized).
- [ ] 1.3 Extend `RankParams` with `pantryWeight`, `perishWeight` (W_PERISH), `keyWeight` (W_KEY), `overlapCap`; add defaults to `DEFAULT_RANK_PARAMS` (`pantryWeight≈0.12`, `W_PERISH=1.0`, `W_KEY=0.4`, `OVERLAP_CAP=2`).
- [ ] 1.4 Add a pure `pantryOverlap(candidate, boostItems, params)` helper returning `{ boost, matched }`: per-item two-tier weight (perishable tier wins, dedupe by item), summed then saturated at `overlapCap` and scaled by `pantryWeight`.
- [ ] 1.5 Thread `boostItems` into `rankCandidates`, add `boost` to the blended score, and set each row's `pantry_overlap` to `matched`; keep the deterministic sort/tie-break.
- [ ] 1.6 Extend `resolveRankParams` to read the new weights from prefs (sibling of `rotation`), falling back to defaults; ignore malformed values defensively.

## 2. Tool wrapper (`src/tools.ts`)

- [ ] 2.1 Add optional `boost_ingredients: z.array(z.string())` to `searchSpecShape`.
- [ ] 2.2 Resolve the tenant's alias table in the shared per-request reads and normalize each spec's `boost_ingredients` through `normalizeIngredient` before ranking.
- [ ] 2.3 Populate `ingredients_key`/`perishable_ingredients` on each `SearchCandidate` from the survivor's `frontmatter` (tolerate missing/non-array → empty).
- [ ] 2.4 Pass the normalized boost items for each spec into `rankCandidates`.

## 3. Tests (`test/semantic-search.test.ts`)

- [ ] 3.1 Perishable-tier hit outranks a key-only hit of equal cosine.
- [ ] 3.2 Saturation: matching > `overlapCap` items does not exceed the capped boost; an off-vibe high-overlap recipe does not outrank on-vibe candidates.
- [ ] 3.3 Alias normalization: a synonym boost item matches an aliased candidate ingredient.
- [ ] 3.4 No-op paths: absent `boost_ingredients` and zero-overlap both leave ordering unchanged and `pantry_overlap` empty (and zero-overlap candidates are still returned).
- [ ] 3.5 `resolveRankParams` honors overrides and falls back/ignores malformed values.

## 4. Contract docs & persona

- [ ] 4.1 `docs/TOOLS.md`: document the `boost_ingredients` spec param, the `pantry_overlap` return field, and the negative guarantees (reorders survivors only; never admits a gated-out recipe; never excludes a zero-overlap candidate; no per-ingredient embeddings).
- [ ] 4.2 `AGENT_INSTRUCTIONS.md` semantic-meal-plan step 2: replace "pantry-overlap specs whose vibe names the items" with passing at-risk items as `boost_ingredients` on the use-it-up spec; note the agent passes corpus-canonical names.
- [ ] 4.3 Rebuild the plugin bundle: `aubr build:plugin` (needs `$GROCERY_MCP_URL`); do not hand-edit `plugin/`.

## 5. Validate

- [ ] 5.1 `openspec validate "perishable-aware-search-ranking" --strict`.
- [ ] 5.2 `aubr typecheck` and `aubr test` green.
