## 1. KV helpers

- [x] 1.1 Add `src/user-kv.ts`: typed helpers for reading and writing the `profile:<username>` bundle (read, write, read-modify-write per field) and the `state:<username>:pantry` / `state:<username>:meal_plan` / `state:<username>:grocery_list` session-state keys against `DATA_KV`
- [x] 1.2 Strip GitHub fallback from `src/user-kv.ts`: remove the `gh: GitHubClient` parameter and all GitHub-read/migrate logic from `getProfileBundle`, `getPantryState`, `getMealPlanState`, `getGroceryListState`; KV miss returns `null`/`[]` directly; delete `migrateProfileBundle` and the `PROFILE_MIGRATION_FILES`/`coerceGroceryItem` helpers that only existed for lazy migration; drop `gh-read`, `parse`, `plannedOf` imports that are no longer needed
- [x] 1.3 Update `src/env.ts` `DATA_KV` JSDoc: it holds shared corpus artifacts (`index:recipes`) AND per-tenant profile/state keys (`profile:<username>`, `state:<username>:*`)

## 2. read_user_profile tool

- [x] 2.1 Update `read_user_profile()` in `src/tools.ts`: drop `gh` arg from `getProfileBundle` call (migration runner populates KV before the Worker serves any requests; absent bundle returns all fields null)
- [x] 2.2 Update the per-request lazy cache in `src/tools.ts` (`getPreferences`, `getOverlay`, `getKitchenOwned`) to read from the KV profile bundle instead of GitHub

## 3. profile_status

- [x] 3.1 Rewrite `src/profile-status.ts` `profileStatus()`: check `profile:<username>` bundle key in `DATA_KV` for `preferences` presence (sets `initialized`), check each profile field and the three session-state keys for presence/emptiness to derive `missing` — no GitHub directory listing

## 4. list_recipes and read_recipe overlay source

- [x] 4.1 Update `list_recipes` in `src/tools.ts`: overlay comes from `getOverlay()` (now KV-backed via the profile bundle); `kitchen.toml` `owned` comes from `getKitchenOwned()` (now KV-backed); cooking log still read from GitHub — verify `Promise.all` wiring is correct after changes
- [x] 4.2 Update `read_recipe` in `src/tools.ts`: overlay and cooking-log merge path is the same as `list_recipes` — overlay from KV, cooking log from GitHub

## 5. Profile update tools → KV write-through

- [x] 5.1 Update `update_preferences` in `src/write-tools.ts`: write-through on `profile:<username>` bundle (read-modify-write the `preferences` field); remove GitHub commit path
- [x] 5.2 Update `update_taste` in `src/write-tools.ts`: write-through on `profile:<username>` bundle (`taste` field)
- [x] 5.3 Update `update_diet_principles` in `src/write-tools.ts`: write-through on `profile:<username>` bundle (`diet_principles` field)
- [x] 5.4 Update `update_kitchen` in `src/write-tools.ts` (or `kitchen.ts`): write-through on `profile:<username>` bundle (`kitchen` field)
- [x] 5.5 Update `update_staples` in `src/staples.ts`: write-through on `profile:<username>` bundle (`staples` field); remove `commit_sha` from return shape
- [x] 5.6 Update `update_stockup` in `src/write-tools.ts`: write-through on `profile:<username>` bundle (`stockup` field); remove `commit_sha` from return shape
- [x] 5.7 Update `add_draft_ready_to_eat` and `update_ready_to_eat` in `src/write-tools.ts`: write-through on `profile:<username>` bundle (`ready_to_eat` field)
- [x] 5.8 Update `update_recipe` subjective path (rating/status) in `src/write-tools.ts`: write-through on the `overlay` field of `profile:<username>` bundle instead of committing `overlay.toml` to GitHub

## 6. Pantry tools → KV

- [x] 6.1 Update `read_pantry` in `src/tools.ts` and all callers of `getPantryState` / `getMealPlanState` / `getGroceryListState` to drop the `gh` argument (these now return `null`/`[]` on KV miss, no GitHub fallback)
- [x] 6.2 Update `update_pantry` and `mark_pantry_verified` in `src/pantry-write.ts` (or `write-tools.ts`): write to `state:<username>:pantry` in `DATA_KV`; remove `commit_sha` from return shape; retain upsert-by-name logic

## 7. Meal plan tools → KV

- [x] 7.1 `read_meal_plan` reads `state:<username>:meal_plan` from DATA_KV (covered by 6.1 caller update above)
- [x] 7.2 Add or update `update_meal_plan` tool (was `meal_plan_ops` inside `commit_changes`): write to `state:<username>:meal_plan` in `DATA_KV`; support `add` (with optional `sides`) and `remove` ops with upsert-by-slug semantics; return `{ applied }` with no `commit_sha`
- [x] 7.3 Update `src/cooking-tools.ts` cook-log path that clears the meal plan entry: write the cleared plan to `state:<username>:meal_plan` in `DATA_KV` (instead of committing `meal_plan.toml`)

## 8. Grocery list tools → KV

