## 1. Inventory & baseline

- [x] 1.1 Grep the three consumer surfaces for path/extension references and record the baseline list: `rg -no "[A-Za-z_]+/[A-Za-z_<>*]+\.(toml|md)|[a-z_]+\.(toml|md)" src/*-tools.ts src/tools.ts AGENT_INSTRUCTIONS.md` — this is the worklist and the later acceptance check.
- [x] 1.2 Classify each distinct filename as A (tool-backed concept), B (operator config, no agent verb), or C (pure side-effect path) per the disposition table in `design.md`. Confirm the intent-model nouns (pantry/stockup/grocery_list/meal_plan/cooking_log) are flagged as the keep-noun exception. (Found: most src matches are internal code — `readFile` path args, `parseToml` labels, `const *_PATH`, comments — which are out of scope; only description strings + agent-facing `ToolError`/`notFoundMessage` text were edited.)

## 2. Rewrite MCP tool descriptions (`src/`)

- [x] 2.1 `src/tools.ts` — descriptions reworded (`read_preferences`, `read_taste`, `read_diet_principles`, `read_pantry`, `kroger_flyer`, `ready_to_eat_available`, `propose_substitutions`); messages reworded (`preferences`/`pantry`/`taste`/`diet_principles` "not set up", recipe-index, stale_only, recipe-missing-ingredients).
- [x] 2.2 `src/write-tools.ts` — `add_draft_ready_to_eat` description drops `users/<id>/ready_to_eat.toml`; `buildPantryUpdate` message → "no pantry is set up". (The `PATHS` map and `userPath(...)` args are real code paths — left as-is.)
- [x] 2.3 `src/discovery-tools.ts` — `fetch_rss_discoveries` description: feeds→"configured discovery feeds", `taste.md`→"the user's taste profile (read_taste)"; `create_recipe` drops `recipes/<slug>.md`; already-exists message → slug form.
- [x] 2.4 `src/order-tools.ts` — `place_order` description: `grocery_list`→"grocery list", `pantry_has`→"pantry on-hand", `skus/kroger.toml`→"the shared SKU cache".
- [x] 2.5 `src/cooking-tools.ts` — `retrospective` description and the recipe-index message reworded. (`notes-tools.ts` only had a code comment — out of scope.)
- [x] 2.6 Swept all `ToolError`/`notFoundMessage` text across `src/` for internal paths; reworded each. Verified no test asserts on the message text (only error `code`s); no `code` changed.

## 3. Rewrite `AGENT_INSTRUCTIONS.md`

- [x] 3.1 Persona/prose sections — replaced internal filenames with concept nouns; intent-model nouns kept (grocery list, stockup list, pantry, cooking log), `.toml`/path decoration stripped; semantics preserved.
- [x] 3.2 Flow bodies — internal paths removed; where it read as a procedure, pointed at the tool instead (`update_aliases`, `read_diet_principles`, `read_grocery_list`, `update_pantry`, `update_taste`, `update_diet_principles`). Skill descriptions (frontmatter) for update-pantry and cooked also cleaned.

## 4. Regenerate & sync

- [x] 4.1 Rebuilt with `node scripts/build-plugin.mjs --mcp-url https://groceries-mcp.caseywebb.xyz/mcp` (the bare `npm run build:plugin` refuses without the connector URL). 14 skills regenerated; grep confirms no internal paths; `.mcp.json` byte-unchanged.
- [x] 4.2 Synced `docs/TOOLS.md` headline tool descriptions (`create_recipe`, `read_preferences`/`read_taste`/`read_diet_principles`, `ready_to_eat_available`, `propose_substitutions`, `fetch_rss_discoveries`, `add_draft_ready_to_eat`, `retrospective`, `kroger_flyer`, `place_order`). Architectural **Notes:** that document internal file layout for developers (overlay/SKU-cache/per-tenant routing, cross-referenced with `SCHEMAS.md`) are kept per the developer-surface carve-out in the spec.

## 5. Verify

- [x] 5.1 Re-ran the grep: consumer surfaces clean. Only survivors in `src` are real `path` args (`userPath("pantry.toml")`, `readFile(..., "pantry.toml", ...)`) — file I/O, not descriptions/messages. AGENT_INSTRUCTIONS + generated skills: zero.
- [x] 5.2 `npm run typecheck` exit 0; `npm test` 316 passed / 9 live-skipped; `npm run test:tooling` 57 passed. No test asserted on reworded message text — nothing to fix; no error `code` changed.
- [x] 5.3 Spot-checked `place-grocery-order` and `meal-plan` generated skills + the rewritten read-tool descriptions: actionable content preserved, only path framing removed; flow procedures now point at tools (`read_grocery_list`, `read_diet_principles`, `update_pantry`).

## 6. Ship

- [ ] 6.1 Commit `src/**`, `AGENT_INSTRUCTIONS.md`, `plugin/**`, `docs/TOOLS.md` together. Push to `main`, then trigger the data-repo deploy (`gh workflow run deploy.yml --repo <operator-data-repo>`) since `src/**` changed.
