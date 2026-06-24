## Context

Pantry, meal plan, and grocery list are per-tenant working state, mutated many times per session and read independently. They were moved to KV (`state:<username>:*`) as JSON arrays by `unified-user-profile-kv`. Each mutation reads the whole array, edits it, and writes it back — the pattern KV is least suited to: eventual consistency can serve a stale array to the next turn's read-modify-write, and two writes to one key clobber. The AGENT_INSTRUCTIONS even carries a caution about "never fire parallel writes at the same file (full-file overwrite)" — a workaround for exactly this. D1 rows remove the failure mode.

## Goals / Non-Goals

**Goals:**
- Session state in D1 row tables; add/remove/verify/upsert as single-row statements; filters as `WHERE`.
- Strong read-after-write consistency; no whole-array rewrite.
- `log_cooked`'s meal-plan clear transactional with the cooking-log insert.
- Empty out `DATA_KV` of domain data.

**Non-Goals:**
- Removing the `DATA_KV` binding (a follow-up wrangler cleanup; out of scope so this slice carries no deploy-config risk).
- Changing tool input/output shapes (same results, D1-backed).

## Decisions

### Decision: tables mirror the item shapes, keyed for upsert

```sql
CREATE TABLE pantry (
  tenant TEXT, name TEXT, normalized_name TEXT, quantity TEXT, category TEXT,
  prepared_from TEXT, added_at TEXT, last_verified_at TEXT,
  PRIMARY KEY (tenant, normalized_name)
);
CREATE TABLE meal_plan (
  tenant TEXT, recipe TEXT, planned_for TEXT, sides TEXT /*json*/,
  PRIMARY KEY (tenant, recipe)
);
CREATE TABLE grocery_list (
  tenant TEXT, name TEXT, normalized_name TEXT, quantity TEXT, kind TEXT, domain TEXT,
  status TEXT, source TEXT, for_recipes TEXT /*json*/, note TEXT, added_at TEXT, ordered_at TEXT,
  PRIMARY KEY (tenant, normalized_name)
);
CREATE INDEX idx_grocery_status ON grocery_list(tenant, status);
CREATE INDEX idx_pantry_category ON pantry(tenant, category);
```

**Rationale:** the existing dedup/upsert semantics are keyed by normalized name (pantry, grocery) or recipe slug (meal plan), so those are the primary keys — an `add` is `INSERT … ON CONFLICT DO UPDATE`, exactly the pantry merge rule (keep `added_at`, refresh `last_verified_at`, overlay the rest). `sides` and `for_recipes` are small open lists → JSON columns. Status/category indexes back the existing filters.

### Decision: `log_cooked` clear becomes one transaction

With `cooking_log` (slice 2) and `meal_plan` both in D1, `log_cooked` runs the cooking-log INSERT and the `DELETE FROM meal_plan WHERE tenant=? AND recipe=?` in a single `batch` — atomic, removing the slice-2 cross-store seam. This is the concrete payoff of co-locating per-tenant state in one store.

### Decision: backfill then delete the KV keys; retire `user-kv.ts`

`migrations/0004-session-state-d1.mjs`: per tenant, read the three `state:*` arrays, insert rows, `kv.delete` the keys. Idempotent (delete-then-insert per tenant; absent keys → already migrated). After the tools move, `src/user-kv.ts` has no remaining exports (profile helpers went in slice 4) → delete the file. `DATA_KV` now holds nothing; flag the binding for a later removal (kept bound this slice to avoid a deploy-config change mid-migration).

## Risks / Open Questions

- **`DATA_KV` removal timing.** Left bound (empty) here; removing the binding is a separate wrangler/operator-config change (and the merge/pin machinery would need to drop a binding, which it doesn't do today — it only adds). Tracked as a cleanup, not blocking.
- **Order vs. cart flows.** `place_order` and the in-store walk transition grocery-list item status; confirm those write paths move to D1 row updates here too (they read/write the same `grocery_list`). Inventory their call sites during implementation.
