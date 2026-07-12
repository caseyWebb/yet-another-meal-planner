## 1. Contract + satellite gate

- [x] 1.1 Add `contract_version?: number` to `ProposeCardData` and `RecipeCardData`
- [x] 1.2 Export `KNOWN_PROPOSE_CONTRACT_VERSION` / `KNOWN_RECIPE_CONTRACT_VERSION` (= 1, independent)
- [x] 1.3 Update `packages/contract/src/index.ts` exports
- [x] 1.4 Bump `packages/satellite/package.json` `0.1.15` → `0.1.16` (contract change gate)

## 2. Shared controller lift (`@yamp/ui`)

- [x] 2.1 Extend `ProposeSession` with `meals`, `attendance` (round-trip only), `slotSides`, `v`
- [x] 2.2 `buildProposeRequest` emits `meals` + `attendance`; `proposeSessionFromRequest` hydrates them
- [x] 2.3 `proposeSlotToView` prefers an edited sides override
- [x] 2.4 Add `useProposeController` + `ProposeHostAdapter` (reducers, iterate/sync/commit discipline)
- [x] 2.5 Add `createBridgeAdapter` (the D18 three-channel realisation), `resolveProposeCapabilities`,
      `packPlanCommitOps`, `nextOpenDates`, `mintRowId`
- [x] 2.6 `MealsStepper` (per-meal steppers); sides editing in `SlotCard`; remove lock/exclude,
      `NudgeBar`, `RerollButton` from the shared surface

## 3. Thin hosts

- [x] 3.1 Member route: adapter over the controller (iterate = POST; commit = plan-ops + navigate)
- [x] 3.2 `lib/propose.ts`: drop React-Query `usePropose`, expose `fetchPropose`; session v4 migration
- [x] 3.3 Widget: adapter via `createBridgeAdapter`; capability ladder + contract-version read-only gate

## 4. Worker stamp + prose

- [x] 4.1 Stamp `contract_version` on `ProposeCardData` (meal-plan-widget) and `RecipeCardData`
- [x] 4.2 Update `display_meal_plan` tool/resource prose: the widget commits via `update_meal_plan`

## 5. Docs lockstep

- [x] 5.1 `docs/TOOLS.md`: the widget commits via `update_meal_plan` (D18)
- [x] 5.2 `docs/SCHEMAS.md`: `contract_version` on both card shapes
- [x] 5.3 `docs/ARCHITECTURE.md`: first writing widget + the D18 commit sequence

## 6. Tests

- [x] 6.1 Fake-bridge harness (`@yamp/ui`): D18 channel pairing, capability ladder, version gate, packer
- [x] 6.2 Update the propose-orchestration unit test (meals request + sides override)
- [x] 6.3 Reshape member Playwright: cut controls ABSENT; per-meal / sides / commit work

## 7. Verify-only

- [x] 7.1 Confirm `member-app-core` did not regress (merge_recipes cut + vibe-suggest 410 stub present)
