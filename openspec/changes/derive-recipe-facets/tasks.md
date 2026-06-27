## 1. Agreement eval (gates Tier B + drives the migration)

- [ ] 1.1 Write a spike script that runs the classifier over the current authored corpus and diffs each derived facet against the authored frontmatter value; emit per-field agreement rates and the disagreement set per field (existing authored facets are the ground-truth labels)
- [ ] 1.2 Review agreement rates; confirm each Tier B facet (`protein`, `cuisine`, `course`, `season`, `tags`) clears the trust bar to default to derived — or escalate a low-agreement field back to authored-required; record the threshold + decision in design.md
- [ ] 1.3 Emit the per-recipe strip plan from the eval: Tier A → strip unconditionally; Tier B → strip where classifier agrees, keep-as-override where it disagrees

## 2. Shared classifier

- [x] 2.1 Extract the model + prompt + contract-validated corrective-retry loop from `src/discovery-classify.ts` into a shared classifier module consumed by both the discovery sweep and the new whole-corpus pass (no behavior change to the sweep) — `classifyRecipe` reused by both paths; `DERIVED_FACET_FIELDS` documents the derived subset
- [x] 2.2 Add `meal_preppable` (boolean) to `CLASSIFIED_FIELDS`, the prompt, and a few-shot anchor; resolve its consumer open question — **landed as captured-but-unused** (Tier A, rides `recipes.extra`; no consumer wired)
- [x] 2.3 Make the classifier override-aware: accept supplied authored Tier B overrides as input and condition output on them, so `side_search_terms` tracks the **effective** `course` (`ClassifyConditioning` prompt hint)
- [x] 2.4 Apply alias normalization (`normalizeIngredientList`) to the derived `ingredients_key` and `perishable_ingredients` in the shared path (`extractFacets` in `recipe-classify.ts`)

## 3. Schema

- [x] 3.1 Resolve the sibling-vs-fold open question and add the migration — **separate `recipe_facets` sibling table** (`migrations/d1/0018_recipe_facets.sql`), slug PK + `body_hash` + the 9 derived facet columns
- [ ] 3.2 Apply `--local` and verify the table shape; confirm the projection's wholesale `recipes` rebuild cannot clobber it — **deferred (needs `wrangler d1` + local D1; run in dev)**

## 4. Classify pass (scheduled)

- [x] 4.1 Implement the classify pass with injected deps (testable with in-memory fakes, mirroring `recipe-embeddings.ts`): read R2 bodies directly, gate on `hash(body + conditioning overrides)`, bound per tick, write raw classified facets to the facet table (`src/recipe-classify.ts`)
- [x] 4.2 Wire it into the `scheduled()` handler in the order `classify → recipe-index projection → recipe-derived (describe → embed) → discovery sweep` (4 phases in `src/index.ts`)
- [x] 4.3 Add a `recipe-classify` `health:job` record (counts + pending summary), register it in `HEALTH_JOBS`, ntfy on failure, and rethrow so the cron status reflects failures
- [x] 4.4 Confirm steady-state ≈ 0 work (the `body_hash` gate) and that a cold corpus backfills over several bounded ticks (`CLASSIFY_MAX_PER_TICK`)

## 5. Projection merge

- [x] 5.1 In `src/recipe-projection.ts`, read the facet table and write the **effective** value into each `recipes` facet column: Tier A → derived; Tier B → `authored ?? derived`; `tags` → union; Tier C (`dietary`, `requires_equipment`) → authored (`mergeEffectiveFacets` in `src/recipe-facets.ts`)
- [x] 5.2 Project an unclassified recipe's derived facets as their explicit empty form (not-yet-derived tolerance), never an error (null classified → empty/legacy fallback)
- [x] 5.3 Verify every existing reader (`filterRecipes`, cookbook, retrospective, describe pass, semantic search) is unchanged — it reads the materialized effective value from `recipes` (projection tests green; readers untouched)

## 6. Contract + write-time validation

