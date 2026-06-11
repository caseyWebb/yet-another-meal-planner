## 1. Schema + docs

- [x] 1.1 Add `pairs_with` (array of recipe slugs; default empty) and `standalone` (optional boolean; unset by default, never backfilled) to the recipe-frontmatter section of `docs/SCHEMAS.md`, framing `pairs_with` as a *plating* edge distinct from the `uses_components`/`produces_components` *production* edges, and `standalone` as the already-rounded-plate gate.
- [x] 1.2 Note in `docs/SCHEMAS.md` that both fields are objective shared content (carried in `_indexes/recipes.json`, written by `update_recipe`), not per-tenant overlay.

## 2. Index build validation (`scripts/build-indexes.mjs`)

- [x] 2.1 Carry `pairs_with` (default `[]`) and `standalone` (default unset) through into `_indexes/recipes.json`, mirroring the existing `uses_components`/`produces_components` passthrough (~L171). Verify the generic objective-frontmatter passthrough already emits them rather than special-casing.
- [x] 2.2 Hard-fail the build when a `pairs_with` slug does not resolve to a recipe in the corpus, reusing the slug-resolution pattern used for component references (~L180–181); report the offending recipe and unresolved slug.
- [x] 2.3 Hard-fail the build when `standalone` is present and not a boolean; report the file and value. Absent `pairs_with`/`standalone` SHALL produce no warning.
- [x] 2.4 Add fixture-based tests in `tests/` covering: resolved `pairs_with` passes; unresolved `pairs_with` slug fails; non-boolean `standalone` fails; both fields absent passes warn-free.

## 3. Worker write-time validation (`src/`)

- [x] 3.1 Confirm `update_recipe` persists `pairs_with` and `standalone` as objective content (they are not in `SUBJECTIVE_KEYS`, so `splitRecipeUpdate` routes them to the shared file) and that the Worker's structural write-time validation subset does not reject the two new keys; extend it if needed.
- [x] 3.2 Add/extend a Worker test asserting an `update_recipe` that adds a `pairs_with` slug or sets `standalone: true` writes to shared content, not the caller's overlay.

## 4. Agent behavior (`AGENT_INSTRUCTIONS.md` → regenerate plugin)

- [x] 4.1 In `AGENT_INSTRUCTIONS.md`, add the plate-rounding step to the menu flow: after mains are tentatively chosen and before the parallel context-gathering batch, for each non-`standalone` main either surface its `pairs_with` sides or bootstrap one; infer `standalone` when unset and offer to persist it (alias pattern); fold chosen sides' ingredients into the pantry pass and `kroger_prices` call. Scope to savory sides (starch/veg/salad/bread); defer drinks/wine/dessert.
- [x] 4.2 In `AGENT_INSTRUCTIONS.md`, describe the bootstrap search order (corpus via `list_recipes` → RSS pool → web `import_recipe`), the 1–2 candidate cap, importing an accepted new side as a `status: draft` recipe, and recording the edge via `update_recipe`. The bootstrap selects sides by plate fit and does **not** reason over the `produces_components`/`uses_components` graph — bidirectional component sequencing (`suggest_sequencing`) stays in Change 13.
- [x] 4.3 In `AGENT_INSTRUCTIONS.md`, extend the capture step so agreed sides commit as their own `[[planned]]` rows plus to-buy ingredients, alongside any new `pairs_with` edge / persisted `standalone` flag / imported side draft — in the same commit; no `last_cooked` bump, no cart write.
- [x] 4.4 Regenerate the plugin bundle with `npm run build:plugin` (`scripts/build-plugin.mjs`); do not hand-edit `plugin/`. Confirm the meal-plan skill reflects the new step.

## 5. Verification

- [x] 5.1 Run `npm run typecheck`, `npm test`, and `npm run test:tooling` — all green.
- [x] 5.2 Run `node scripts/build-indexes.mjs --check` against a data checkout (or fixtures) to confirm the new validation passes a clean corpus and fails on a planted bad `pairs_with`/`standalone`.
- [x] 5.3 `openspec validate side-dish-pairings` passes.
