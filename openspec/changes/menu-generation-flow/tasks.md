## 1. list_recipes query param (code)

- [x] 1.1 Add `query?: string` to `RecipeFilters` in `worker/src/recipes.ts`
- [x] 1.2 Implement token-AND case-insensitive substring matching over title + tags in `filterRecipes` (split `query` on whitespace; recipe matches when every token is a substring of the lowercased title or any lowercased tag; empty/absent query is a no-op; ANDed with existing filters)
- [x] 1.3 Add `query: z.string().optional()` to `recipeFiltersShape` in `worker/src/tools.ts` and mention the param in the tool description
- [x] 1.4 Add unit tests to `worker/test/recipes.test.ts`: exact-title match ("chicken rice" → "Chicken and Rice"), token-AND exclusion, tag-substring match, composition with status/protein, and absent-query parity with prior behavior
- [x] 1.5 Run `npm test` in `worker/` and confirm green — 146 passed / 4 skipped; `npm run typecheck` clean

## 2. Contract sync

- [x] 2.1 Update `docs/TOOLS.md` `list_recipes` section: add `query` to the params object and a note describing the deterministic title/tag token-AND semantics (no ranking/fuzzy)

## 3. AGENT_INSTRUCTIONS.md menu-generation orchestration

- [x] 3.1 Operationalize "Common flows → Menu request": context pre-pass calls `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, `read_preferences`, `read_taste` in parallel alongside the Change 08 pantry verification — and **deferred the Change 10 discovery feeds** (`fetch_rss_discoveries`/`fetch_flyer_featured`) with an explicit note so the flow doesn't call unbuilt tools (scope note below)
- [x] 3.2 Add named-dish handling: when the user names a dish, use `list_recipes({ query })`, enumerate ALL genuine matches, disambiguate/confirm before walking the pantry (cites the 08 smoke-test failure as the reason)
- [x] 3.3 Specify full proposal assembly: freeform constraints, meal-prep callouts, sale-based substitutions surfaced with the proposal (after flyer data), ready-to-eat options from `ready_to_eat_available`, staples restock, stockup alerts; sized to `default_cooking_nights`
- [x] 3.4 Reaffirm capture-not-flush: agreement writes `grocery_list.toml` via `commit_changes`; never `place_order`; empty-cart case stated explicitly (already in step 7 / empty-cart prose)
- [x] 3.5 Confirm step 3 still reads "sequencing arrives with Change 13" and the flow tolerates an absent sequencing result

> **Scope note (3.1/3.3):** the verbatim agent prose was written ahead and referenced Change 10 discovery tooling inline (step 4 feeds, step 5 "1–2 draft discoveries", the discovery behavior rule). Since Change 10 isn't built, those would have the agent call unbuilt tools — so they're deferred with a Change-10 caveat mirroring the Change-13 sequencing note. Lights up when Change 10 lands.

## 4. Smoke-test validation — MANUAL (live deploy + Claude.ai), user-driven

- [ ] 4.1 Deploy the Worker (CD on push to `worker/**`) and confirm `list_recipes({ query })` returns expected matches via MCP Inspector or a live call
- [ ] 4.2 Run the open-ended seed ("make me a menu") from a fresh Claude.ai conversation; verify against its rubric (context pre-pass, pantry pass, ≥1 sale opportunity, ready-to-eat, staples restock, capture-not-flush)
- [ ] 4.3 Run the recipe-seeded seed ("let's make chicken and rice this week"); verify it enumerates all matches incl. the exact-title recipe and disambiguates before pantry verify
- [ ] 4.4 Run the freeform-constraint seed ("something comforting, I'm feeling lazy"); verify constraint honored, low-effort bias, pantry pass + capture
- [ ] 4.5 Capture the smoke-test transcript as the change artifact; fix any AGENT_INSTRUCTIONS.md / tool-description issues surfaced and re-run the affected seed

## 5. Wrap-up

- [x] 5.1 Verify `docs/TOOLS.md`, `AGENT_INSTRUCTIONS.md`, code, and tests are mutually consistent (no contract drift) — `query` aligned across code, contract, tests, and orchestration prose
- [x] 5.2 ~~Update `ROADMAP.md` Change 09 status if it tracks completion inline~~ — N/A: ROADMAP has no inline status markers; completion is recorded by archiving the OpenSpec change
