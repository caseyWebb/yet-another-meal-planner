## Why

Roadmap slice 2 of `cloudflare-storage-architecture` (absorbs `finish-kv-migration`). The cooking log is the last per-tenant *volatile* artifact still in GitHub (`users/<username>/cooking_log.toml`) and the single strongest case for D1: it is an **event log** consumed by aggregation. `retrospective` (real protein/cuisine mixes over a window) and `last_cooked` (latest cooked date per recipe) are JS loops over a parsed TOML array today; in D1 they are one `GROUP BY` and one `MAX(date) GROUP BY recipe` — and `retrospective` becomes a **JOIN onto slice 1's `recipes` table** to pull each cooked recipe's protein/cuisine.

This is also the first **authored-data** slice: unlike the derived recipe index, the cooking log has real history, so it needs a one-time **data backfill** (`migrations/*.mjs` via the foundation's `.mjs` runner with the `d1` client) — exercising the foundation's second migration track end to end.

And it unlocks the validation bonus: `validateNewEntry` is structural-only today because "the Worker has no corpus access on workerd." With recipes in D1 (slice 1), the new `log_cooked` tool resolves recipe slugs against the `recipes` table **at write time** — validation moves from the build to the moment of writing, the same upgrade pantry/meal_plan/ready_to_eat already got.

## What Changes

- **NEW** schema `migrations/d1/0003_cooking_log.sql` — `cooking_log(id, tenant, date, type, recipe, name, protein, cuisine)` with indexes on `(tenant, date)` and `(tenant, recipe)`. Per-tenant rows; one per cooking event.
- **NEW** data backfill `migrations/0002-cooking-log-d1.mjs` — read each `users/<username>/cooking_log.toml` from the data-repo checkout, parse, and INSERT rows into D1 via the `d1` client. Idempotent (delete-then-insert per tenant), ledgered in `migrations:applied`.
- **NEW** `log_cooked` tool — append a cooking event: validate (ISO date; type ∈ `recipe|ready_to_eat|ad_hoc`; a `recipe` entry's slug **must exist in the D1 `recipes` table**), INSERT the row, and clear any cooked recipes from the KV meal plan (the side effect `commit_changes` performs today). Per-tenant; no git commit.
- **BREAKING** `commit_changes` drops `cooking_log_entries` — its backing GitHub file no longer exists. Cooking events are logged via `log_cooked`. (`commit_changes` itself is deleted in slice 3; this slice removes only the now-orphaned field.)
- Read sites move GitHub→D1:
  - `getLastCookedMap` (`src/tools.ts`, feeding `list_recipes` + `read_recipe` overlay merge) → `SELECT recipe, MAX(date) … WHERE tenant=? AND type='recipe' GROUP BY recipe`.
  - `retrospective` (`src/cooking-tools.ts`) → `SELECT … FROM cooking_log LEFT JOIN recipes … WHERE tenant=? AND date>=?`, aggregated; the recipe protein/cuisine come from the JOIN, inline dims from the row.
- `scripts/build-indexes.mjs`: drop `validateCookingArtifacts` (the log isn't in GitHub anymore); `src/validate.ts`: drop the `cooking_log.toml` write-time path. Validation is now `log_cooked`'s job, with real slug resolution.
- `src/cooking-log.ts`: keep `CookingLogEntry`, `COOKING_LOG_TYPES`, `validateNewEntry` (structural, used by `log_cooked`); remove the now-dead `entriesOf`/`deriveLastCooked`/`appendEntries`/`coerceEntry` (replaced by SQL / the backfill's own parsing).
- The `users/<username>/cooking_log.toml` files become vestigial post-backfill (the runner doesn't delete git files); flagged for a later cleanup, not removed here.

## Capabilities

### Modified Capabilities

- `cooking-history`: the cooking log is stored in and served from D1; `last_cooked` and `retrospective` are SQL aggregations (the latter joining the `recipes` table); new entries are validated at write time with real slug resolution.
- `data-write-tools`: new `log_cooked` tool (KV/D1-backed, no commit); `commit_changes` drops `cooking_log_entries`.

## Impact

- New `migrations/d1/0003_cooking_log.sql`, `migrations/0002-cooking-log-d1.mjs`.
- `src/tools.ts` (getLastCookedMap → D1), `src/cooking-tools.ts` (retrospective → D1 JOIN), `src/write-tools.ts` (add `log_cooked`; remove `cooking_log_entries` from `commit_changes`; remove `buildCookingLogUpdate`), `src/cooking-log.ts` (trim dead helpers), `src/validate.ts` (drop cooking_log path), `scripts/build-indexes.mjs` (drop `validateCookingArtifacts`).
- `docs/SCHEMAS.md` (cooking_log D1 table; remove the TOML schema), `docs/ARCHITECTURE.md` (cooking log now D1; the last per-tenant GitHub artifact is gone), `docs/TOOLS.md` (`log_cooked`; `commit_changes` loses `cooking_log_entries`).
- `AGENT_INSTRUCTIONS.md` + plugin rebuild: cooking/meal-plan flows call `log_cooked` instead of `commit_changes`' `cooking_log_entries`.

## Depends On

- `d1-foundation` (D1 binding, `db.ts`, `.mjs` runner with `d1` client).
- `d1-recipe-index` (the `recipes` table — required for write-time slug validation and the `retrospective` JOIN).
