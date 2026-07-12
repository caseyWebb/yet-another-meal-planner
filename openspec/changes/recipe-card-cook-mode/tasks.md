## 1. Contract + satellite gate

- [x] 1.1 Add `CookModeData` + `RecipeCardData.cook?` (additive) to `packages/contract/src/recipe-card.ts`
- [x] 1.2 Bump `KNOWN_RECIPE_CONTRACT_VERSION` 1 → 2; keep `KNOWN_PROPOSE_CONTRACT_VERSION` at 1
- [x] 1.3 Export `CookModeData` from `packages/contract/src/index.ts`
- [x] 1.4 Bump `packages/satellite/package.json` `0.1.16` → `0.1.17` (contract change gate)

## 2. Shared cook surface (`@yamp/ui`)

- [x] 2.1 `cook-parse.ts`: pure `parseCookBody`/`detectDuration`/`stripCookTokens`/`interpolateIngredientRefs`, absent-safe
- [x] 2.2 `cook-controller.ts`: `useCookController` + `CookHostAdapter` + `createCookBridgeAdapter` (D18) + `resolveCookCapabilities` (D18 ladder + D19 gate) + `parseReadRecipeFavorite`; reuse `localDay` + a seq guard
- [x] 2.3 `components/cook-mode.tsx`: the `CookMode` presentational step machine (browse/mise/step/done)
- [x] 2.4 `cookbook.css`: cook-mode + cook-entry classes + `.ingredient-ref`, from the mockup onto the shared tokens
- [x] 2.5 `index.ts`: export the new surface

## 3. Thin hosts

- [x] 3.1 Member route `_app.recipe.$slug.tsx`: Start Cooking entry + `<CookMode>` over a `CookHostAdapter` wrapping the existing RQ mutations (syncContext/announce no-ops); existing detail controls kept
- [x] 3.2 Widget `RecipeCard.tsx`: freeze caps at first render, `createCookBridgeAdapter`, `<CookMode>`, favorite/log header controls, boot re-hydrate; unknown-newer contract → plain read-only card, no cook entry
- [x] 3.3 Widget `main.tsx`: hand the `App` instance to `RecipeCard`

## 4. Worker stamp + prose

- [x] 4.1 `recipe-card-widget.ts`: stamp `contract_version: 2` (via the bumped constant); pass through optional `cook`; update descriptions (no longer read-only)

## 5. Docs + persona lockstep

- [x] 5.1 `docs/SCHEMAS.md`: `CookModeData` + `RecipeCardData.cook`
- [x] 5.2 `docs/TOOLS.md`: `display_recipe` carries cook mode + the D18 favorite/log writes
- [x] 5.3 `docs/ARCHITECTURE.md`: the second writing widget; guided cook on `display_recipe`
- [x] 5.4 `packages/worker/AGENT_INSTRUCTIONS.md`: `cook` emits `display_recipe`'s widget, drops `recipe_display_v0`

## 6. Tests

- [x] 6.1 `cook-parse.test.ts`: steps/titles/timers/token interpolation; absent-safe on plain bodies
- [x] 6.2 `cook-controller.test.ts`: D18 pairing, capability ladder + contract gate, isError-as-failure, best-effort resilience, local-date, seq latest-wins, re-hydrate parse
- [x] 6.3 Member Playwright: recipe-detail cook entry, mise check-off, step nav + progress, timer arm, done screen; existing favorite/log still work

## 7. Verify

- [x] 7.1 `typecheck`, `@yamp/ui test`, `test`, `test:tooling`, member Playwright, `build:app`, `build:plugin`
- [x] 7.2 `openspec validate "recipe-card-cook-mode" --strict`
