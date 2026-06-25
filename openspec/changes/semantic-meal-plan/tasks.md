# Tasks

> The D1 platform has landed (#69–#72): the `recipes` and `overlay` tables, `projectToD1`,
> and GitHub-recipes-only are in place — no gate remains. Groups 1–4 are additive and break
> nothing; group 5 is the BREAKING favorite cutover; group 6 is promote-when-proven.
> Vectorize and fully-autonomous cron import are explicit non-goals here.

## 0. Setup

- [x] 0.1 Add the Workers AI binding (`@cf/baai/bge-base-en-v1.5`) to `wrangler.jsonc` (operator-merged) and `.dev.vars.example`

## 1. Recipe semantic-identity fields (additive)

- [x] 1.1 Add `description` and `side_search_terms` to the recipe frontmatter schema (`docs/SCHEMAS.md`) and the build/write-time validators (`scripts/build-indexes.mjs`, `src/validate.ts`) — shape-only, optional
- [x] 1.2 Validate `description` is non-empty-when-present (in both validators); the "not a verbatim copy of source text" guard is an import-persona concern (1.4), not a structural validator (build/Worker have no source page)
- [ ] 1.3 Backfill `description` (+ `side_search_terms` for mains) across the existing corpus — one-time agent-in-session or scripted pass
- [ ] 1.4 Teach the import path (`AGENT_INSTRUCTIONS.md` recipe-import flow) to generate `description` and `side_search_terms` at import

## 2. Embedding reconcile (additive, Worker-side cron — not the build)

> Placement decision (design): the recipe vector is generated **Worker-side on the cron** via `env.AI`, not projected by the Node build (which has no binding) — into a **sibling `recipe_embeddings` table**, so the build's replace-all `recipes` rebuild can't clobber a vector it doesn't own. `env.AI` draws on the internal-subrequest budget, not the flyer's external 50, so it rides the existing one cron trigger.

- [x] 2.1 New migration `migrations/d1/0007_recipe_embeddings.sql`: add `description`, `side_search_terms` columns to `recipes`; create the sibling `recipe_embeddings(slug, embedding, description_hash)` table
- [x] 2.2 Project `description` + `side_search_terms` as `recipes` columns in `scripts/build-indexes.mjs` (no AI in the build) and reconstruct them in `src/recipe-index.ts` (read side stays in sync)
- [x] 2.3 Worker-side cron reconcile (`src/recipe-embeddings.ts`): embed new/changed descriptions via `env.AI` (batched `embedTexts`, change-driven on a `description_hash`), prune orphans, bounded per tick; wired into `scheduled()` as a second job under the one trigger and registered in `HEALTH_JOBS` (`recipe-embed`)
- [x] 2.4 Add a Worker helper to embed a query string (Workers AI) and a cosine helper (`src/embedding.ts` + `test/embedding.test.ts`)
- [x] 2.5 Recipes lacking a `description` get no embedding (excluded from semantic ranking) but stay facet-retrievable via `recipes`; the reconcile prunes a vector when its description is removed

## 3. recipe_semantic_search tool (additive, backend-agnostic)

> Reuses `filterRecipes` (pure, in-memory over the loaded index) for the hard gate, then a brute-force cosine over the `recipe_embeddings` join — matching the codebase's actual list_recipes shape (JS filter over the index, not raw SQL). Pure ranking in `src/semantic-search.ts`; thin wiring in `src/tools.ts`.

- [x] 3.1 Implement `recipe_semantic_search(specs[])`: per spec, facet-prefilter → cosine over survivors → top-K compact rows (slug, title, description, protein/cuisine/time_total, score, similarity)
- [x] 3.2 Hard constraints (dietary, makeability, anti-similarity/variety facets) run in the same `filterRecipes` gate as list_recipes, so semantic rank only reorders survivors and can never admit a rejected recipe
- [x] 3.3 Favorites k-NN re-rank: boost candidates by max cosine to the caller's favorited recipes (nearest-liked, not centroid); no-op on cold start. **Favorite source is `rating >= 4`** (the documented backfill) until group 5 adds `overlay.favorite` — the cutover repoints only the source, not the re-rank math
- [x] 3.4 Freshness boost from `last_cooked`/never-cooked, reading `rotation.resurface_after_days` / `rotation.novelty_boost` from preferences (defaults until group 5.6 formalizes the schema)
- [x] 3.5 Batch K specs into one tool round-trip (all vibes embed in one Workers AI call); return results grouped by spec `label`
- [x] 3.6 Freeze the tool contract as backend-agnostic; registered in `src/tools.ts` and documented in `docs/TOOLS.md`
- [x] 3.7 Unit tests for facet-gating, cosine ranking, k-NN re-rank, freshness boost (pure, injectable deps like `src/matching.ts` — `test/semantic-search.test.ts`)

## 4. Experimental semantic-meal-plan skill (additive, invoke-by-name)

- [x] 4.1 Add the `semantic-meal-plan` flow to `AGENT_INSTRUCTIONS.md`, marked experimental; the description is explicit invoke-by-name ("ordinary menu requests go to meal-plan") so the relevance router never auto-picks it over the production flow
- [x] 4.2 Distillation: context + user message → search specs split into `{ vibe, facets, label }`; retrospective anti-similarity mapped to facets/specs (can't phrase "not chicken" as a vibe)
- [x] 4.3 Recall set: always a variety/wildcard spec, a never-cooked×taste novelty spec, and pantry-overlap specs; generous K
- [x] 4.4 Sides in the same compose pass via chosen mains' `side_search_terms` (facet `course: side`); mains+sides reasoned as one plate
- [x] 4.5 Aggressive in-session import: cheap blurb triage → `parse_recipe` + agent-written `description`/`side_search_terms`/facets → `create_recipe` (lands `active`); only matches; `existing_slug` source-URL dedup; notes the reconcile lag (just-imported isn't re-searchable this session)
- [x] 4.6 Disposition collapse: import = yes; no-action = stays a discovery; explicit reject = SHARED suppression (group-wide), reserved for not-corpus-worthy; no draft state in this flow
- [x] 4.7 Shared suppression in the discovery read path: `reject_discovery(url, reason?)` tool + `discovery_rejections` table (migration 0008); `fetch_rss_discoveries` folds it into `seen`, `read_discovery_inbox` drops matches (canonical URL)
- [x] 4.8 Exploration allowance: surface one flagged "a bit outside your usual" pick (from the wildcard spec)
- [x] 4.9 In-session imports solo-commit per recipe (no batching), matching `create_recipe` today

## 5. Favorite cutover (BREAKING)

> Scope decision (design Resolved Questions): the **favorite swap landed**; the **draft-retirement (5.1) is deferred** to a focused follow-up (it's a separate behavioral flip for the production flow). The `status` lifecycle is unchanged here — `rate_recipe`'s status half split off into `set_recipe_status` rather than being dropped.

- [ ] 5.1 **DEFERRED** — retire `draft` so discovery/import lands a normal corpus recipe (remove the draft-landing default in `create_recipe`/`recipe-discovery`). Its own behavioral change; the experimental `semantic-meal-plan` skill already imports `active` explicitly, so the production flow can flip independently.
- [x] 5.2 Migration `migrations/d1/0009_overlay_favorite.sql`: add `overlay.favorite`, backfill `rating >= 4 ⇒ 1`. `rating` column **retained inert** for rollback (a later migration drops it once proven)
- [x] 5.3 Replace `rate_recipe` with `toggle_favorite(slug, favorite)` **+ `set_recipe_status(slug, status)`** (the status half split off, per the disposition-tools decision) in `src/write-tools.ts`; `src/overlay.ts` + `src/profile-db.ts` read/write `favorite` (`docs/TOOLS.md`)
- [x] 5.4 `mergeOverlay`/`list_recipes` merge `favorite` (boolean), not `rating`; `update_recipe` rejects `favorite`/`status` toward the new tools (`docs/TOOLS.md`, `docs/SCHEMAS.md`). (No `rating` *filter* existed to remove.)
- [x] 5.5 Group signal (`read_recipe_notes`, `idx_overlay_recipe`) → favorited-members list / `COUNT(favorite)` instead of `AVG(rating)`
- [x] 5.6 Add `rotation.resurface_after_days` / `rotation.novelty_boost` as a defined top-level preference key backed by a `profile.rotation` JSON column (migration `0010`); read by `resolveRankParams`, validated in `src/preferences.ts`
- [x] 5.7 **`hidden` — NO.** Reuse per-tenant `status: rejected` (`set_recipe_status`) + group-wide `reject_discovery`; no new column. Recorded in design Resolved Questions.

## 6. Prove and promote

- [ ] 6.1 A/B the experimental skill against dump-and-reason on the real corpus; tune description-generation prompt and distillation (lens-vs-gate, K, spec diversity)
- [ ] 6.2 Update `docs/ARCHITECTURE.md`: retrieve-first selection and the determinism boundary as a token boundary
- [ ] 6.3 If proven, make retrieval the default selection path and revisit retiring `draft`/`status` corpus-wide
- [ ] 6.4 Record the deferred Vectorize promotion trigger (measured-slow / embeddings-through-Worker heavy) and the int8-quantize / prefilter-only mitigations in `docs/ARCHITECTURE.md`
