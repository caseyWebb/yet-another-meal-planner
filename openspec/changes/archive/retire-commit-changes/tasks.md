## 1. rate_recipe

- [x] 1.1 Add `rate_recipe` in `src/write-tools.ts`: schema `{ slug, rating?, status? }`; `SLUG_RE` + `SELECT 1 FROM recipes WHERE slug=?` (`not_found` when absent); `applyOverlayEdit(current, slug, { rating?, status? })`; persist the overlay (KV profile bundle this slice — `parseOverlay`/`serializeOverlay` + `updateProfileField`); return `{ slug, overlay }` with no `commit_sha`.
- [x] 1.2 Reject an empty edit (neither `rating` nor `status`) with a structured error.

## 2. update_recipe → objective-only

- [x] 2.1 Strip the overlay path from `update_recipe`: remove the `splitRecipeUpdate` call and the `applyOverlayEdit`/overlay-write block. If `updates` contains `rating` or `status`, return `validation_failed` directing the caller to `rate_recipe`. Keep the `last_cooked` rejection.
- [x] 2.2 Update the `update_recipe` description: objective shared content only; rating/status via `rate_recipe`; cooking via `log_cooked`; (drop the "for batching, use commit_changes" line).
- [x] 2.3 Remove `splitRecipeUpdate` if now unused (or reduce to the objective-only filter it still needs).

## 3. Delete commit_changes

- [x] 3.1 Remove the `commit_changes` tool registration + handler from `src/write-tools.ts` and any now-dead imports/helpers (e.g. `buildRecipeUpdate` stays for `update_recipe`; remove batch-only glue).
- [x] 3.2 Grep `src/**` and `tests/**` for `commit_changes` / `config_updates` / `recipe_updates` references and clean up.

## 4. Agent surface

- [x] 4.1 `AGENT_INSTRUCTIONS.md`: rewrite the 9 `commit_changes` sites —
  - "Persist multi-write turns in one commit" principle → granular KV/D1 tools; narrow the full-file-overwrite caution to the KV session blobs only.
  - Cooked flow → `log_cooked`.
  - Recipe activation/rating (`recipe_updates: [{ status }]`) → one `rate_recipe` per slug.
  - Draft imports / `pairs_with` → `create_recipe` / `update_recipe`.
  - Received flows (`grocery_list_ops` + `pantry_operations`) → `update_grocery_list` + `update_pantry` (fixes pre-existing drift).
- [x] 4.2 `npm run build:plugin`; commit the regenerated `plugin/` bundle.

## 5. Docs

- [x] 5.1 `docs/TOOLS.md`: remove `commit_changes`; add `rate_recipe`; `update_recipe` objective-only.

## 6. Tests + verify

- [x] 6.1 `test/write-tools.test.ts`: drop `commit_changes` tests; add `rate_recipe` (slug validation, overlay write, empty-edit rejection); assert `update_recipe` rejects `rating`/`status`.
- [x] 6.2 `npm run typecheck` + `npm test` green; manual: `rate_recipe` updates the overlay and shows in `list_recipes`; `update_recipe` with `status` errors toward `rate_recipe`; no `commit_changes` in the tool list. (The three behaviors are covered by automated tests in `test/write-tools.test.ts` — `rate_recipe` overlay write, `update_recipe` status→`rate_recipe` rejection, and `commit_changes` no longer registered. The live-deployment `list_recipes`/tool-list check needs a deployed Worker + D1 and was not run in this environment.)