- [x] 6.1 Update `src/recipe-contract.js`: shrink the required set to the authored gates + identity (`title`, `source`, `time_total`, `dietary`, `requires_equipment`, `pairs_with`); make Tier B optional-but-vocab-validated-when-present; remove Tier A; the `course → side_search_terms` rule now fires only when `side_search_terms` is present (classifier output) — validated-when-present keys on `hasOwnProperty`
- [x] 6.2 `src/validate.ts` uses the shared contract unchanged — write-time now accepts an absent Tier B facet and rejects an off-vocab authored override (covered by the contract rewrite)
- [x] 6.3 Confirmed the one shared module validates both authored overrides and classifier output (the classifier's `toFrontmatter` sets every key → fully validated; authored frontmatter omits keys → relaxed); `time_total` open question resolved — **kept authored** (Tier C)

## 7. Authoring tools

- [ ] 7.1 `create_recipe`: stop requiring agent-supplied Tier A/B facets; seed the classify pass synchronously into the facet table (best-effort, like the description seed) so agent imports are not facet-lagged
- [ ] 7.2 `update_recipe`: accept Tier B overrides and Tier C authored edits, reject off-vocab overrides, and ensure an override edit re-triggers re-derivation via the change gate
- [ ] 7.3 Update the `create_recipe`/`update_recipe` tool descriptions to reflect the param changes (the tool-description ownership boundary)

## 8. Authoring vault

- [ ] 8.1 In `scripts/build-vault.mjs` + `vault-template/`, drop the Tier A controls, demote Tier B to optional-override dropdowns (still generated from `vocab.js`), keep `requires_equipment`/`dietary`/identity, and slim the "New recipe" template to identity + gates + body
- [ ] 8.2 Confirm `aubr build:vault --check` passes and the drift gate still holds

## 9. Migration (strip-on-agreement)

- [ ] 9.1 Snapshot the R2 corpus before the rewrite (the rollback artifact for the lossy strip)
- [ ] 9.2 Run the strip-on-agreement rewrite from the eval's strip plan (Tier A strip-all; Tier B strip-on-agree, keep-on-disagree as overrides) over the R2 corpus
- [ ] 9.3 Let the first reconcile backfill the facet table corpus-wide (bounded per tick); verify the describe/embed cascade re-runs only where effective facets actually changed

## 10. Docs (lockstep)

- [ ] 10.1 `docs/SCHEMAS.md`: recipe frontmatter section (authored gates + identity + optional overrides), the `recipes` projection note, and the new facet table
- [ ] 10.2 `docs/ARCHITECTURE.md`: the classify pass in `scheduled()` + the placement-rule restatement (facets now derived) + the `scheduled()` ordering
- [ ] 10.3 `docs/TOOLS.md`: `create_recipe`/`update_recipe` param changes
- [ ] 10.4 `CLAUDE.md`: the slimmed vault description

## 11. Tests

- [x] 11.1 Unit tests for the classify pass logic: the change gate, bounded-per-tick, classify-failure empty-row, orphan prune, alias normalization (`test/recipe-classify.test.ts`)
- [x] 11.2 Unit tests for the projection effective-facet merge: Tier A derived, Tier B override-wins, `tags` union, null-classified fallback, row parsing (`test/recipe-facets.test.ts`) + projection tests stay green
- [x] 11.3 Contract tests: an absent Tier B facet is accepted, an off-vocab override is rejected, a missing required authored field is rejected, Tier A is not required (`test/recipe-contract.test.ts` + `test/validate.test.ts` rewritten)
- [ ] 11.4 Land the agreement eval as a repeatable script (live-gated like `*.live.test.ts`) — **see task 1.1**

## 12. Verify end-to-end

- [ ] 12.1 `/health` shows the `recipe-classify` job and the `scheduled()` ordering is correct
- [ ] 12.2 `search_recipes`, the cookbook, and the retrospective return identical effective facets to the pre-change corpus (override-wins parity)
- [ ] 12.3 `openspec validate "derive-recipe-facets"`, `aubr typecheck`, and `aubr test` are green
