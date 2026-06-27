## Why

`list_recipes` and `recipe_semantic_search` are the same tool split in half: both run the identical `filterRecipes` gate over the caller's effective corpus, and `recipe_semantic_search` is just that gate followed by a ranking step. Two tools for one job means a wider surface to learn, duplicated read/merge plumbing, and an arbitrary line ("am I filtering or searching?") the agent has to pick on every recipe lookup. Folding them into one `search_recipes` tool — where the semantic `vibe` is the *only* optional addition — removes the duplication and gives every flow a single verb for "find recipes," whether by name, by facet, or by meaning. This is the foundation the meal-plan-flow promotion writes against, so it lands first.

## What Changes

- **NEW** `search_recipes({ specs: [...] })` tool: takes an array of search specs and returns `{ results: [{ label, recipes }] }`, batching all specs into one round-trip (one Workers AI embed call across all vibes, as today).
- Each spec is `{ label, facets?, vibe?, k?, boost_ingredients? }` — `vibe` is now **optional**. The behavior forks on its presence:
  - **vibe absent** → pure membership: return **all** survivors of the facet gate, unranked, **including recipes with no embedding yet** (just-imported), no `k` cap. (This is today's `list_recipes`.)
  - **vibe present** → rank survivors by cosine to the vibe, nudged by favorite-affinity / freshness / `boost_ingredients`, **drop unembedded** survivors, return top-`k`. (This is today's `recipe_semantic_search`.)
- The facet gate (`filterRecipes`), the per-tenant overlay/last-cooked/owned-equipment merge, the makeability gate, and the `index_unavailable` error are **unchanged** and shared by both modes.
- **BREAKING (tool surface):** `list_recipes` and `recipe_semantic_search` are **removed** and replaced by `search_recipes`. The return shape is **always** the grouped `{ results: [{ label, recipes }] }` envelope — a membership caller passes a one-element `specs` array and reads `results[0].recipes`. There is no flat `{ recipes }` form and no single-spec convenience shape (one tool, one return type). This is an internal MCP tool contract; no external/public API is affected.
- All in-repo callers of the two old tools are migrated to `search_recipes`: the agent skills that do named-dish / membership lookups (`cook`, `cooked`, `configure-grocery-profile`, `add-recipe-feedback`, and both meal-plan sections) in `AGENT_INSTRUCTIONS.md`, plus the regenerated `plugin/` bundle.
- Docs (`TOOLS.md`, `ARCHITECTURE.md`, `SCHEMAS.md`) collapse the two tool entries into one and drop the "experimental" qualifier on the ranking mode.

Out of scope (deferred to the follow-up `promote-semantic-meal-plan` change): retiring the old dump-and-reason meal-plan flow and promoting the semantic flow to default. This change only unifies the tool; the meal-plan sections are migrated name-for-name to keep working, not rewritten.

## Capabilities

### New Capabilities
<!-- none — the unified tool keeps its two existing spec homes, mirroring the code split (gate vs rank). -->

### Modified Capabilities
- `data-read-tools`: `list_recipes` is replaced by `search_recipes`. The membership mode (vibe-absent), the filter semantics (`query`, `course` containment, array-AND, `not_cooked_since`, `exclude_cooked_within_days`), the makeability gate (`include_unmakeable`), the per-tenant overlay merge, and the `index_unavailable` error move onto `search_recipes`. The return shape becomes the grouped `{ results: [{ label, recipes }] }` envelope (was flat `{ recipes }`); the spec input is the `specs` array.
- `semantic-recipe-search`: `recipe_semantic_search` is replaced by the **vibe-present mode** of `search_recipes`. The ranking (cosine + favorite-affinity + freshness + perishable-weighted `boost_ingredients` overlap), the drop-unembedded rule, the `k`/`DEFAULT_K`/`MAX_K` bounds, and the one-embed-call-per-batch behavior carry over unchanged onto the merged tool; only the tool name, the optional-vibe framing, and the (now shared) return envelope change.

## Impact

- **Code:** `src/tools.ts` — collapse the two `registerTool` blocks into one `search_recipes`; merge `recipeFiltersShape` + `searchSpecShape` into a single spec shape with optional `vibe`; branch on `vibe` presence for rank-vs-membership, k-cap, and drop-unembedded. No change to `src/recipes.ts` (`filterRecipes`), `src/semantic-search.ts` (`rankCandidates`), `src/recipe-index.ts`, or the embeddings pipeline.
- **Specs:** delta files for `data-read-tools` and `semantic-recipe-search` (above). Naming references to the old tools in other living specs (`recipe-index`, `menu-generation`, `recipe-import`, `guided-cook`, `cooking-history`, `data-write-tools`) are prose mentions, not requirement changes; they are updated to `search_recipes` where touched and otherwise reconciled when those flows are next revised.
- **Agent persona:** `AGENT_INSTRUCTIONS.md` call sites in `cook`, `cooked`, `configure-grocery-profile`, `add-recipe-feedback`, `meal-plan`, `semantic-meal-plan`; `plugin/` regenerated via `aubr build:plugin`.
- **Tests:** `test/semantic-search.test.ts` (tool name + grouped return); any `list_recipes` behavior assertions in the Worker tests; `aubr typecheck` + `aubr test` green.
- **Docs:** `docs/TOOLS.md`, `docs/ARCHITECTURE.md`, `docs/SCHEMAS.md`.
