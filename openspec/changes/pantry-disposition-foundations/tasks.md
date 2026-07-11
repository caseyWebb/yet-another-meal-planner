# Tasks — pantry-disposition-foundations

**Serialization:** do NOT implement in parallel with (a) `meal-dimension-foundations` or any
change touching `scheduled()` wiring in `packages/worker/src/index.ts` (§5 wires a new job),
(b) any change touching the `member-app-offline` spec (band-3 grocery/walk changes, band-2
`pantry-page`), or (c) band-1 siblings sharing docs/TOOLS.md + docs/SCHEMAS.md sections.
`spend-capture-on-order-commit` consumes §2's `src/department.ts` — implement this change
BEFORE it, or hand it the module explicitly. **No spike tasks** — production shapes, counts,
and every open question are settled in design.md (D1–D9, §8). All paths below are relative to
the repo root; worker code lives in `packages/worker/`.

## 1. Migration (design D2, fixtures §8)

- [x] 1.1 New `packages/worker/migrations/d1/NNNN_pantry_location_disposition.sql` (next free
  number — `0049` as of planning; production has applied through `0048`): `ALTER TABLE pantry
  ADD COLUMN location TEXT;` + `CREATE INDEX idx_pantry_location ON pantry(tenant, location);`
  + the `waste_events` table and `idx_waste_events_when(tenant, occurred_at)` exactly per
  design D4 + `ALTER TABLE ingredient_identity ADD COLUMN category TEXT;` + the one-time
  legacy remap UPDATEs — location first, then category, matching on `LOWER(TRIM(category))`,
  per design D2's mapping table (location: pantry/fridge/freezer pass-through,
  spice|spices|spice blend→spice_rack; category: spice-family→spices, condiment→condiments,
  baking→baking, canned goods→canned, dairy→dairy, produce→produce, grain|pasta→grains,
  meat→meat, bread→bakery; ELSE NULL). Header comment names design.md §8's fixture table as
  the ground truth.
- [x] 1.2 Verify locally: `npx wrangler d1 migrations apply DB --local`, seed rows covering
  every design-D2 mapping row plus an unmapped free-text value, and assert the remap output
  with `wrangler d1 execute DB --local` SELECTs (the §8 F1 shape at local scale).

## 2. Vocabulary + department module (design D1, D5)

- [x] 2.1 New `packages/worker/src/department.ts`: `PANTRY_LOCATIONS`, `PANTRY_CATEGORIES`,
  `WASTE_REASONS`, `DEPARTMENTS` (= categories ∪ `household` ∪ `leftovers`),
  `LEGACY_CATEGORY_TO_LOCATION` (`pantry→pantry, fridge→fridge, freezer→freezer,
  spices→spice_rack` — the ongoing D21 shim set, NOT the migration's wider one-time map), and
  `stampDepartment({ preparedFrom, rowCategory, memoCategory })` implementing design D5's
  precedence (leftovers → in-vocab row category → memo → null). Module comment: this is the
  ONE D17 derivation; `spend-capture-on-order-commit` imports it; band 2 lifts the vocab
  arrays to `@yamp/contract` when the app needs dropdowns.

## 3. The dispose operation (design D3, D4, D7)

- [x] 3.1 `packages/worker/src/pantry-write.ts`: extend `PantryOperation` with
  `op: "dispose"` + `disposition`, `reason`, `event_id`, `occurred_at`; extend
  `applyPantryOperations` to treat an applied dispose as a remove plus a returned
  **waste-event draft** (`{ id?, name, item_id-from-normalize, prepared_from, quantity,
  reason, occurred_at? }`, waste only) in the result; add the field-validation pass shared by
  add/dispose per design D7 (off-vocab location → conflict; legacy category → transpose;
  other off-vocab category → drop + `warnings` entry). Keep the module pure (no env) — shape
  validation that must be `validation_failed` (missing disposition, waste without/with
  unknown reason, malformed event_id `[A-Za-z0-9_-]{1,64}`, malformed `YYYY-MM-DD`) is
  signaled distinctly from per-op conflicts so wrappers can throw `ToolError`.
- [x] 3.2 `packages/worker/src/session-db.ts`: `PantryRow`/`pantryItemOf`/`readPantry`
  SELECT/`pantryUpsertStmt` gain `location` (and the read filter gains `location`; the
  `category` filter maps legacy values onto location per design D7); new
  `wasteEventInsertStmt` (`INSERT INTO waste_events … ON CONFLICT(tenant, id) DO NOTHING`);
  `applyPantryRowOps` — resolve each dispose's event id (mint server-side via ULID/crypto
  when absent), short-circuit an already-recorded `event_id` to applied (design D3 replay
  rule), stamp `department` via `stampDepartment` (memo lookup: row `normalized_name` →
  alias/identity → representative → `category`, one batched read), stamp `created_at`,
  default `occurred_at`, and batch the DELETE + INSERT with the other statements.
