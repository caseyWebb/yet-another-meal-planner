## 1. Shared required-field contract (single source of truth)

- [x] 1.1 Add a shared contract module sibling to `src/vocab.js` (plain `.js` so `scripts/build-indexes.mjs` can import it uncompiled) declaring the required-field set and each field's empty-form shape: non-empty (`title`, `description`, `ingredients_key`, `course`), explicit-`null` scalar (`protein`, `cuisine`, `time_total`, `source`), may-be-empty array (`dietary`, `season`, `tags`, `pairs_with`, `perishable_ingredients`, `requires_equipment`), and conditional `side_search_terms` (non-empty iff `course` includes `main`). — `src/recipe-contract.js`
- [x] 1.2 Add the TypeScript declaration (mirror `src/vocab.d.ts`) so the Worker/tsc/vitest side is typed. — `src/recipe-contract.d.ts`
- [x] 1.3 Export a single reusable validator helper (`validateRecipeContract(frontmatter) → string[]` of violations) consumed by both gates, plus a unit test covering each empty-form shape and the conditional `side_search_terms` rule. — `test/recipe-contract.test.ts` (37 cases)

## 2. Worker write-time enforcement

- [x] 2.1 Replace the present-conditional checks in `src/validate.ts` with the shared contract: hard-fail (`validation_failed`, naming the field) on a missing required field, an empty non-empty field, an off-vocab non-`null` scalar, or a main lacking `side_search_terms`.
- [x] 2.2 Accept explicit `protein: null` / `cuisine: null` as legal; reject the literal `"none"`/`""` (directing `null`).
- [x] 2.3 Remove the none→absent normalization from `src/serialize.ts` (`stripEmptyVarietyDimensions`) and its callers, so explicit `null` is persisted rather than stripped.
- [x] 2.4 In `buildRecipeUpdate` (`src/write-tools.ts`), validate the **merged** result via the commit engine's `validateFile`, and normalize `ingredients_key` through the alias table at write (alongside `perishable_ingredients`).
- [x] 2.5 Apply the same `ingredients_key` normalization in the `create_recipe` builder path (`buildNewRecipe`, `src/discovery.ts`); contract enforcement rides the shared `validateFile`.
- [x] 2.6 Worker unit tests: create/update rejected on each contract violation; merged-result acceptance of a single-field patch; explicit-`null` round-trips; off-vocab still rejected. — `test/validate.test.ts`, `test/write-tools.test.ts`, `test/serialize.test.ts`.

## 3. Build-time enforcement

- [x] 3.1 Update `scripts/build-indexes.mjs` to import the shared contract and **hard-fail** (non-zero exit, naming file + field) on any contract violation, replacing the warn-only soft path for these fields.
- [x] 3.2 `--check` validates without writing and reports every offending file/field (used by the operator backfill and CI) — unchanged entrypoint, now strict.
- [x] 3.3 Tooling tests (`tests/build-indexes.test.mjs`, fixture-based): a missing required field fails the build; explicit `null`/`[]` fixtures pass; free-form `extra` fields pass silently. Fixtures updated to compliance.

## 4. Tool contract + agent guidance

- [x] 4.1 Rewrite the `create_recipe` description (`src/discovery-tools.ts`) to enumerate the full required-field set (including `ingredients_key`, previously absent) and each field's explicit empty form; state `protein: null` for no-focus dishes (never omit, never `none`).
- [x] 4.2 Update the `update_recipe` description (`src/write-tools.ts`) for the merged-result contract and the explicit-`null` rule.
- [x] 4.3 Update the import-skill required-field checklist in `AGENT_INSTRUCTIONS.md`. (Plugin bundle rebuild `aubr build:plugin` needs `$GROCERY_MCP_URL` — runs in deploy tooling, not this public repo; source updated here.)

## 5. Docs (lockstep)

- [x] 5.1 `docs/SCHEMAS.md`: document the required-field contract, the three empty-form shapes, explicit-`null` semantics (retiring none→absent), and a copy-pasteable compliant frontmatter template.
- [x] 5.2 `docs/TOOLS.md`: `create_recipe`/`update_recipe` required params, the merged-result rule, and the `validation_failed` rejection contract.

## 6. Operator backfill + gate enablement (sequenced — out-of-band, on the data repo)

> NOTE: per the "hard fail" decision, the build enforces the contract **unconditionally** (no report-mode flag). This public repo holds no recipes, so the strict build is inert here; the sequencing below governs the **data repo** (`caseyWebb/groceries-agent-data`), whose CI invokes this `build-indexes.mjs`. The operator MUST backfill the corpus before (or alongside) adopting the strict gate — until then the data repo's build is red and the deploy (gated on green CI) is blocked, which is fail-closed but blocks deploys.

- [ ] 6.2 Operator runs the fan-out backfill on the data repo (provided prompt): fill/repair every recipe to the contract — derive `ingredients_key`, author missing `description`/`course`, write explicit `null`/`[]`, strip retired keys.
- [ ] 6.3 Verify corpus compliance: `node scripts/build-indexes.mjs --root <data-repo> --check` exits zero.
- [ ] 6.4 Add the required strict-validation status check on the data repo's `main` (data-repo CI / branch ruleset); confirm **no** required-PR protection is set so the agent's direct-to-main writes still land.
- [ ] 6.5 Verify end-to-end: a deliberately non-compliant hand commit fails CI and blocks deploy; a compliant `create_recipe` write commits directly to `main` and deploys green.
