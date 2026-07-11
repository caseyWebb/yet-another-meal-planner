# Tasks — pantry-page

**Serialization:** this change touches `member-app-offline` and the app pantry seed rows — do
NOT implement in parallel with another change touching that spec or the shared app seed. It is
FRONTEND + a `@yamp/contract` vocab lift only: no `scheduled()` wiring, no D1 migration, no
Worker route, no `docs/TOOLS.md`/`docs/SCHEMAS.md` delta. Paths are relative to the repo root.

## 1. Vocabulary single-source (decision 4)

- [x] 1.1 New `packages/contract/src/pantry.ts` exporting `PANTRY_CATEGORIES`,
  `PANTRY_LOCATIONS`, `WASTE_REASONS` (+ their `PantryCategory`/`PantryLocation`/`WasteReason`
  types); re-export from `packages/contract/src/index.ts`.
- [x] 1.2 `packages/worker/src/department.ts` re-exports the three arrays from `@yamp/contract`
  and imports what its derived sets (`IDENTITY_CATEGORIES`, `DEPARTMENTS`,
  `LEGACY_CATEGORY_TO_LOCATION`) need — the existing `./department.js` importers (pantry-write,
  session-db, ingredient-category, write-tools) are unchanged.
- [x] 1.3 Bump `packages/satellite/package.json` version 0.1.14 → 0.1.15 (the contract change
  trips the `satellite-version` gate).
- [x] 1.4 Add `@yamp/contract` as an app dependency (`packages/app/package.json`).

## 2. Data + mutations (frontend types)

- [x] 2.1 `packages/app/src/lib/data.ts`: add `location?`, `normalized_name?`, `display_name?`
  to `PantryRow` (served today, previously untyped).
- [x] 2.2 `packages/app/src/lib/mutations.ts`: type the `dispose` op (`PantryOp` union), and add
  an optimistic `onMutate` to the `["pantry","ops"]` row that drops removed/disposed rows so the
  disposition feels instant and works offline. No new mutation key.

## 3. The page (decisions 1, 2, 3, 5, 6)

- [x] 3.1 `packages/app/src/routes/_app.pantry.tsx` rewrite: keep the needs-verification section;
  add the multi-add grid (datalists, auto-append, per-row remove, Clear, "Add N items"), the
  group-by Category|Location toggle, the item-row Used split button + menu, and the waste modal
  (all 10 `WASTE_REASONS`, `event_id` minted via `mintRowId`, `occurred_at` stamped, no value
  input). Client recognition is UX-only and never clobbers typed input.
- [x] 3.2 `packages/ui/src/cookbook.css`: port the new classes — the multi-add grid, the group-by
  row, the disposition split button + menu, the re-verify icon, and the UNSCOPED
  `.modal-*`/`.store-result*` (the `.connect-modal`-scoped rules still win inside the connect
  modal).

## 4. Tests + seed

- [x] 4.1 `packages/worker/admin/visual/seed.mjs`: fix the app pantry rows — `category
  'grain'`→`'grains'`, set `location` on both, keep Baby spinach the stale perishable, and add
  ≥3 rows spanning ≥2 locations (Butter/dairy/fridge, Olive oil/oils/pantry, Parmesan/dairy/fridge).
  Do not collide with the Red-cabbage `pantryHit` row.
- [x] 4.2 `packages/worker/app/visual/pages/pantry.page.ts`: add `groupBy`, `expectGroup`,
  `groupLabels`, `addRows`/`commitAdd`, `markUsed`, `markWaste`, `expectRemoved`; keep the
  verify helpers; route the single-row `addItem` through the grid.
- [x] 4.3 `packages/worker/app/visual/specs/pantry.spec.ts`: group-by-location fixed order;
  multi-add autofill (fills where recognized, never clobbers an override, commits verified-now);
  blank category commits as auto; Used removes without a modal; Mark-as-waste → modal → reason →
  removed, asserting the ops body carries `disposition:"waste"`, an enum `reason`, and an
  `event_id`, and that no value is ever prompted; keep the needs-verification flag+clear test.

## 5. Verify

- [x] 5.1 `aube run build:app` + `aube run typecheck` exit 0.
- [x] 5.2 `PW_CHROMIUM_PATH=… aube --filter @yamp/worker run test:app` green.
- [x] 5.3 `aube run test` + `aube run test:tooling` + the satellite/contract packages pass, and
  the version bump satisfies the `satellite-version` gate.
- [x] 5.4 `aube run openspec validate "pantry-page" --strict` valid.
