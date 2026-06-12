## 1. Builder

- [x] 1.1 Add `buildGroceryListUpdate(gh, path, ops)` (alongside `buildMealPlanUpdate` / `buildPantryUpdate`) that loads the caller's grocery list once, folds the ops over it via the existing `addToGroceryList` / `updateGroceryItem` / `removeGroceryItem` pure functions, and returns `{ file, applied, conflicts }`.
- [x] 1.2 Apply ops in array order so a later op (e.g. `update`/`remove`) sees the effect of an earlier op on the same name; merge same-name `add`s via the existing merge semantics.
- [x] 1.3 Report an `update`/`remove` for a missing name as a `conflict` (do not throw); resolve the path under the caller's `users/<username>/grocery_list.toml`.

## 2. commit_changes wiring

- [x] 2.1 Add the `grocery_list_ops` field to the `commit_changes` input schema: array of `{ op: "add" | "update" | "remove", item?, name? }`, mirroring `pantry_operations`.
- [x] 2.2 In the handler, when `grocery_list_ops` is non-empty, call `buildGroceryListUpdate`, push its `file` to the commit's `files[]`, and add `{ applied, conflicts }` to the result `summary.grocery_list`.
- [x] 2.3 Reframe the `commit_changes` description: it is the default for any turn with more than one repo write (not just a git-log nicety); document `grocery_list_ops`.

## 3. Tests

- [x] 3.1 Unit test: `grocery_list_ops` with add/update/remove persists in one commit and returns the per-op `applied`/`conflicts` summary.
- [x] 3.2 Unit test: two `add`s for the same name within one batch merge (no duplicate); an `add` then `update` for the same name applies in order.
- [x] 3.3 Unit test: a `remove`/`update` for a missing name is reported as a conflict and the remaining ops + other batch domains still commit.
- [x] 3.4 Unit test: a menu-shaped `commit_changes` (`grocery_list_ops` + `meal_plan_ops` + `pantry_operations`) yields a single commit covering all three files.

## 4. Agent instructions + docs

- [x] 4.1 Add the standing rule to `AGENT_INSTRUCTIONS.md` (near "The grocery list and the cart"): more than one repo write in a turn → one `commit_changes`; never parallel writes to the same file.
- [x] 4.2 Update menu capture (step 7) to name `grocery_list_ops` as the field carrying the to-buy items in the single `commit_changes` call.
- [x] 4.3 Rewrite the receive steps in place-grocery-order and store-walk: replace the per-item `remove_from_grocery_list` loop + `update_pantry` with one `commit_changes({ grocery_list_ops: [removes], pantry_operations: [restocks] })`.
- [x] 4.4 Update `docs/TOOLS.md` to document `grocery_list_ops` on `commit_changes`.
- [x] 4.5 Rebuild the plugin bundle (`npm run build:plugin`) so the regenerated skills carry the instruction changes.

## 5. Verify + ship

- [x] 5.1 `npm run typecheck` and `npm test` green.
- [ ] 5.2 Merge to `main`, then trigger the operator data-repo `deploy.yml` to deploy the Worker.
