# Tasks

> BREAKING. Order matters only loosely (the migration and Worker should land together); persona + docs follow. Keep each step green: `npx tsc --noEmit`, `npx vitest run`, `npm run test:tooling`.

## 1. D1 migration (subtraction)

- [x] 1.1 New migration: `ALTER TABLE overlay` — add `reject INTEGER`; backfill `reject = 1 WHERE status = 'rejected'`; `DELETE FROM overlay WHERE status IN ('active','draft')` (neutral = no row); then drop the `status` and `rating` columns (SQLite: rebuild-table pattern if needed, or leave the columns inert if a drop is awkward — but the model stops reading them).
- [x] 1.2 Same for `ready_to_eat`: add `favorite`/`reject`, backfill `reject = 1 WHERE status='rejected'`, delete `draft`/`active` rows' status, drop `status` + `rating`.
- [x] 1.3 Confirm the migration is pure subtraction + reversible-by-re-add (values not recovered); document the irreversible visibility flip in the migration comment.

## 2. Overlay + ready-to-eat model (Worker)

- [x] 2.1 `src/overlay.ts`: `OverlayRow` = `{ favorite?, reject? }`; `mergeOverlay` drops `status`/`rating`, merges `favorite` + `reject`, neutral default (no effective-draft); `applyOverlayEdit` enforces favorite⊕reject mutual exclusion.
- [x] 2.2 `src/profile-db.ts`: `readOverlay`/`setOverlay` read/write `favorite` + `reject` (drop `status`/`rating`); ready-to-eat read/write loses `status`/`rating`, gains `favorite`/`reject`.
- [x] 2.3 Remove `DEFAULT_STATUS` and all effective-draft logic.

## 3. Disposition tools + gates (Worker)

- [x] 3.1 `src/write-tools.ts`: replace `set_recipe_status` with `toggle_reject(slug, reject)`; keep `toggle_favorite`; both enforce mutual exclusion; `SUBJECTIVE_KEYS` → `favorite`/`reject`.
- [x] 3.2 Collapse the ready-to-eat tools: `add_draft_ready_to_eat` adds available (no draft/active); `update_ready_to_eat` sets favorite/reject (drop status/rating).
- [x] 3.3 `src/recipes.ts` `filterRecipes`: replace the `status` filter with a `NOT reject` hard gate; default returns all non-rejected. Single shared predicate.
- [x] 3.4 `src/tools.ts`: `list_recipes` (no status filter; surfaces favorite, never status/rating) and `recipe_semantic_search` both exclude the caller's rejects via the shared gate.
- [x] 3.5 `src/discovery.ts` / `create_recipe`: stop defaulting `status: draft` (no status stamped).

## 4. Validator + build

- [x] 4.1 `src/validate.ts` + `scripts/build-indexes.mjs`: drop `RECIPE_STATUSES`/`STATUS_ENUM` and the recipe-`status` checks; `title` stays required, `status` not. Keep stripping any lingering frontmatter `status` from the index.
- [x] 4.2 Drop the ready-to-eat `status`/`rating` structural checks; keep `meal`/`name`.

## 5. Persona (`AGENT_INSTRUCTIONS.md` → rebuild plugin)

- [x] 5.1 `import-recipe`: `create_recipe` no longer stamps `status: draft`; imports land available.
- [x] 5.2 `meal-plan`: drop the "drafts sit until dispositioned / de-prioritized" language; the candidate set is corpus minus rejects; side imports land available (no draft).
- [x] 5.3 `add-recipe-feedback`: favorite + `toggle_reject` (drop `set_recipe_status`/draft/active vocabulary).
- [x] 5.4 `add-ready-to-eat-feedback`: favorite + reject (drop status/rating/draft).
- [x] 5.5 `configure-grocery-profile`: remove the starter-corpus activation step; the corpus is available by default; capture taste/diet + point at the hosted site.
- [x] 5.6 Rotation guidance: favorites + a `diet_principles` line ("I cook these regularly"); no new tool.
- [x] 5.7 `npm run build:plugin` (operator URL) + confirm `skills/` drift-clean.

## 6. Docs

- [x] 6.1 `docs/TOOLS.md`: `toggle_reject` entry; remove `set_recipe_status`; `list_recipes` default + return (favorite, no status/rating); ready-to-eat tools.
- [x] 6.2 `docs/SCHEMAS.md`: overlay = `(tenant, recipe, favorite, reject)`; ready-to-eat shape; status/rating/archived removed.
- [x] 6.3 `docs/ARCHITECTURE.md`: the opt-in→opt-out disposition model; drop the `status` lifecycle + `archived` references.

## 7. Tests

- [x] 7.1 `test/overlay.test.ts`: favorite/reject merge + mutual exclusion + neutral default.
- [x] 7.2 `test/recipes.test.ts`: `filterRecipes` reject gate + non-rejected default.
- [x] 7.3 `test/write-tools.test.ts`: `toggle_reject`, ready-to-eat collapse, mutual exclusion.
- [x] 7.4 `test/profile-db.test.ts`: overlay + ready-to-eat round-trip (favorite/reject).
- [x] 7.5 Update/trim tooling tests touching the status enum (`tests/build-indexes.test.mjs`) and the plugin skill bodies if asserted.
- [x] 7.6 Reject-gate coverage on `recipe_semantic_search` (a rejected slug never ranks).
