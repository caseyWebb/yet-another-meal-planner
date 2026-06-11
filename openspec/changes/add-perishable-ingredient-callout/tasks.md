## 1. Schema + docs

- [x] 1.1 Add `perishable_ingredients` to the recipe-frontmatter section of `docs/SCHEMAS.md`: a normalized array of the recipe's perishable ingredients, objective **shared content** (carried in `_indexes/recipes.json`, written by `create_recipe`/`update_recipe`), **derived at import** (not hand-maintained), default empty. State the classification test ("would the leftover rot before I'd use it?") and that names use the pantry-verify normalization.
- [x] 1.2 Update `docs/TOOLS.md` so `perishable_ingredients` appears wherever recipe content is returned (e.g. `read_recipe`, the index-backed `list_recipes`), and note `create_recipe`/`update_recipe` persist it as objective content.

## 2. Index build + validation (`scripts/build-indexes.mjs`)

- [x] 2.1 Confirm the generic objective-frontmatter passthrough already carries `perishable_ingredients` into `_indexes/recipes.json` (mirroring `pairs_with`, ~L171); do not special-case unless the passthrough omits it.
- [x] 2.2 Hard-fail the build when `perishable_ingredients` is present but is not an array of strings; report the offending recipe and value (reuse the `standalone` non-boolean check pattern). Absent → treat as empty, no warning.
- [x] 2.3 Add fixture-based tests in `tests/`: valid array passes; present-but-bare-string fails; absent passes warn-free.

## 3. Worker write-time handling (`src/`)

- [x] 3.1 Confirm `update_recipe`/`create_recipe` route `perishable_ingredients` to shared content (it is not a `SUBJECTIVE_KEY`, so `splitRecipeUpdate` keeps it on the shared file) and that the Worker's structural write-time validation accepts the key (array-of-strings); extend if needed.
- [x] 3.2 Reuse the existing ingredient normalization from `src/pantry-verify.ts` when the field is written/compared, so cross-recipe overlap aligns with pantry matching; factor the normalization into a shared helper if it is not already callable from the write path.
- [x] 3.3 Add/extend a Worker test asserting `update_recipe` with `perishable_ingredients` writes to shared content (not the caller's overlay) and that a non-array value is rejected by write-time validation.

## 4. Agent behavior (`AGENT_INSTRUCTIONS.md` → regenerate plugin)

- [x] 4.1 In `AGENT_INSTRUCTIONS.md`, add the at-import/at-create classification step: classify perishables by the "would the leftover rot" test, normalize, and write `perishable_ingredients` alongside protein/cuisine derivation.
- [x] 4.2 In `AGENT_INSTRUCTIONS.md`, add the menu-gen waste callout to the proposal flow: when a proposed recipe uses a perishable in less than a typical purchase unit (judged from the body + how it's sold) and no other proposed recipe uses it, offer to add a recipe that uses up the remainder or to swap. Reason over the `perishable_ingredients` already in the index / `list_recipes` results — no dedicated search/filter tool, no Kroger lookup. A full-unit use, or a perishable shared by 2+ proposed recipes, triggers nothing.
- [x] 4.3 Regenerate the plugin bundle with `npm run build:plugin` (`scripts/build-plugin.mjs`); do not hand-edit `plugin/`. Confirm the meal-plan and import skills reflect the new behavior.

## 5. Corpus backfill

- [x] 5.1 Run the one-time backfill populating `perishable_ingredients` across the existing corpus using the same import-time classifier (idempotent, content-preserving); commit the resulting recipe edits in the data repo. Spot-check a few recipes for sane, normalized classifications.

## 6. Verification

- [x] 6.1 Run `npm run typecheck`, `npm test`, and `npm run test:tooling` — all green.
- [x] 6.2 Run `node scripts/build-indexes.mjs --check` against a data checkout (or fixtures): clean corpus passes; a planted non-array `perishable_ingredients` fails; absence passes warn-free.
- [x] 6.3 `openspec validate add-perishable-ingredient-callout` passes.
