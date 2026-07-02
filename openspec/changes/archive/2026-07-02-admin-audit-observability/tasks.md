# Tasks — admin-audit-observability

## 1. Reader

- [x] 1.1 Export the strict legacy edge-term regex from `ingredient-edge-audit.ts` (rename the module-local `DROP_TERM_RE` to an exported `EDGE_TERM_RE`, keep the one definition)
- [x] 1.2 Create `src/audit-admin.ts`: audit observability model (discriminated `state`, pass summaries, back-summed burndown series), `deriveAuditObservability` (pure) + `readAuditObservability(env)`; edge-decision stream reader (structured detail first, legacy term parse fallback, restore/revisited linking via `replay_of`/`replayed_at`); rejection reader over `ingredient_coresolution_rejection`; recipe backfill derive over `recipe-index` runs
- [x] 1.3 Vitest coverage: pure derive tests + fake-d1 reader tests (`test/audit-admin.test.ts`); extend `test/fake-d1.ts` for `job_runs` (and count predicates) as needed

## 2. Surfaces

- [x] 2.1 Normalize › Audits tab in `src/admin/pages/normalize.tsx` (+ new `audits.tsx` view module): sub-nav pill with convergence dot, burndown hero, three pass cards, restorations log, rejection table; extend `NormalizeQuery`/`parseQuery` with `tab=audits` and the `stream` param (the Edges segment reuses the shared `filter` param for All/Kept/Dropped)
- [x] 2.2 Decisions Terms/Edges segment + EdgeStream (All/Kept/Dropped filters, flag chips, revisited pointer); Terms stream unchanged
- [x] 2.3 Status: `AuditStatusRow` (one convergence row, expandable per-pass counts, no uptime %) and the recipe-index inline backfill gauge with calm amber degraded chip, in `status.tsx` (+ shared audit sparkline)
- [x] 2.4 Wire readers in `src/admin/app.tsx` (normalize + status routes)
- [x] 2.5 Translate the `au-*`/`ec-*`/`bf-*`/`.nz-stream-*` layout CSS into `src/admin/styles.css` on panel tokens; `aubr build:admin` clean

## 3. Playwright

- [x] 3.1 Seed deterministic audit fixtures in `admin/visual/seed.mjs` + `seed.d.mts`: audited/unaudited alias+edge rows, edge decision log rows incl. a drop+restore pair, a coresolution rejection, audit-job `job_runs`, recipe-index runs with `unresolved>0`/`degraded`
- [x] 3.2 Extend `NormalizePage` (audits tab, decisions segment methods) and `StatusPage` (audit row + backfill gauge assertions)
- [x] 3.3 Specs: audits-tab render + screenshot, edges-segment spec, status audit/backfill assertions; suite green; new ASCII-named screenshots

## 4. Verification & docs

- [x] 4.1 `aubr typecheck` (all three passes), `aubr test`, `openspec validate admin-audit-observability`
- [x] 4.2 Confirm docs/SCHEMAS.md job-summary notes remain accurate; update `admin/visual/README.md` only if the harness file tree grows
