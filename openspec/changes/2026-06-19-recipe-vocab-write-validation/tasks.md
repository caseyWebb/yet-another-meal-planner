## 1. Shared vocabulary module — single source of truth

- [x] 1.1 Create a plain-JS ESM module (e.g. `src/vocab.js`) exporting `PROTEIN_VOCAB`, `CUISINE_VOCAB`, and `EQUIPMENT_VOCAB` as frozen sets/arrays (the values currently in `scripts/build-indexes.mjs`).
- [x] 1.2 `scripts/build-indexes.mjs`: import the three sets from the shared module; delete the local `PROTEIN_VOCAB` / `CUISINE_VOCAB` / `EQUIPMENT_VOCAB` definitions. Verify the index build still produces byte-identical output for an unchanged corpus.
- [x] 1.3 `src/kitchen.ts`: re-export `EQUIPMENT_VOCAB` from the shared module (remove the local copy and the "keep in sync" comment); confirm `isEquipmentSlug` and the kitchen tests still pass.
- [x] 1.4 Confirm the module imports cleanly in both runtimes: `node scripts/build-indexes.mjs --check` (Node ESM) and `npm run typecheck` + Worker bundle (esbuild/wrangler).

## 2. Write-time enforcement — `src/validate.ts`

- [x] 2.1 Import the shared vocab into `src/validate.ts`.
- [x] 2.2 In the `recipes/*.md` branch of `validateFile`, hard-fail (via `fail()`) when `protein` is present and not in `PROTEIN_VOCAB`, when `cuisine` is present and not in `CUISINE_VOCAB`, or when any `requires_equipment` entry is outside `EQUIPMENT_VOCAB`. Error messages name the field and offending value (and, for a clean agent fix, the legal set).
- [x] 2.3 Update the in-file comments that currently say recipe vocab is "the build's job / D2" to reflect write-time enforcement.

## 3. `none`/empty normalization — recipe write path

- [x] 3.1 In the recipe write path (`src/discovery-tools.ts` `create_recipe` via `buildNewRecipe`, and `src/write-tools.ts` `update_recipe` via `splitRecipeUpdate` / `buildRecipeUpdate`), strip `protein`/`cuisine` whose value is the literal `none` or empty string before serialization, so the field is written as absent.
- [x] 3.2 Confirm a non-`none` off-vocab value (e.g. `shrimp`) still reaches `validateFile` and is rejected (not normalized away).

## 4. Surface the vocab to the agent

- [x] 4.1 `src/discovery-tools.ts` (`create_recipe`) and `src/write-tools.ts` (`update_recipe`) descriptions: enumerate the `protein` and `cuisine` controlled sets (mirroring the equipment list already inlined in `create_recipe`) and state "omit `protein` for a no-protein-focus dish — never `none`".
- [x] 4.2 `AGENT_INSTRUCTIONS.md`: add the one-line classification rule (coarse buckets; map specifics like shrimp→shellfish, salmon→fish; omit protein when there's no protein focus).
- [x] 4.3 Regenerate the plugin: `npm run build:plugin`; confirm the CI "plugin skills current with AGENT_INSTRUCTIONS.md" check passes (`node scripts/build-plugin.mjs --out /tmp/plugin-check --mcp-url __ci__ && diff -r plugin/grocery-agent/skills /tmp/plugin-check/skills`).

## 5. Docs

- [x] 5.1 `docs/SCHEMAS.md`: note that `protein`/`cuisine`/`requires_equipment` are now enforced at write time (Worker), not only at build time; that the sets are defined once in the shared module; and that `none`/empty `protein`/`cuisine` is normalized to absent.
- [x] 5.2 `docs/TOOLS.md`: reflect the `create_recipe`/`update_recipe` contract change (off-vocab recipe frontmatter returns `validation_failed`; `none`/empty protein/cuisine normalized to absent).

## 6. Tests

- [x] 6.1 `test/validate.test.ts`: off-vocab `protein` (e.g. `shrimp`) on a `recipes/*.md` write throws `validation_failed`; off-vocab `cuisine` throws; off-vocab `requires_equipment` slug throws.
- [x] 6.2 In-vocab `protein`/`cuisine`/`requires_equipment` pass `validateFile`.
- [x] 6.3 Recipe write with `protein: none` (and empty string) persists with `protein` absent (normalization), not an error.
- [x] 6.4 A guard test that the shared module is the only definition of each vocab (e.g. `build-indexes.mjs` and `src/validate.ts` resolve the same set object/values) — or, if a mirror is unavoidable, an explicit parity assertion.
- [x] 6.5 `npm test`, `npm run test:tooling`, and `npm run typecheck` are green.
