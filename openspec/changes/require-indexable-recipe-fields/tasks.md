## 1. Shared required-field contract (single source of truth)

- [ ] 1.1 Add a shared contract module sibling to `src/vocab.js` (plain `.js` so `scripts/build-indexes.mjs` can import it uncompiled) declaring the required-field set and each field's empty-form shape: non-empty (`title`, `description`, `ingredients_key`, `course`), explicit-`null` scalar (`protein`, `cuisine`, `time_total`, `source`), may-be-empty array (`dietary`, `season`, `tags`, `pairs_with`, `perishable_ingredients`, `requires_equipment`), and conditional `side_search_terms` (non-empty iff `course` includes `main`).
- [ ] 1.2 Add the TypeScript declaration (mirror `src/vocab.d.ts`) so the Worker/tsc/vitest side is typed.
- [ ] 1.3 Export a single reusable validator helper (`validateRecipeContract(frontmatter) → { ok } | { error, field }`) consumed by both gates, plus a unit test covering each empty-form shape and the conditional `side_search_terms` rule.

## 2. Worker write-time enforcement

- [ ] 2.1 Replace the present-conditional checks in `src/validate.ts` with the shared contract: hard-fail (`validation_failed`, naming the field) on a missing required field, an empty non-empty field, an off-vocab non-`null` scalar, or a main lacking `side_search_terms`.
- [ ] 2.2 Accept explicit `protein: null` / `cuisine: null` as legal; reject the literal `"none"`/`""` (directing `null`).
- [ ] 2.3 Remove the none→absent normalization from `src/serialize.ts` (`stripEmptyVarietyDimensions`) and any caller, so explicit `null` is persisted rather than stripped.
- [ ] 2.4 In `buildRecipeUpdate` (`src/write-tools.ts`), validate the **merged** result (`{ ...frontmatter, ...updates }`) against the contract, and normalize `ingredients_key` through the alias table at write (alongside the existing `perishable_ingredients` normalization).
- [ ] 2.5 Apply the same contract validation + `ingredients_key` normalization in the `create_recipe` builder path (`buildNewRecipe`).
- [ ] 2.6 Worker unit tests: create/update rejected on each contract violation; merged-result acceptance of a single-field patch; explicit-`null` round-trips; off-vocab still rejected.

## 3. Build-time enforcement

- [ ] 3.1 Update `scripts/build-indexes.mjs` to import the shared contract and **hard-fail** (non-zero exit, naming file + field) on any contract violation, replacing the warn-only soft path for these fields.
- [ ] 3.2 Confirm `--check` validates without writing and reports every offending file/field (used by the operator backfill and CI).
- [ ] 3.3 Tooling tests (`tests/*.test.mjs`, fixture-based): a missing required field fails the build; explicit `null`/`[]` fixtures pass; free-form `extra` fields pass silently.

## 4. Tool contract + agent guidance

- [ ] 4.1 Rewrite the `create_recipe` description (`src/discovery-tools.ts`) to enumerate the full required-field set (including `ingredients_key`, currently absent) and each field's explicit empty form; state `protein: null` for no-focus dishes (never omit, never `none`).
- [ ] 4.2 Update the `update_recipe` description (`src/write-tools.ts`) for the merged-result contract and the explicit-`null` rule.
- [ ] 4.3 Update the import-skill required-field checklist in `AGENT_INSTRUCTIONS.md` and rebuild the plugin (`aubr build:plugin`).

## 5. Docs (lockstep)

- [ ] 5.1 `docs/SCHEMAS.md`: document the required-field contract, the three empty-form shapes, explicit-`null` semantics (retiring none→absent), and a copy-pasteable compliant frontmatter template.
- [ ] 5.2 `docs/TOOLS.md`: `create_recipe`/`update_recipe` required params, the merged-result rule, and the `validation_failed` rejection contract.

## 6. Operator backfill + gate enablement (sequenced)

- [ ] 6.1 Land tasks 1–5 with the build in report/`--check` mode (no hard-fail enabled yet), so the corpus can be assessed and repaired without breaking the build.
- [ ] 6.2 Operator runs the fan-out backfill on the data repo (provided prompt): fill/repair every recipe to the contract — derive `ingredients_key`, author missing `description`/`course`, write explicit `null`/`[]`, strip retired keys.
- [ ] 6.3 Verify corpus compliance: `node scripts/build-indexes.mjs --root <data-repo> --check` exits zero.
- [ ] 6.4 Enable the build hard-fail and add the required strict-validation status check on the data repo's `main` (data-repo CI workflow); confirm **no** required-PR protection is set so the agent's direct-to-main writes still land.
- [ ] 6.5 Verify end-to-end: a deliberately non-compliant hand commit fails CI and blocks deploy; a compliant `create_recipe` write commits directly to `main` and deploys green.
