## Context

`applyPantryOperations` in `src/pantry-write.ts` processes batched `add`/`remove`/`verify` ops against the live pantry item list. The `add` branch currently appends unconditionally — there is no guard against an item with the same name already existing.

The grocery list solved this identically in `src/grocery.ts` (`addToGroceryList`): before inserting, it looks up the normalized name; if found, it merges the incoming fields onto the existing entry and returns `merged: true`. The pantry `add` should follow the same pattern.

## Goals / Non-Goals

**Goals:**
- `add` ops in `applyPantryOperations` become idempotent: re-adding an existing name merges rather than duplicates
- `AppliedOp` reports `merged: true` so callers (agent, tests) can distinguish upsert from insert
- `update_pantry` tool description reflects upsert semantics
- Test coverage for the merge path

**Non-Goals:**
- De-duplicating entries already in the file (no retroactive cleanup)
- Changing `remove` or `verify` semantics
- Altering the `pantry.toml` schema

## Decisions

### Merge strategy: overlay incoming fields, preserve `added_at`, refresh `last_verified_at`

When a matching entry exists, the new `item` fields are spread over the existing entry — updating `quantity`, `category`, `prepared_from`, etc. as supplied — but `added_at` is kept from the original (it records when the item first entered the pantry, which is historically meaningful). `last_verified_at` is set to today, because re-adding an existing item is semantically equivalent to confirming it's there.

This mirrors the grocery list merge: incoming fields win, stable metadata (like `added_at`) is preserved.

**Alternative considered:** treat duplicate-add as a conflict and report it back to the agent. Rejected — it adds round-trip friction for the common case (agent adds groceries after restocking) and gives the agent an extra failure to recover from. Silent upsert is the right default; the `merged` flag on the result is sufficient transparency.

### Match on `name` using the existing `matches()` helper (case-insensitive)

The existing `matches()` function already does case-insensitive string comparison. Using it keeps the duplicate check consistent with `remove` and `verify`.

### `AppliedOp.merged` is optional (`merged?: boolean`)

Additive, non-breaking. Fresh adds omit the field; upserts set it to `true`. Callers that don't inspect it see no difference.

## Risks / Trade-offs

**Existing duplicates in the file are not cleaned up** → Mitigation: the fix prevents new duplicates. Existing duplicates (if any) are a one-time data concern; they can be cleaned manually if needed.

**Merge could silently discard a deliberate multi-pack entry** → In practice, pantry items are not meant to have two rows for the same name. If a user explicitly wants two separate entries (e.g., two different prepared batches), they should use distinct names (e.g., `cooked rice - batch 1`). The upsert behaviour is consistent with the grocery list stance.
