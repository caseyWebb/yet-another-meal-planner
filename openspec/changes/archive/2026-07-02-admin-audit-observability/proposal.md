# Admin audit observability

## Why

The normalization audit pipeline (alias re-audit, edge re-audit, sku-cache re-key, edge-drop replay, co-resolution rejection memory, recipe-index backfill — hardening #178 through calibration #183) runs entirely on cron with rich D1 traces, but the admin panel shows none of it: the operator cannot see whether the audit backlog is draining, why an edge was kept or dropped, which past drops were restored, or how far the recipe backfill has converged. A ratified Claude Design bundle (the "Audit Surface" export) specifies the observability surfaces; this change translates it into the panel.

## What Changes

- **Normalize › Audits tab** (new sub-nav pill): a backlog-burndown hero (unaudited alias + edge counts with recent-series sparklines; both-zero renders as a positive green "holds at zero" state), three audit-pass cards (this-tick counts from job summaries for `ingredient-alias-audit`, `ingredient-edge-audit`, `sku-cache-rekey`), a restorations/replay log (edge_restore decisions linked to the origin decision they revisit), and a merge-rejection memory table (`coresolution_rejections` under backoff).
- **Normalize › Decisions Terms/Edges segment**: the Decisions view gains a segment control; Terms is the existing term-decision stream unchanged, Edges is a new stream over `edge_keep`/`edge_drop` decisions with All/Kept/Dropped filters, self-loop/cycle flag chips, and a "revisited → Restorations" pointer on drops later restored. (The reader currently JS-filters `edge_*` outcomes out of the Decisions stream; the Edges segment consumes them instead.)
- **Status page**: one self-terminating `identity-audit` convergence row (backlog burndown, per-pass this-tick counts, no uptime %), and the `recipe-index` job row gains an inline backfill gauge (unresolved burndown + % resolved) with a calm amber `degraded` chip that is never styled as failure.
- **New reader module** (`audit-admin`) deriving all of the above from existing data — job_health/job_runs summaries, unaudited-row counts, normalization-log edge rows (structured detail post-calibration; strict legacy `'from -[kind]-> to'` parse reused from the calibration change), `coresolution_rejections`.
- **Read-only translation**: no manual edge restore/immune actions in this change (deferred to a future change routing human edge pins through a proper tool); the design bundle's review-only preview toggles are deleted on translation.
- Playwright page objects, deterministic audit fixtures in `seed.mjs`, and new area screenshots extend the admin visual harness per its POM conventions (implementation under the existing `admin-ui-testing` requirements — no requirement change there).

## Capabilities

### New Capabilities

_None — these are new surfaces of the existing operator admin panel._

### Modified Capabilities

- `operator-admin`: adds requirements for the Normalize › Audits tab, the Decisions Terms/Edges segment, the Status identity-audit convergence row, and the recipe-index backfill gauge. All read-only SSR surfaces.

## Impact

- `packages/worker/src/audit-admin.ts` (new reader), `packages/worker/src/normalize-admin.ts` (Edges stream data; Terms stream keeps its edge-outcome filter), `packages/worker/src/admin/pages/normalize.tsx`, `status.tsx`, a new `audits.tsx` (or sections thereof), `src/admin/app.tsx` wiring, `src/admin/styles.css` (`au-*` / `ec-*` / `bf-*` / `.nz-stream-*` layout classes).
- `packages/worker/admin/visual/`: `pages/normalize.page.ts`, `pages/status.page.ts`, `seed.mjs` + `seed.d.mts`, `specs/smoke.spec.ts`, `specs/normalize.spec.ts`; new screenshots.
- Vitest fake-D1 coverage for the new reader; no schema/tool changes (docs/TOOLS.md, docs/SCHEMAS.md untouched apart from verifying job-summary notes stay accurate).
- No migrations, no new bindings, no writes — purely derived reads over existing tables.
