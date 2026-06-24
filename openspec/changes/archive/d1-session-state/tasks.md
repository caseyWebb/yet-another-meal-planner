## 1. Schema + backfill

- [x] 1.1 Add `migrations/d1/0005_session_state.sql`: `pantry`, `meal_plan`, `grocery_list` tables + the status/category indexes.
- [x] 1.2 Add `migrations/0004-session-state-d1.mjs`: per tenant, read `state:<u>:pantry|meal_plan|grocery_list`, insert rows, `kv.delete` the keys. Idempotent.
- [x] 1.3 Test the backfill (arrays → rows; re-run no-ops; KV keys removed).

## 2. Pantry → D1

- [x] 2.1 `read_pantry`: `SELECT … WHERE tenant=?` with optional `category`/`prepared` `WHERE` clauses.
- [x] 2.2 `update_pantry` / `mark_pantry_verified`: add = `INSERT … ON CONFLICT DO UPDATE` (merge rule: keep `added_at`, refresh `last_verified_at`, overlay rest, `merged:true` on conflict); remove/verify = row statements. Port `applyPantryOperations` to row ops.

## 3. Meal plan → D1

- [x] 3.1 `read_meal_plan`: `SELECT … WHERE tenant=?`.
- [x] 3.2 `update_meal_plan`: add = upsert by `recipe` (with `sides`); remove = `DELETE`. Port `applyMealPlanOps`.
- [x] 3.3 `log_cooked` (slice 2): combine the cooking-log INSERT and the `meal_plan` delete into one D1 `batch` (transactional clear).

## 4. Grocery list → D1

- [x] 4.1 `read_grocery_list`: `SELECT … WHERE tenant=?`, status filter as `WHERE status=?`.
- [x] 4.2 `add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list`: row upsert/update/delete (dedup by normalized name). Port the grocery logic in `src/grocery-tools.ts` / `src/grocery.ts`.
- [x] 4.3 Order/cart flows: confirm `place_order` and the in-store walk transition `grocery_list.status` via D1 row updates (inventory their call sites).

## 5. Retire the KV session layer

- [x] 5.1 Remove the `state:*` helpers from `src/user-kv.ts`; delete the file if empty (profile helpers went in slice 4).
- [x] 5.2 `src/env.ts`: update the `DATA_KV` doc — no domain data remains; mark the binding removable (follow-up).
- [x] 5.3 Grep `src/**`/`test/**` for `state:` / `getPantryState` / `getMealPlanState` / `getGroceryListState` and clean up.

## 6. Docs + agent

- [x] 6.1 `docs/SCHEMAS.md`: session-state D1 tables (replace the JSON-array descriptions).
- [x] 6.2 `docs/ARCHITECTURE.md`: `DATA_KV` now empty/removable; per-tenant state fully D1.
- [x] 6.3 `AGENT_INSTRUCTIONS.md`: drop the "never fire parallel writes at the same file (full-file overwrite)" caution for session state (D1 rows don't whole-file-overwrite). Rebuild the plugin.

## 7. Verify

- [x] 7.1 `npm run typecheck` + `npm test` green (D1 read/write paths, pantry merge, transactional log_cooked clear, backfill).
- [ ] 7.2 Manual: backfill; add/remove items hit single rows; status/category filters query; `log_cooked` clears the plan atomically. (NOT DONE — needs live Cloudflare/D1; covered by fake-D1 unit tests instead. Flagged for the operator's deploy-time smoke.)