- [x] 8.1 `read_grocery_list` reads `state:<username>:grocery_list` from DATA_KV (covered by 6.1 caller update above)
- [x] 8.2 Update `add_to_grocery_list`, `remove_from_grocery_list`, `update_grocery_list` in `src/grocery-tools.ts`: write to `state:<username>:grocery_list` in `DATA_KV`; remove `commit_sha` from return shapes
- [x] 8.3 Update `place_order` paths in `src/order-tools.ts` and `src/order.ts` that read/write grocery list status (`active → in_cart`): use KV

## 9. commit_changes cleanup

- [x] 9.1 Remove `grocery_list_ops` field from the `commit_changes` Zod schema and implementation in `src/write-tools.ts`
- [x] 9.2 Remove `pantry_operations` / `pantry_updates` field from the `commit_changes` Zod schema and implementation
- [x] 9.3 Remove `meal_plan_ops` field from the `commit_changes` Zod schema and implementation (meal plan writes go through `update_meal_plan` directly)
- [x] 9.4 Remove corresponding file-handling paths in `src/commit.ts` for pantry, grocery_list, and meal_plan files

## 10. Remove individual profile read tools

- [x] 10.1 Remove `read_preferences` tool registration from `src/tools.ts`
- [x] 10.2 Remove `read_taste` tool registration from `src/tools.ts`
- [x] 10.3 Remove `read_diet_principles` tool registration from `src/tools.ts`
- [x] 10.4 Remove `read_kitchen` tool registration from `src/tools.ts`
- [x] 10.5 Remove `read_staples` tool registration from `src/tools.ts` (and update `src/staples.ts` if it owns the registration)

## 11. Cross-tenant overlay for read_recipe_notes

- [x] 11.1 Update `read_recipe_notes` in `src/notes-tools.ts`: enumerate `tenant:*` keys from `TENANT_KV` to get all tenant IDs, read the `overlay` field from each `profile:<username>` KV bundle, aggregate non-null ratings for the requested slug — replace the GitHub `users/*/overlay.toml` fan-out

## 12. Revoke workflow

- [x] 12.1 Update `.github/workflows/data-revoke.yml` (and `data-revoke.yml` in the code repo): after removing TENANT_KV entries, also delete `profile:<username>` and `state:<username>:pantry`, `state:<username>:meal_plan`, `state:<username>:grocery_list` from `DATA_KV`

## 13. AGENT_INSTRUCTIONS and docs

- [x] 13.1 Update `AGENT_INSTRUCTIONS.md` meal-plan pre-pass batch: replace `read_preferences()`, `read_taste()`, `read_diet_principles()`, `read_staples()`, `read_kitchen()` with a single `read_user_profile()` call
- [x] 13.2 Update `AGENT_INSTRUCTIONS.md` `configure-grocery-profile` skill: use `read_user_profile()` for reading current state instead of individual read tools
- [x] 13.3 Update `docs/TOOLS.md`: remove `read_preferences`, `read_taste`, `read_diet_principles`, `read_kitchen`, `read_staples` entries; add `read_user_profile` entry; update `commit_changes` to remove the dropped ops fields; note KV-backed return shapes (no `commit_sha` on profile/pantry/grocery/meal-plan writes)
- [x] 13.4 Update `docs/ARCHITECTURE.md`: update per-tenant data model section — `users/<username>/` retains only `cooking_log.toml`, `notes/`, `store_notes/`; describe `profile:<username>` and `state:<username>:*` KV keys; update DATA_KV description
- [x] 13.5 Update `docs/SCHEMAS.md`: remove per-tenant file schemas for files that move to KV (`pantry.toml`, `meal_plan.toml`, `grocery_list.toml`, `overlay.toml`, etc.); add KV key schema descriptions; retain `cooking_log.toml`, `notes/`, `store_notes/` schemas unchanged

## 14. Migration runner

- [x] 14.1 Create `migrations/0001-unified-user-profile-kv.mjs`: exports `id` (the migration name) and `up({ kv, dataRoot, log })`. Reads `users/` in the data repo checkout, enumerates tenant directories, reads each profile file (preferences.toml, taste.md, diet_principles.md, kitchen.toml, staples.toml, overlay.toml, ready_to_eat.toml, stockup.toml) and session state files (pantry.toml, meal_plan.toml, grocery_list.toml), coerces pantry/meal_plan/grocery_list from TOML arrays to JSON, writes `profile:<username>` bundle and three `state:<username>:*` keys to DATA_KV via the CF REST API. Skip any tenant whose `profile:<username>` key already exists (idempotent check before write).
- [x] 14.2 Create `scripts/run-migrations.mjs`: factors out the CF REST KV client from `build-indexes.mjs`'s `publishToKv` (or calls it as a shared helper); reads `migrations:applied` ledger from DATA_KV (absent → treat as `[]`); imports each `migrations/*.mjs` in filename order; runs any whose `id` is not in the ledger (injecting `{ kv, dataRoot, log }`); appends the id to the ledger after each success. Gracefully skips with a warning when DATA_KV namespace id is absent from the operator's `wrangler.jsonc` (brand-new operator pre-first-deploy).
- [x] 14.3 Add "Run migrations" step to `.github/workflows/data-deploy.yml`: `node _code/scripts/run-migrations.mjs --root .` inserted **after** the Deploy step and **before** "Publish indexes to DATA_KV"; pass `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` env vars same as the build-indexes step.
