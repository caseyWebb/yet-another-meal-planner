## Why

Roadmap slice 5 of `cloudflare-storage-architecture`. The session-state keys — `state:<username>:pantry`, `state:<username>:meal_plan`, `state:<username>:grocery_list` — are the most heavily mutated per-tenant data (every add/remove rewrites the whole JSON array in KV) and the worst fit for eventually-consistent, whole-blob KV: a read-modify-write that re-reads a just-written value can see stale data, and concurrent writes to the same key silently clobber. Moving them to D1 row tables gives strong read-after-write consistency, row-level partial updates (no whole-array rewrite), and admin visibility.

It also closes the cross-store seam slice 2 opened: `log_cooked` clears cooked recipes from the meal plan; with both the cooking log and the meal plan in D1, that becomes **one D1 transaction** instead of a non-atomic D1+KV pair.

After this slice, `DATA_KV` holds no domain data at all (index → D1 slice 1, profile → D1 slice 4, session state → here) and the binding becomes removable.

## What Changes

- **NEW** schema `migrations/d1/0005_session_state.sql`:
  - `pantry(tenant, name, normalized_name, quantity, category, prepared_from, added_at, last_verified_at, PK(tenant, normalized_name))` — upsert-by-name (preserving the existing merge semantics: keep `added_at`, refresh `last_verified_at`, overlay other fields).
  - `meal_plan(tenant, recipe, planned_for, sides /*json*/, PK(tenant, recipe))` — upsert-by-slug.
  - `grocery_list(tenant, name, normalized_name, quantity, kind, domain, status, source, for_recipes /*json*/, note, added_at, ordered_at, PK(tenant, normalized_name))`.
  - Indexes on `(tenant, status)` for the grocery list (active/in_cart/ordered/received filters) and `(tenant, category)` for pantry.
- **NEW** data backfill `migrations/0004-session-state-d1.mjs` — read each `state:<username>:*` JSON array, INSERT rows, delete the KV keys. Idempotent.
- **Tools → D1 rows**: `read_pantry`/`update_pantry`/`mark_pantry_verified`, `read_meal_plan`/`update_meal_plan`, `read_grocery_list`/`add_to_grocery_list`/`update_grocery_list`/`remove_from_grocery_list` read and mutate D1 rows. Add/remove/verify/upsert become single-row statements (or a small `batch`), not whole-array rewrites. Filters (`grocery_list` by status, `pantry` by category/prepared) become `WHERE` clauses.
- **`log_cooked` meal-plan clear becomes transactional**: the cooking-log INSERT and the meal-plan row delete run in one D1 `batch` (resolves the slice-2 cross-store note).
- **Delete the session-state KV layer**: the `state:*` helpers in `src/user-kv.ts` are removed (the file is now empty → delete it). `DATA_KV` no longer holds domain data; note it as removable (binding removal is a follow-up wrangler cleanup).

## Capabilities

### Modified Capabilities

- `grocery-list`: stored in and served from the D1 `grocery_list` table; status filters are queries; writes are row-level.
- `meal-planning`: the meal plan is the D1 `meal_plan` table; `log_cooked`'s clear is transactional with the cooking-log write.
- `data-write-tools` / `data-read-tools`: pantry read/write target D1; session writes are partial-row, strongly consistent.

## Impact

- New `migrations/d1/0005_session_state.sql`, `migrations/0004-session-state-d1.mjs`.
- `src/tools.ts` (read_pantry/meal_plan/grocery_list → D1), `src/write-tools.ts` (pantry), `src/pantry-write.ts`, `src/grocery-tools.ts`, `src/meal-plan.ts` (row logic), `src/write-tools.ts` `log_cooked` (transactional clear), `src/user-kv.ts` (delete).
- `docs/SCHEMAS.md` (session-state D1 tables), `docs/ARCHITECTURE.md` (DATA_KV now empty/removable), `src/env.ts` (DATA_KV doc / removal note).
- `AGENT_INSTRUCTIONS.md`: drop the remaining "never fire parallel writes at the same file (full-file overwrite)" caution for session state — D1 row writes don't whole-file-overwrite. Rebuild the plugin.

## Depends On

- `d1-foundation` (rails). Pairs with `d1-cooking-log` (slice 2) to make `log_cooked`'s clear transactional.
