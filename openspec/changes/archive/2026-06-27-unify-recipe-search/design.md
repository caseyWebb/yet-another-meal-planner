## Context

`list_recipes` and `recipe_semantic_search` are registered as two MCP tools in `src/tools.ts`, but they share their entire front half. Both build the caller's *effective* index the same way — `loadRecipeIndex` joined with the per-tenant overlay (`favorite`/`reject`), cooking-log `last_cooked`, and owned equipment — and both apply the identical `filterRecipes(effective, facets, now, owned)` gate. `recipe_semantic_search` then does one extra thing: it loads embeddings, embeds the spec `vibe`s in one Workers AI call, and ranks the survivors (`rankCandidates`) by cosine + favorite-affinity + freshness + `boost_ingredients` overlap, dropping survivors that have no embedding and returning the top-`k`.

So the difference between "list" and "semantic search" is exactly the ranking tail. The two input shapes already nest: `searchSpecShape = { vibe, label, facets: recipeFiltersShape, k?, boost_ingredients? }` — its `facets` *is* the `recipeFiltersShape` that `list_recipes` takes as its whole input. The only thing standing between them is that `vibe` is mandatory on a spec.

This change is the foundation for the follow-up `promote-semantic-meal-plan` change, which wants to be written against a single recipe-search verb rather than against `recipe_semantic_search` and then renamed.

## Goals / Non-Goals

**Goals:**
- One tool, `search_recipes`, that subsumes both `list_recipes` (membership) and `recipe_semantic_search` (ranked retrieval), forking on whether a spec carries a `vibe`.
- Preserve every existing behavior of both tools exactly — the facet gate, filter semantics, makeability gate, `query` text filter, `index_unavailable` error, the ranking blend, the drop-unembedded rule, the `k` bounds, and the one-embed-call-per-batch batching.
- A single, uniform return envelope and a single input shape, so there is one contract to learn.
- Migrate all in-repo callers (skills, docs, tests) in the same change so nothing references the removed tools.

**Non-Goals:**
- Changing the ranking math, the embeddings pipeline, `filterRecipes`, or any data model. (`src/semantic-search.ts`, `src/recipes.ts`, `src/recipe-index.ts`, `recipe_embeddings` are untouched.)
- Retiring the dump-and-reason meal-plan flow or promoting the semantic flow — that is the next change. Here the meal-plan sections are migrated tool-name-for-tool-name, not rewritten.
- A backward-compatible alias or deprecation window for the old tool names — this is an internal MCP contract with only in-repo callers, migrated atomically.

## Decisions

### `vibe` presence is the mode — no separate flag

A spec with a `vibe` is ranked; a spec without one is pure membership. We do **not** add a `mode: "list" | "search"` enum, because the vibe's presence already carries that information unambiguously and a redundant flag invites contradictory inputs (`mode: "list"` + a `vibe`). The forked behavior:

| | vibe absent (membership) | vibe present (ranked) |
|---|---|---|
| survivors | all that pass the facet gate | all that pass the facet gate |
| unembedded survivors | **kept** | **dropped** (can't be cosine-ranked) |
| ordering | none (index order) | cosine + favorite + freshness + boost |
| `k` | ignored — return the full set | top-`k` (default `DEFAULT_K`, max `MAX_K`) |
| `boost_ingredients` | ignored (nothing to re-rank) | applied |

Rationale for keeping unembedded recipes in membership mode: this is the load-bearing reason `list_recipes` exists alongside semantic search today — a *just-imported* recipe (no embedding until the next cron reconcile) must still be findable by name. Named-dish lookup is therefore a **vibe-less** spec; routing it through a vibe would silently drop a fresh import. The persona prose must say "no vibe for named-dish lookup" explicitly.

**Alternative considered — keep two tools:** rejected; it's the duplication this change exists to remove.

### Always a `specs` array, always a grouped return

Input is always `{ specs: [...] }` (min 1); output is always `{ results: [{ label, recipes }] }`. A membership caller passes a one-element array and reads `results[0].recipes`. We do **not** offer a single-spec convenience form returning flat `{ recipes }` (the user chose the uniform shape): two input shapes and two return shapes on one tool would re-introduce the "which form do I use?" decision we're deleting. The mild cost is verbosity at simple call sites (`cook`, `configure-grocery-profile`), accepted for one contract.

`label` stays required even for a lone membership spec; it's cheap and keeps the envelope uniform.

### The two specs keep their homes; the tool spans both

The merged tool is described across the two existing capabilities, mirroring the code split (`filterRecipes` gate vs `rankCandidates`):
- **`data-read-tools`** owns the tool's existence, the `specs`-array input, the grouped return envelope, the **membership mode** (vibe-absent: all survivors incl. unembedded, no `k`), the filter semantics, the makeability gate, the `query` text filter, and `index_unavailable`.
- **`semantic-recipe-search`** owns the **ranked mode** (vibe-present: cosine + favorite + freshness + `boost_ingredients`, drop-unembedded, top-`k`).

We do **not** mint a new merged capability — that would churn the spec history for no behavioral gain, and the gate-vs-rank split is a real, durable seam.

### Code shape

Collapse the two `registerTool` blocks into one `search_recipes`. The handler does the shared effective-index build once, then `await embedTexts(env, specsWithVibe.map(s => s.vibe))` only when at least one spec carries a vibe (so a pure-membership batch makes **zero** AI subrequests, exactly as `list_recipes` does today). Per spec: run `filterRecipes`; if the spec has a vibe, run the existing `rankCandidates` path (drop-unembedded, top-`k`); otherwise return the survivors' compact rows directly, unranked. The unified input shape is `recipeFiltersShape` lifted into a spec: `{ label: string, facets?: recipeFiltersShape, vibe?: string, k?: number, boost_ingredients?: string[] }`.

## Risks / Trade-offs

- **Named-dish lookup with a stray `vibe` silently drops a fresh import** → the membership/ranked fork means a vibe on what should be a membership query changes semantics. Mitigation: the persona prose for named-dish lookup specifies a vibe-less spec with `include_unmakeable: true`; the `data-read-tools` spec states the membership contract explicitly; this is also exactly how the old two-tool split behaved (you'd have called `list_recipes`).
- **Callers that read flat `{ recipes }` break** → every in-repo caller now unwraps `results[i].recipes`. Mitigation: all call sites migrated in this change (skills + tests), `aubr typecheck` + `aubr test` gate it; no external consumers exist (internal MCP tool).
- **Interim naming drift in untouched flow specs** → `menu-generation` and a few others mention the old tool names in scenarios; those flows are revised in later changes. Mitigation: update bare tool-name mentions where touched; the contract-defining specs (`data-read-tools`, `semantic-recipe-search`) are fully reconciled here, so no requirement is left describing a removed tool.
- **Two registered tools → one** is a visible surface change for anyone with the MCP server connected mid-deploy. Mitigation: Worker + regenerated `plugin/` deploy together; rollback is a straight revert.
