# Tasks

> Sequenced after `d1-recipe-index` lands (the D1 recipe table is the home for the
> embedding column and the SQL facet-prefilter). Groups 1–4 are additive and break
> nothing; group 5 is the BREAKING favorite cutover; group 6 is promote-when-proven.
> Vectorize and fully-autonomous cron import are explicit non-goals here.

## 0. Gate

- [ ] 0.1 Confirm `d1-recipe-index` has landed (recipe index served from the D1 table; `loadRecipeIndex`/targeted queries available)
- [ ] 0.2 Add the Workers AI binding (`@cf/baai/bge-base-en-v1.5`) to `wrangler.jsonc` (operator-merged) and `.dev.vars.example`

## 1. Recipe semantic-identity fields (additive)

- [ ] 1.1 Add `description` and `side_search_terms` to the recipe frontmatter schema (`docs/SCHEMAS.md`) and the build/write-time validators (`scripts/build-indexes.mjs`, `src/validate.ts`) — shape-only, optional
- [ ] 1.2 Validate `description` is non-empty-when-present and not a verbatim copy of the source page text (best-effort guard)
- [ ] 1.3 Backfill `description` (+ `side_search_terms` for mains) across the existing corpus — one-time agent-in-session or scripted pass
- [ ] 1.4 Teach the import path (`AGENT_INSTRUCTIONS.md` recipe-import flow) to generate `description` and `side_search_terms` at import

## 2. Embedding projection (additive)

- [ ] 2.1 Add an `embedding` column to the D1 recipe table (migration `migrations/d1/*.sql`)
- [ ] 2.2 In the build, compute each recipe's embedding via Workers AI from its `description`+title and write it in the same replace-all index rebuild (atomic with the row)
- [ ] 2.3 Skip embedding for recipes lacking a `description`; ensure they remain facet-retrievable but excluded from semantic ranking
- [ ] 2.4 Add a Worker helper to embed a query string (Workers AI) and a cosine helper

## 3. recipe_semantic_search tool (additive, backend-agnostic)

- [ ] 3.1 Implement `recipe_semantic_search(specs[])`: per spec, SQL facet-prefilter → cosine over survivors → top-K compact rows (slug, title, description, key facets, score)
- [ ] 3.2 Enforce hard constraints (dietary, makeability, anti-similarity/variety facets) in the SQL filter so semantic rank cannot override them
- [ ] 3.3 Favorites k-NN re-rank: boost candidates by max cosine to the caller's favorited recipes (nearest-liked, not centroid); no-op on cold start
- [ ] 3.4 Freshness boost from `last_cooked`/never-cooked, reading `rotation.resurface_after_days` / `rotation.novelty_boost` from preferences
- [ ] 3.5 Batch K specs into one tool round-trip; return results grouped by spec
- [ ] 3.6 Freeze the tool contract as backend-agnostic; register in `src/tools.ts` and document in `docs/TOOLS.md`
- [ ] 3.7 Unit tests for facet-gating, cosine ranking, k-NN re-rank, freshness boost (pure, injectable deps like `src/matching.ts`)

## 4. Experimental semantic-meal-plan skill (additive, invoke-by-name)

- [ ] 4.1 Add the `semantic-meal-plan` flow to `AGENT_INSTRUCTIONS.md`, marked experimental; ensure `build-plugin.mjs` does NOT auto-route it from `grocery-core`
- [ ] 4.2 Distillation: context + user message → K search specs split into `{ vibe, facets, label }`; map retrospective anti-similarity to facets
- [ ] 4.3 Recall set: always include a variety/wildcard spec, a never-cooked×taste novelty spec, and pantry-overlap specs; generous K
- [ ] 4.4 Sides in the same compose pass via chosen mains' `side_search_terms` (facet `course: side`); preserve holistic mains+sides reasoning
- [ ] 4.5 Aggressive in-session import: cheap blurb triage → `parse_recipe` + agent-written `description`/`side_search_terms`/facets → `create_recipe`; only matches; exact source-URL dedup
- [ ] 4.6 Disposition collapse: import = yes; explicit "no" suppresses the discovery URL (per-tenant suppression list); no draft state in this flow
- [ ] 4.7 Exploration allowance: optionally surface one flagged "a bit outside your usual" pick
- [ ] 4.8 Batch in-session imports into the session commit (rather than one commit per import)

## 5. Favorite cutover (BREAKING)

- [ ] 5.1 Replace `create_recipe` draft assumption: discovery/import lands a normal corpus recipe (update `recipe-discovery`); remove the draft-landing behavior
- [ ] 5.2 Add `toggle_favorite(slug, favorite)`; remove any star-rating write path (`docs/TOOLS.md`, `src/write-tools.ts`)
- [ ] 5.3 `list_recipes`: add `favorite` filter/return; remove `rating` filter/return (`docs/TOOLS.md`, `src/recipes.ts`)
- [ ] 5.4 Group signal → `COUNT(favorites)` instead of `AVG(★≥4)` (the D1 aggregate from `d1-profile`)
- [ ] 5.5 Migration `rating → favorite` (e.g. `★≥4 ⇒ true`), folded into the `d1-profile` overlay move; retain original stars through cutover for rollback
- [ ] 5.6 Add `rotation.resurface_after_days` / `rotation.novelty_boost` to the preferences merge-patch schema
- [ ] 5.7 Decide `hidden` boolean (per-tenant "never show me") vs URL-suppression-only; implement the chosen path

## 6. Prove and promote

- [ ] 6.1 A/B the experimental skill against dump-and-reason on the real corpus; tune description-generation prompt and distillation (lens-vs-gate, K, spec diversity)
- [ ] 6.2 Update `docs/ARCHITECTURE.md`: retrieve-first selection and the determinism boundary as a token boundary
- [ ] 6.3 If proven, make retrieval the default selection path and revisit retiring `draft`/`status` corpus-wide
- [ ] 6.4 Record the deferred Vectorize promotion trigger (measured-slow / embeddings-through-Worker heavy) and the int8-quantize / prefilter-only mitigations in `docs/ARCHITECTURE.md`
