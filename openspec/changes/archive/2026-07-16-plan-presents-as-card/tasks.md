# Tasks — plan-presents-as-card

## 1. Persona

- [x] 1.1 `packages/plugin/AGENT_INSTRUCTIONS.md` plan skill: description line names the card; step 3 renders `display_meal_plan` (card IS the proposal; Commit saves; `propose_meal_plan` fallback for card-less hosts / silent reasoning); step 6 skips the chat-save when the card committed.
- [x] 1.2 `node scripts/build-plugin.mjs --check` + census test green (6 skills unchanged).

## 2. Description

- [x] 2.1 `propose_meal_plan` description lead (`packages/worker/src/meal-plan-proposal-tool.ts`): agent-internal engine; member-initiated ask → `display_meal_plan` (same request shape); data form for reasoning only.

## 3. Tests + docs + verification

- [x] 3.1 Extend `packages/worker/test/route-show-me.test.ts`: `propose_meal_plan` description names `display_meal_plan` for member-initiated asks.
- [x] 3.2 `docs/TOOLS.md`: `propose_meal_plan` section lead matches.
- [x] 3.3 `aube run typecheck`; worker suite; plugin tests; `openspec validate plan-presents-as-card --strict`; archive.
