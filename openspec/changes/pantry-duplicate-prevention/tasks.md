## 1. Core Logic — `src/pantry-write.ts`

- [ ] 1.1 Add `merged?: boolean` to the `AppliedOp` interface
- [ ] 1.2 In the `add` branch of `applyPantryOperations`, look up the existing item index using `matches()` before pushing
- [ ] 1.3 If a match is found: spread the incoming `op.item` fields over the existing entry, force `name` and `last_verified_at = today`, preserve the original `added_at`, and push `{ op: "add", name, merged: true }` to `applied`
- [ ] 1.4 If no match: keep the current insert path unchanged (push new entry, push `{ op: "add", name }` to `applied`)

## 2. Tool Description — `src/write-tools.ts`

- [ ] 2.1 Update the `update_pantry` tool `description` string to document upsert semantics (mirrors the grocery list: "re-adding an existing name merges into it rather than duplicating")

## 3. Tests — `test/write-tools.test.ts`

- [ ] 3.1 Add a test: `add` for a name not in the pantry inserts a new entry (no `merged` flag)
- [ ] 3.2 Add a test: `add` for a name already in the pantry merges incoming fields, preserves `added_at`, refreshes `last_verified_at`, returns `merged: true`, and produces no duplicate row
- [ ] 3.3 Add a test: `add` is case-insensitive ("Olive Oil" matches "olive oil" → merge, not duplicate)
