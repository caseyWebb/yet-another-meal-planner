## Why

A weekly menu capture is one decision that mutates 4–5 files at once (meal plan, pantry verifications, recipe content, and the to-buy grocery items), and the grocery items carry `for_recipes` pointers at the very recipes being planned in the same breath. `commit_changes` already batches every other repo-write domain into one atomic commit — but it has **no grocery-list field**, so the one most multi-item, most cross-referential moment in the system can't be captured atomically. AGENT_INSTRUCTIONS.md:95 already instructs the agent to persist "the to-buy items added to the grocery list" inside that single `commit_changes` call — a documented contract the tool cannot currently honor. The agent is left to either spray N single-item `add_to_grocery_list` commits or silently drop the grocery items from the batch.

The single-item tools can't be safely parallelized to compensate: every grocery-list write is a full-file read-modify-write of the same `grocery_list.toml`, and the commit engine resolves a write-race by replaying precomputed full-file content onto the new base — so concurrent same-file writes lose updates. Batching is the only race-free shape for multiple mutations to one file.

## What Changes

- Add a **`grocery_list_ops`** array field to `commit_changes` (`op: add | update | remove`), mirroring the existing `meal_plan_ops` / `pantry_operations` idiom, so a whole menu (grocery items + planned recipes + pantry verifications) lands as **one atomic commit**, and a whole receive (batch removes + pantry restock) lands as one.
- Add a `buildGroceryListUpdate(gh, path, ops)` builder returning `{ file, applied, conflicts }` — the same partial-apply + conflict-report shape as `buildMealPlanUpdate` / `buildPantryUpdate` — reusing the existing pure `addToGroceryList` / `updateGroceryItem` / `removeGroceryItem` functions folded over one loaded list.
- Keep the three single-item tools (`add_to_grocery_list`, `update_grocery_list`, `remove_from_grocery_list`) for genuine one-off live edits; this makes grocery-list conform to the same granular-tool-plus-batch-field pattern every other writable domain already follows.
- Add a standing behavioral rule to AGENT_INSTRUCTIONS.md: when resolving a turn produces more than one repo write, persist them in **one** `commit_changes` — never a sequence of granular writes, and **never parallel writes to the same file** (they full-file-clobber each other). Reframe `commit_changes`' own description from a git-log nicety to the default for any multi-write turn.
- Rewrite the receive steps (place-grocery-order and store-walk completion), which today instruct an explicit per-item `remove_from_grocery_list` loop plus `update_pantry`, into a single `commit_changes({ grocery_list_ops: [removes], pantry_operations: [restocks] })`.
- Update `docs/TOOLS.md` to document `grocery_list_ops`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `data-write-tools`: `commit_changes` gains a `grocery_list_ops` batch field; the atomic-batch requirement extends to grocery-list mutations.
- `grocery-list`: grocery-list mutations are batchable through `commit_changes`; multiple mutations in one turn SHALL be persisted as one commit rather than parallel single-item writes.

## Impact

- **Code**: `src/write-tools.ts` (`commit_changes` schema + handler), a new `buildGroceryListUpdate` (alongside the existing builders), reuse of `src/grocery.ts` pure functions. Tool-description text on `commit_changes`, `add_to_grocery_list`, `remove_from_grocery_list`.
- **Agent instructions**: `AGENT_INSTRUCTIONS.md` standing batch rule + receive-flow rewrites (regenerates the plugin skills via `npm run build:plugin`).
- **Docs**: `docs/TOOLS.md`.
- **Tests**: Worker unit tests for `grocery_list_ops` (add/update/remove, same-name merge within a batch, missing-name conflict reporting, one-commit assertion).
- **Deploy**: Worker change → trigger the operator data-repo `deploy.yml` after merge; rebuild the plugin bundle for the instruction changes.
- No breaking changes; the single-item tools and existing `commit_changes` fields are unchanged.
