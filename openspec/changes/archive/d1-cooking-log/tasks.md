## 1. Schema + backfill

- [x] 1.1 Add `migrations/d1/0003_cooking_log.sql`: the `cooking_log` table + the `(tenant, date)` and `(tenant, recipe)` indexes.
- [x] 1.2 Add `migrations/0002-cooking-log-d1.mjs` (`up({ kv, d1, dataRoot, log })`): walk `users/*/cooking_log.toml`, parse (smol-toml), and per tenant `DELETE FROM cooking_log WHERE tenant=?` then batch-INSERT entries. Idempotent; no-op for tenants without a file.
- [x] 1.3 Test the backfill: a sample `users/<u>/cooking_log.toml` → rows; re-run is a no-op (delete-then-insert); a tenant with no file inserts nothing.

## 2. log_cooked tool

- [x] 2.1 Add `log_cooked` (in `src/write-tools.ts` or a new `src/cooking-write.ts`): schema `{ date?, type, recipe?, name?, protein?, cuisine? }`; validate via `validateNewEntry` + a `SELECT 1 FROM recipes WHERE slug=?` for recipe-type entries (`not_found` when absent); INSERT the row (tenant-scoped) via `src/db.ts`.
- [x] 2.2 Port the meal-plan-clear side effect: for a recipe entry, `applyMealPlanOps(remove slug)` on the KV meal plan (unchanged from `commit_changes`).
- [x] 2.3 Return `{ logged }` (no `commit_sha`); structured errors for bad date/type/slug.

## 3. commit_changes: drop cooking_log_entries

- [x] 3.1 Remove the `cooking_log_entries` field from the `commit_changes` schema + handler in `src/write-tools.ts`; remove `buildCookingLogUpdate` and its imports. Update the tool description (cooking events go through `log_cooked`).

## 4. Read sites → D1

- [x] 4.1 `src/tools.ts` `getLastCookedMap`: replace the GitHub `cooking_log.toml` read + `deriveLastCooked` with the `MAX(date) GROUP BY recipe` query (tenant-scoped). `list_recipes` + `read_recipe` overlay merge are otherwise unchanged.
- [x] 4.2 `src/cooking-tools.ts` `retrospective`: replace the GitHub read + JS aggregation with the `cooking_log LEFT JOIN recipes` query + COALESCE; keep the window/mix shaping (in JS or `GROUP BY` per metric).

## 5. Trim validation + dead code

- [x] 5.1 `scripts/build-indexes.mjs`: remove `validateCookingArtifacts` and its call in `run()`; drop the cooking-log parse from the orchestration.
- [x] 5.2 `src/validate.ts`: remove the `cooking_log.toml` branch (no GitHub-commit path writes it).
- [x] 5.3 `src/cooking-log.ts`: keep `CookingLogEntry`, `COOKING_LOG_TYPES`, `validateNewEntry`; remove `entriesOf`, `deriveLastCooked`, `appendEntries`, `coerceEntry`, `COOKING_LOG_PATH` if now unused. Update the file header.
- [x] 5.4 `src/overlay.ts`: update the comment that says `last_cooked` is derived from `cooking_log.toml` → derived from the D1 `cooking_log` table.

## 6. Docs + agent

- [x] 6.1 `docs/SCHEMAS.md`: replace the `cooking_log.toml` TOML schema with the `cooking_log` D1 table.
- [x] 6.2 `docs/ARCHITECTURE.md`: cooking log is D1; GitHub now holds no per-tenant volatile data (recipes-only corpus); note the vestigial `cooking_log.toml` cleanup follow-up.
- [x] 6.3 `docs/TOOLS.md`: add `log_cooked`; `commit_changes` loses `cooking_log_entries`.
- [x] 6.4 `AGENT_INSTRUCTIONS.md`: cooking/meal-plan flows call `log_cooked` (not `commit_changes` `cooking_log_entries`); `update_recipe`'s "append a cooking_log entry via commit_changes" note → via `log_cooked`. Rebuild the plugin (`npm run build:plugin`).

## 7. Verify

- [x] 7.1 `npm run typecheck` + `npm test` green (D1 read/write paths, log_cooked validation, backfill).
- [ ] 7.2 Manual: backfill populates `cooking_log`; `log_cooked` of a real slug logs + clears the meal plan; of an unknown slug → `not_found`; `list_recipes` shows correct `last_cooked`; `retrospective` returns correct mixes via the JOIN. — **LEFT UNCHECKED: requires live Cloudflare/D1** (none in this environment). These paths are covered against a fake `D1Database` in unit/tooling tests (`test/cooking-write.test.ts`, `test/cooking-tools.test.ts`, `tests/cooking-log-backfill.test.mjs`); the live round-trip is the deploy-time `wrangler d1 migrations apply` + `/health` probe.