- [x] 3.3 `packages/worker/src/grocery-pantry-reconcile.ts`: carry `location` through
  `PantryRekeyRow`, the SELECT, the row mapper, and the merge (first non-NULL, like
  `category`); fix the same path dropping `display_name` today (row type, SELECT, mapper,
  merge — grounding observation, one line each).

## 4. Tool + /api surfaces (design D3, D7; TOOLS.md text direction)

- [x] 4.1 `packages/worker/src/write-tools.ts` `update_pantry`: zod op enum gains
  `"dispose"` + optional `disposition` (`z.enum(["used","waste"])`), `reason`, `event_id`,
  `occurred_at`; result includes `warnings` when present. Replace the description with the
  full contract (tool descriptions own guarantees — Appendix C): upsert-merge sentence stays;
  then, verbatim direction —
  "Items carry two orthogonal fields: `category`, the food taxonomy (produce | dairy | meat |
  seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks |
  beverages), and `location`, where it's kept (fridge | freezer | pantry | spice_rack |
  counter | cabinet). Omit category to let the background classifier derive it — NULL reads
  as uncategorized, never an error. An off-vocabulary location is a conflict, never a silent
  write; an off-vocabulary category is accepted with the field dropped and a warning (legacy
  values pantry|fridge|freezer|spices are transposed onto location for one deprecation
  window). `remove` is a plain correction/cleanup delete and records nothing. When food
  actually leaves the kitchen, use `dispose`: { op:'dispose', name, disposition:
  'used'|'waste', reason?, event_id?, occurred_at? } removes the row, and 'waste' also
  records a waste event for the waste analyzer — reason is required for waste, exactly one of
  spoiled | moldy | over_ripe | expired | freezer_burned | stale | forgot | bought_too_much |
  never_opened | other. Disposition NEVER asks or accepts a dollar value — the event's value
  is derived later from purchase history, so never prompt the member for what an item cost.
  The event's analytics department is stamped at capture from the item's identity (a
  prepared/leftover row stamps 'leftovers'). `event_id` is an optional client-minted
  idempotency key — a replayed dispose with the same id converges to one event; omit it and
  the server mints one. `occurred_at` (YYYY-MM-DD) backdates the toss; default today.
  'used' records nothing today (pure removal). Returns applied + conflicts + warnings."
- [x] 4.2 `packages/worker/src/tools.ts` `read_pantry`: `pantryFilterShape` gains `location`;
  wire the filter through; description gains — "Items carry orthogonal `category` (food
  taxonomy) and `location` (fridge | freezer | pantry | spice_rack | counter | cabinet)
  fields; filter on either. Legacy location-flavored `category` values
  (pantry|fridge|freezer|spices) are treated as a `location` filter for one deprecation
  window. Absent category means not-yet-classified — treat as uncategorized, never an error."
  (`stale_only` text unchanged.)
- [x] 4.3 `packages/worker/src/api/pantry.ts`: `OPS` gains `dispose`; pass through
  `disposition`/`reason`/`event_id`/`occurred_at` with the same shape validation
  (`ToolError("validation_failed", …)`); `GET /pantry` gains the `location` query filter.
  No new route — no `run_worker_first` change (existing `/api/*` coverage). The app-side
  mutation-registry entry ships with band 2's `pantry-page` (design D8).

## 5. The ingredient-category job (design D6)

- [x] 5.1 `packages/worker/src/ai.ts`: add `"ingredient-category"` to `AiActivity` (text-gen
  group).
- [x] 5.2 New `packages/worker/src/ingredient-category.ts` (`runCategoryJob`/
  `buildCategoryDeps`, job name `ingredient-category`): phase 1 — select up to
  `CATEGORY_BATCHES(2) × CATEGORY_BATCH_SIZE(40)` rows
  `WHERE representative IS NULL AND concrete = 1 AND category IS NULL`, batch-classify
  (id + display_name → exactly one of the 14 categories or `household`) via `runAi`
  (`NORMALIZE_MODEL`), strict parse, write only in-vocab answers (unparseable/off-vocab →
  leave NULL for retry); phase 2 — fill NULL `pantry.category` from the memo
  (alias→identity→representative join), food-vocab values only, never overwriting non-NULL;
  phase 3 — fill NULL `waste_events.department` from the memo via `item_id` (any memo value).
  All phases bounded + idempotent; `writeJobHealth` + `writeJobRun` with a tenant-clean
  summary ({classified, pantry_filled, events_stamped, backlog}); self-terminating no-op runs.
