## 1. Controlled vocabulary + recipe frontmatter (tooling)

- [x] 1.1 Add `EQUIPMENT_VOCAB` to `scripts/build-indexes.mjs` (alongside `PROTEIN_VOCAB`/`CUISINE_VOCAB`), seeded from design D6 — trim/extend the starter list during review. (Settled: Core 4 — pressure-cooker, sous-vide-circulator, blender, ice-cream-maker.)
- [x] 1.2 Validate `requires_equipment`: hard-fail on any entry outside `EQUIPMENT_VOCAB` (name value, recipe, field); absent/empty passes silently (warn-only optional-array, like `pairs_with`).
- [x] 1.3 Carry `requires_equipment` into `_indexes/recipes.json` (default `[]` when absent).
- [x] 1.4 Add a fixture recipe with a valid `requires_equipment` and one with an off-vocab value; assert pass/hard-fail in `tests/`.

## 2. Kitchen inventory state + validation

- [x] 2.1 Define the `users/<username>/kitchen.toml` schema (top-level `owned` array of vocab slugs; freeform `[notes]` table) in `docs/SCHEMAS.md`.
- [x] 2.2 Add Node structural validation in `build-indexes.mjs`: parse-check, `owned` is a string array of `EQUIPMENT_VOCAB` slugs (else hard-fail naming the slug), `[notes]` freeform; absent file valid.
- [x] 2.3 Add the Worker write-time structural subset in `src/validate.ts` (mirror the `ready_to_eat` pattern: TOML parses, `owned` vocab-clean → else structured error, no commit).
- [x] 2.4 Fixtures: valid `kitchen.toml`, off-vocab `owned`, freeform-notes, absent-file — assert in `tests/` and the Worker test suite.

## 3. Worker tools — read_kitchen / update_kitchen

- [x] 3.1 Implement `read_kitchen()` → `{ owned, notes }`, returning `{ owned: [], notes: {} }` when the file is absent (no error).
- [x] 3.2 Implement `update_kitchen(operations)` — add/remove `owned` slugs, set `[notes]` fields; reject off-vocab `add` with a structured conflict; absent-target remove → conflict (not whole-call failure); same commit posture as `update_pantry`.
- [x] 3.3 Register both tools on the MCP server; add `test/*.test.ts` coverage (add, off-vocab reject, notes set, read-after-write, absent read).

## 4. Worker — list_recipes makeability gate

- [x] 4.1 Join the caller's `kitchen.toml` `owned` into `list_recipes` (alongside the existing overlay + cooking-log joins).
- [x] 4.2 Apply the default gate: drop recipes where `requires_equipment ⊄ owned`; empty/absent `owned` → no-op (every recipe passes).
- [x] 4.3 Add the `include_unmakeable: true` param: return unmakeable recipes annotated `missing_equipment: [...]` instead of dropping.
- [x] 4.4 Tests: unmakeable excluded by default, empty-inventory no-op, `include_unmakeable` annotates, gate ANDs with other filters, empty `requires_equipment` always makeable.

## 5. Add-recipe path — classification

- [x] 5.1 `import_recipe`: when the schema.org `Recipe` carries a `tool` property, surface it in the parse result as `tools_hint` (non-authoritative); update its return type and `docs/TOOLS.md`. Add a parse test with a `tool`-bearing JSON-LD fixture.
- [x] 5.2 `create_recipe`/`update_recipe`: accept `requires_equipment` as a loose array and pass it through to the written frontmatter (no Worker-side vocab enforcement — build is the gate).
- [x] 5.3 Update the `import-recipe` skill (in `AGENT_INSTRUCTIONS.md`): add `requires_equipment` to the classification step with the conservative rubric (default empty; vital-only; `tools_hint`/prose are hints not the verdict; when unsure, omit).

## 6. Onboarding + cook skills

- [x] 6.1 Add the kitchen-equipment checklist area to `configure-grocery-profile` (in `AGENT_INSTRUCTIONS.md`): walk `EQUIPMENT_VOCAB` as a short checklist, persist `owned` via `update_kitchen`, seed `owned` only (not `[notes]`), skippable.
- [x] 6.2 Update the `cook` skill (in `AGENT_INSTRUCTIONS.md`): read `kitchen.toml`, ask only for absent equipment, reason over `[notes]` for parallelization; fall back to asking when the file is absent.
- [x] 6.3 Rebuild the plugin (`npm run build:plugin`) and confirm the generated skills under `plugin/` reflect the edits.

## 7. Docs + validation

- [x] 7.1 Update `docs/TOOLS.md`: `read_kitchen`/`update_kitchen`, the `list_recipes` gate + `include_unmakeable`/`missing_equipment`, and `import_recipe`'s `tools_hint`.
- [x] 7.2 Update `docs/SCHEMAS.md`: `requires_equipment` frontmatter field + the `EQUIPMENT_VOCAB` reference (kitchen.toml covered in 2.1).
- [x] 7.3 Run `npm run typecheck`, `npm test`, and `npm run test:tooling`; run `openspec validate "add-kitchen-equipment-inventory"`.

## 8. Deploy

- [ ] 8.1 After merge to `main`, trigger the operator data-repo deploy (`gh workflow run deploy.yml --repo <data-repo>`) so the Worker changes go live; watch it to green. *(Deferred — post-merge step; run after the change is committed and pushed.)*
