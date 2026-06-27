## 1. Merge the tool in the Worker

- [x] 1.1 In `src/tools.ts`, define one unified spec shape — `{ label: string, facets?: recipeFiltersShape, vibe?: z.string().optional(), k?, boost_ingredients? }` — replacing the separate `searchSpecShape` (drop the mandatory `vibe`); keep `recipeFiltersShape` as the `facets` object.
- [x] 1.2 Register a single `search_recipes` tool (`inputSchema: { specs: z.array(spec).min(1) }`) and delete the `list_recipes` and `recipe_semantic_search` `registerTool` blocks.
- [x] 1.3 Build the effective index (overlay + last_cooked + owned merge) once per call, reusing the existing `index_unavailable` remap; load embeddings/preferences/aliases only when at least one spec carries a `vibe`.
- [x] 1.4 Embed vibes in a single `embedTexts` call across the vibe-bearing specs only (zero AI subrequests when every spec is vibe-less).
- [x] 1.5 Per spec: run `filterRecipes`; if `vibe` present, run the existing `rankCandidates` path (drop-unembedded, top-`k` via `DEFAULT_K`/`MAX_K`, `boost_ingredients` overlap); if `vibe` absent, return the survivors' compact rows unranked, unembedded included, no `k` cap, `boost_ingredients` ignored.
- [x] 1.6 Return the uniform `{ results: [{ label, recipes }] }` envelope in input order for both modes; confirm the compact row projection (slug, title, frontmatter incl. `favorite`/`description`, plus `score`/`pantry_overlap` in ranked mode) matches the specs.
- [x] 1.7 `aubr typecheck` clean.

## 2. Worker tests

- [x] 2.1 Update `test/semantic-search.test.ts` to call `search_recipes` with vibe-bearing specs and assert the grouped return, the facet/reject gate, the ranking/drop-unembedded/top-`k` behavior, and `boost_ingredients` overlap.
- [x] 2.2 Add membership-mode coverage (vibe-less spec): all survivors returned, unembedded recipes included, `k` ignored, `query`/`course`/makeability/`include_unmakeable` semantics, and `index_unavailable`.
- [x] 2.3 Migrate any remaining `list_recipes` assertions in the Worker test suite to `search_recipes`; `aubr test` green.

## 3. Agent persona + plugin

- [x] 3.1 In `AGENT_INSTRUCTIONS.md`, migrate every `list_recipes(...)` and `recipe_semantic_search(...)` call to `search_recipes({ specs: [...] })` across the `cook`, `cooked`, `configure-grocery-profile`, `add-recipe-feedback`, `meal-plan`, and `semantic-meal-plan` sections (and the shared discovery/import prose), unwrapping `results[i].recipes`.
- [x] 3.2 Phrase named-dish / membership lookups as **vibe-less** specs (with `include_unmakeable: true` where the old prose used it); keep vibe-bearing specs for the semantic retrieval paths — name-for-name migration, no flow rewrite.
- [x] 3.3 Rebuild the plugin (`aubr build:plugin`) and confirm the generated `plugin/grocery-agent/skills/**` reflect the new tool name (no stale `list_recipes`/`recipe_semantic_search` references).

## 4. Docs

- [x] 4.1 `docs/TOOLS.md`: collapse the `list_recipes` and `recipe_semantic_search` entries into one `search_recipes` entry documenting the specs-array input, the grouped return, and the vibe-absent/vibe-present modes; drop the "experimental" qualifier on ranking.
- [x] 4.2 `docs/ARCHITECTURE.md` and `docs/SCHEMAS.md`: update tool-name references to `search_recipes` and reconcile the determinism-boundary / retrieval prose.
- [x] 4.3 Update bare tool-name mentions in any other living spec scenarios touched incidentally (`recipe-index`, `recipe-import`, `guided-cook`, `cooking-history`, `data-write-tools`) to `search_recipes`.

## 5. Verify

- [x] 5.1 `openspec validate "unify-recipe-search"` passes; `aubr typecheck` + `aubr test` + `aubr test:tooling` green.
- [x] 5.2 Grep the repo for residual `list_recipes` / `recipe_semantic_search` references (excluding `openspec/changes/archive/`) and confirm none remain outside this change's own delta files.