- [x] 5.3 `packages/worker/src/index.ts` `scheduled()`: add `runCategoryJob` to the phase-1
  `Promise.allSettled` group (independent of the recipe pipeline; internal env.AI/D1 budget;
  comment noting it trails `runNormalizeJob` by construction — a brand-new identity
  classifies next tick). Update the spine comment. **Serial surface** — coordinate per the
  header note. The admin jobs surface needs nothing (generic over `job_health`).

## 6. Tests (fake-d1 idiom; `aubr test` from `packages/worker/`)

- [x] 6.1 `test/pantry-write.test.ts` (or the existing suite home): dispose used = remove +
  no draft; dispose waste = remove + draft with reason/occurred_at; waste without reason /
  unknown reason / bad event_id / bad date → the validation signal; off-vocab location
  conflict; legacy category transposition; off-vocab category drop + warning.
- [x] 6.2 `test/session-db.test.ts`: location round-trips through upsert/read + location
  filter + legacy category filter mapping; dispose batch deletes row and inserts event;
  replayed event_id short-circuits to applied with exactly one row; server-minted id when
  absent; department stamping precedence (prepared_from → leftovers; row category; memo via
  alias; NULL pending); `warnings` surfaced through `applyPantryRowOps`.
- [x] 6.3 `test/write-tools.test.ts` + `test/session.test.ts` (api): update_pantry dispose
  passthrough returns applied/conflicts/warnings and `validation_failed` on shape errors;
  `GET /api/pantry?location=` filter; POST /pantry/ops dispose parity with the tool.
- [x] 6.4 New `test/ingredient-category.test.ts`: classify writes only in-vocab answers and
  defers failures; pantry fill skips non-NULL and `household`; event stamp fills NULL only,
  never rewrites; no-op run when backlog empty (job summary counts).
- [x] 6.5 `test/grocery-pantry-reconcile.test.ts`: re-keyed rows keep `location` (+
  `display_name`).

## 7. Docs lockstep (same pass — no drift, current-state voice)

- [x] 7.1 `docs/TOOLS.md`: rewrite the `read_pantry` / `update_pantry` sections to the 4.1/4.2
  contracts (params incl. dispose fields, returns incl. `warnings`, the never-asks-value
  guarantee, the deprecation-window shims, the department stamp). `mark_pantry_verified`
  untouched.
- [x] 7.2 `docs/SCHEMAS.md`: pantry section — `location` column + both vocabularies + NULL
  semantics + `idx_pantry_location`; new `waste_events` section (design D4 DDL, example rows,
  the department dimension = category vocab ∪ household ∪ leftovers, capture-stamp +
  pending-fill rule, PK-includes-tenant rationale, no value column — band 4); ingredient
  registry section gains the `category` memo column; the `AiActivity` list gains
  `ingredient-category`.
- [x] 7.3 `docs/ARCHITECTURE.md`: cron-job list gains the `ingredient-category` pass (one
  line, capture→retrieve→narrow framing: classify once per identity, stamp deterministically
  at capture).

## 8. Validation + acceptance

- [x] 8.1 `aubr typecheck` + `aubr test` green; `openspec validate
  "pantry-disposition-foundations"` passes (invoke the openspec binary with THIS worktree as
  cwd — the `~/.local/bin` shims cd into whichever worktree ran session-start last).
- [ ] 8.2 Post-deploy production verification (read-only `wrangler d1 execute grocery-mcp
  --remote`): design.md §8 fixtures — F1 remap counts (location: pantry 74 / freezer 37 /
  fridge 32 / spice_rack 84 / NULL 109; category: 176 mapped per table, NULL 160, zero legacy
  survivors), F2/F3 convergence + backlog drain via `job_runs` for `ingredient-category`
  (798 → 0), F4 first-disposition checks when real events exist. Record results on the PR.
  *(Deliberately open at implementation time — runs AFTER the deploy; the F1 remap was
  verified locally against the full 22-value §8 distribution, exact counts matched.)*
