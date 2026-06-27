# Tasks

> Ordering note: groups 1–3 are additive (the description is generated and stored
> alongside the still-authored frontmatter field, dual-read). Group 4 (drop it from the
> contract + write tools) is **after** the corpus is backfilled, so reads never regress.
>
> Status: implemented + verified in the code repo (typecheck, vitest 662, tooling 123,
> `openspec validate --strict`, local D1 migration all green). The three unchecked items
> (4.4, 6.1, 7.2) need the **live data repo / a deployed Worker with `env.AI`**, which a
> code-repo session can't exercise — left honestly open, not silently checked.

## 1. Derived storage + generation
- [x] 1.1 Migration `0013_recipe_derived.sql`: recreate `recipe_embeddings` → `recipe_derived` with nullable `embedding` + new `description` / `content_hash`, copy existing vectors, and drop the vestigial `recipes.description` column. Reconcile-owned; the build never writes it.
- [x] 1.2 `src/description.ts`: `generateDescription(env, facets)` via `env.AI` (DESC_MODEL = `mistral-small-3.1-24b`), the anti-cliché + 3-shot prompt with both guardrails, structured-error mapped (no raw throw), wrapping-quote strip.
- [x] 1.3 `contentHash(facets)` (shared `src/hash.ts` FNV) over the authored **facets** only (title, ingredients_key, course, protein, cuisine, time_total, dietary, season — **not the body**, per the resolved design fork). Unit-tested in `test/description.test.ts` that it has no description input (a derived-field write can't flip it).

## 2. Reconcile pass
- [x] 2.1 `src/recipe-embeddings.ts` is now the **recipe-derived** reconcile: a describe pass (`content_hash`-gated `env.AI` generation, `DESCRIBE_MAX_PER_TICK`) before the embed pass (`description_hash`-gated), over `recipe_derived`; a freshly-described recipe embeds the same tick.
- [x] 2.2 `health:job:recipe-embed` summary extended with `described`/`describePending` (tenant-data-free); rethrow-on-failure posture unchanged.
- [x] 2.3 `test/recipe-embeddings.test.ts` rewritten for the new `DerivedDeps`: cold describe+embed, steady no-op, re-describe-on-facet-change, embed-missing-vector, prune, describe cap + resume, embed cap, inputBatch chunking.

## 3. Read merge + provisional seed
- [x] 3.1 `read_recipe` merges the D1 description (`recipeDescription(env, slug)`, joined in `Promise.all`); absent reads as omitted, never an error. `search_recipes` reads it via the index JOIN (`recipe-index.ts`).
- [x] 3.2 `create_recipe` seeds the description **synchronously** at import (`seedRecipeDescription`, option (a)) — best-effort (a generation failure never fails the committed import; the reconcile backfills).

## 4. Retire the frontmatter field
- [x] 4.1 `src/recipe-contract.js`: `description` removed from `REQUIRED_NONEMPTY_STRINGS` (so it's out of `REQUIRED_FIELDS`). `validate.ts` delegates to the contract (no description-specific code). Tests updated.
- [x] 4.2 Write path stops authoring `description`: `buildNewRecipe` deletes any supplied `fm.description`; `update_recipe` rejects a `description` arg (`validation_failed`). `serialize.ts` is generic (no change needed).
- [x] 4.3 `scripts/build-indexes.mjs`: `description` dropped from `RECIPE_SCALAR_COLUMNS` and added to `PROMOTED_FIELDS` (excluded from `extra`, so a lingering authored value is dropped). `build-site.mjs` does not consume `description` — no change needed.
- [ ] 4.4 (Optional, cosmetic) one-time pass stripping the dead `description:` line from existing frontmatter — **a data-repo op; deferred** (no recipe data in the code repo; the build already drops it).

## 5. Docs (lockstep)
- [x] 5.1 `docs/SCHEMAS.md`: `description` removed from the frontmatter block + required-field contract; new `## recipe_derived` section (description / content_hash / embedding / description_hash).
- [x] 5.2 `docs/ARCHITECTURE.md`: the placement rule + the two-pass describe→embed reconcile; `recipe_embeddings` → `recipe_derived` throughout.
- [x] 5.3 `docs/TOOLS.md`: `create_recipe` (no description arg, auto-generated), `update_recipe` (rejects description), `read_recipe` (returns the derived description).

## 6. Quality eval
- [ ] 6.1 Held-out eval over **10–20 real recipes** — **deferred: needs the live corpus** (not in the code repo). The spike (design Run 1–3) already picked the lead model + prompt + guardrails and is recorded; this item is the full corpus eval to confirm/finalize the model. Start from `mistral-small-3.1-24b` + the anti-cliché 3-shot prompt at temp ≈ 0.3; include sparse recipes (the small-model hallucination tail).

## 7. Verify
- [x] 7.1 `aube run typecheck`, `test` (662 passed), `test:tooling` (123 passed) all green.
- [ ] 7.2 Local end-to-end (seed → reconcile → `read_recipe`; edit facets → regenerate; derived-write → no regenerate) — **deferred: needs `env.AI` bound in a running Worker** (creds not available in this session). Migration applies to local D1 and the reconcile logic is unit-covered; the live AI round-trip is the only unrun part.
- [x] 7.3 `openspec validate ai-derived-recipe-metadata --strict` passes.
