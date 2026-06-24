## Context

`cooking_log.toml` is per-tenant, append-only, and consumed only by aggregation: `deriveLastCooked` (max date per recipe slug) feeds the `last_cooked` merged onto recipe reads, and `retrospective` aggregates protein/cuisine mixes over a window. The pure helpers in `src/cooking-log.ts` already operate on an entries array — the TOML is just `[[entries]]` wrapping — so the data shape maps to rows almost unchanged. The only reason its write-time validation is structural-only is the stale "no corpus access on workerd" constraint, which slice 1 (recipes in D1) dissolves.

## Goals / Non-Goals

**Goals:**
- Cooking log in a per-tenant D1 table; `last_cooked` and `retrospective` as SQL (the latter joining `recipes`).
- A `log_cooked` writer with real write-time slug validation against `recipes`.
- The first data-backfill migration, proving the foundation's `.mjs`+`d1` track.
- GitHub holds no per-tenant volatile data after this slice.

**Non-Goals:**
- Deleting `commit_changes` (slice 3) — this slice only removes its orphaned `cooking_log_entries` field.
- The `update_recipe`-vs-`rate_recipe` decision (slice 3).
- Moving the meal plan to D1 (slice 5) — `log_cooked`'s meal-plan-clear still writes KV for now.
- Deleting the vestigial `users/<username>/cooking_log.toml` files (later cleanup).

## Decisions

### Decision: schema

```sql
CREATE TABLE cooking_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant  TEXT NOT NULL,
  date    TEXT NOT NULL,        -- YYYY-MM-DD
  type    TEXT NOT NULL,        -- recipe | ready_to_eat | ad_hoc
  recipe  TEXT,                 -- slug, when type = recipe
  name    TEXT,                 -- dish name, when ready_to_eat | ad_hoc
  protein TEXT,                 -- optional inline dimension (non-recipe entries)
  cuisine TEXT
);
CREATE INDEX idx_cooking_log_tenant_date   ON cooking_log(tenant, date);
CREATE INDEX idx_cooking_log_tenant_recipe ON cooking_log(tenant, recipe);
```

One row per event; `recipe` is a soft reference to `recipes.slug` (no FK constraint — a recipe can be archived/removed while its history remains, the same history-preserving stance the validator has today). Append-only in practice; `id` gives a stable handle for an admin UI to edit/delete a mis-logged entry.

### Decision: the aggregations

```
  last_cooked   SELECT recipe, MAX(date) AS last_cooked
                FROM cooking_log
                WHERE tenant = ?1 AND type = 'recipe' AND recipe IS NOT NULL
                GROUP BY recipe;

  retrospective SELECT cl.type, cl.date, cl.name,
                       COALESCE(cl.protein, r.protein) AS protein,
                       COALESCE(cl.cuisine, r.cuisine) AS cuisine
                FROM cooking_log cl
                LEFT JOIN recipes r ON cl.recipe = r.slug
                WHERE cl.tenant = ?1 AND cl.date >= ?2;
```

`retrospective`'s protein/cuisine resolution — inline dims for non-recipe entries, the recipe's own dims for recipe entries — is exactly a `LEFT JOIN` + `COALESCE`. This is the JOIN that only became possible once the recipe index moved to D1 (slice 1); doing it in JS today requires loading the whole index blob and zipping it against the parsed log. The window/aggregation shaping (counts, "behind on fish") stays in JS over the query result, or moves to `GROUP BY` where it's a clean fit — implementer's call per metric.

### Decision: `log_cooked` validates against `recipes` at write time

```
  log_cooked({ date?, type, recipe?, name?, protein?, cuisine? })
    1. date := date ?? today();  require ISO YYYY-MM-DD
    2. type ∈ {recipe, ready_to_eat, ad_hoc}
    3. if type = recipe:  require recipe; SELECT 1 FROM recipes WHERE slug = ?  → else not_found
       else:              require name
    4. INSERT the row (tenant scoped)
    5. if type = recipe:  clear that slug from the KV meal plan (applyMealPlanOps remove)
```

Step 3 is the upgrade: structural validation **plus** real slug resolution, at write time, because the corpus is now queryable from the Worker. `last_cooked` is never written — it remains derived (now by the SQL above), so a `log_cooked` recipe entry implicitly updates the recipe's effective `last_cooked` with no second write. The meal-plan clear (step 5) preserves the behavior `commit_changes` had; it still targets KV until slice 5.

### Decision: backfill is delete-then-insert per tenant

`migrations/0002-cooking-log-d1.mjs` `up({ kv, d1, dataRoot, log })`: list `users/*/`, parse each `cooking_log.toml` (smol-toml), and for each tenant `DELETE FROM cooking_log WHERE tenant = ?` then batch-INSERT its entries. Delete-then-insert makes the body idempotent independent of the ledger (covers the "ran but ledger write failed" edge). The runner ledgers the id in `migrations:applied` so it normally runs once. A tenant with no file contributes nothing.

**Ordering:** runs after `wrangler d1 migrations apply` (so `cooking_log` exists) — already guaranteed by the foundation's deploy step ordering. The recipe index (slice 1) need not be populated for the backfill itself (it inserts rows verbatim; slug *validation* is a write-time `log_cooked` concern, not a backfill one — historical entries are migrated as-is, even if a slug was later removed).

### Decision: validation moves off the build

`validateCookingArtifacts` (build) and the `cooking_log.toml` branch in `src/validate.ts` are removed — the log isn't in GitHub, so neither the build nor a GitHub-commit path sees it. The structural checks live on in `validateNewEntry` (reused by `log_cooked`); the slug-resolution check that the build uniquely did is now a write-time `recipes` lookup. Net: the same guarantees, applied earlier and per-write.

## Risks / Open Questions

- **Cross-store write in `log_cooked`** (D1 cooking_log + KV meal plan) is not transactional across stores. Same non-atomicity `commit_changes` had (GitHub commit + KV meal-plan clear); acceptable at single-user scale. Resolves naturally when the meal plan joins D1 (slice 5) and both writes become one D1 transaction.
- **Vestigial `cooking_log.toml` files** remain in git post-backfill (the runner can't commit deletions). Note in `ARCHITECTURE.md`; a follow-up cleanup removes them. They are inert (nothing reads or writes them).
- **`retrospective` aggregation placement** — how much moves into `GROUP BY` vs. stays JS — is per-metric and left to implementation; the JOIN + COALESCE base query is the fixed part.
