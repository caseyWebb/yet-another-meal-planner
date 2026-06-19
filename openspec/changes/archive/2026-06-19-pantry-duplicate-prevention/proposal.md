## Why

Calling `update_pantry` (or `commit_changes` with `pantry_operations`) with an `add` op for an item that already exists silently appends a duplicate row instead of updating the existing one. The grocery list already handles this correctly (re-adding an existing name merges); the pantry should behave the same way.

## What Changes

- `add` ops in `applyPantryOperations` check for an existing item with the same name before appending
- If a match is found, the existing entry is updated in-place (overlay incoming fields, preserve `added_at`, refresh `last_verified_at` to today) — an upsert
- If no match is found, a new entry is appended as before
- `AppliedOp` gains an optional `merged` flag so callers can distinguish a fresh add from an upsert
- The `update_pantry` tool description is updated to document upsert semantics (matching the grocery list's existing description)
- New test cases cover the merge path

## Capabilities

### New Capabilities

_(none — this is a behaviour fix within an existing capability)_

### Modified Capabilities

- `data-write-tools`: The `add` pantry operation is now an upsert; the `AppliedOp` return type gains `merged?: boolean`.

## Impact

- `src/pantry-write.ts` — `applyPantryOperations` add-op branch and `AppliedOp` type
- `src/write-tools.ts` — `update_pantry` tool description string
- `test/write-tools.test.ts` — new test cases for the upsert / merge path
- No schema changes to `pantry.toml`; no breaking changes to callers (the `merged` field is additive)
