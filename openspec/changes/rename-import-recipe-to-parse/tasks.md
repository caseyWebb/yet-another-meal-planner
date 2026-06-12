## 1. Rename the tool in the Worker

- [x] 1.1 In `src/discovery-tools.ts`, change the `server.registerTool("import_recipe", …)` name to `"parse_recipe"` (line ~92).
- [x] 1.2 In `src/discovery-tools.ts`, update the tool's own description: lead with the read-only behavior under the new name; keep a short "writes nothing / commits nothing" clause and the `tools_hint` / `existing_slug` / structured-error language intact (drop the now-redundant `PARSE-ONLY:` shout if the name carries it).
- [x] 1.3 In `src/discovery-tools.ts`, update the `fetch_rss_discoveries` description string "…then import_recipe + create_recipe each" → "…then parse_recipe + create_recipe each" (line ~53).
- [x] 1.4 In `src/discovery-tools.ts`, update the file header comment block that lists `import_recipe — PARSE-ONLY: …` (line ~4).

## 2. Update code comments that name the tool

- [x] 2.1 `src/errors.ts`: comment on `"unreachable"` ("import_recipe could not fetch…") → `parse_recipe` (line ~17).
- [x] 2.2 `src/http.ts`: header comment "Used by import_recipe" → `parse_recipe` (line ~1).
- [x] 2.3 `src/jsonld.ts`: comment "the signal import_recipe maps to the structured `incomplete` error" → `parse_recipe` (line ~246).

## 3. Update the tool-contract doc

- [x] 3.1 `docs/TOOLS.md`: rename the `### import_recipe(url)` heading to `### parse_recipe(url)` and update the section body to the new name (line ~69).
- [x] 3.2 `docs/TOOLS.md`: in the `create_recipe` **Notes**, "the everyday discovery write path: `import_recipe` (parse) → … → `create_recipe`" → `parse_recipe` (line ~104).
- [x] 3.3 `docs/TOOLS.md`: in the `fetch_rss_discoveries` notes, "(then `import_recipe` + `create_recipe` each)" → `parse_recipe` (line ~508).

## 4. Update the agent persona + regenerate the plugin

- [x] 4.1 `AGENT_INSTRUCTIONS.md`: update every `import_recipe` reference to `parse_recipe` — the side-bootstrap step (line ~74), the menu-gen discovery step (line ~92), the `import-recipe` flow body (lines ~187/188/194), and the sparse-corpus onboarding step (line ~285). Leave the **skill name** (`import-recipe`) and the user-facing verb "import" unchanged.
- [x] 4.2 Run `npm run build:plugin` to regenerate `plugin/grocery-agent/` (never hand-edit the bundle); confirm the generated `import-recipe` SKILL.md now reads `parse_recipe`.

## 5. Verify

- [x] 5.1 Run the test suite (incl. the plugin-build test and the discovery/jsonld tests) — all green; no test edit expected since tests assert behavior, not the tool name.
- [x] 5.2 Run `rg -n 'import_recipe' src/ docs/ AGENT_INSTRUCTIONS.md test* tests*` and confirm it returns nothing (the generated `plugin/` is rebuilt, not the source of truth).
- [x] 5.3 Run `openspec validate rename-import-recipe-to-parse --strict` (already green) and re-confirm after implementation.
