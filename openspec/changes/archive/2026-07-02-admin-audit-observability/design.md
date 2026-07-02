# Design — admin-audit-observability

## Context

The normalization audit pipeline (#178–#183) already leaves complete traces in D1: `job_health`/`job_runs` summaries for `ingredient-alias-audit` (`{audited, self_stamped, kept, repointed, minted, merged, skipped}`), `ingredient-edge-audit` (`EdgeAuditSummary`: `{audited, self_loops, cycles, dropped, kept, skipped, structural, structural_restored, self_loops_swept, replayed, restored}`), `sku-cache-rekey` (`{rekeyed, merged, truncated}`), and `recipe-index` (`{projected, skipped, unresolved, degraded}`); `audited_at` markers on `ingredient_alias`/`ingredient_edge` (unaudited = `source='auto' AND audited_at IS NULL`); edge decisions in `ingredient_normalization_log` (`edge_keep`/`edge_drop`/`edge_restore`, structured `detail` JSON `{audit:"edge", from, to, kind, direction, reason, note, replay_of, replayed_at}`, legacy rows encoding the edge in the `term` as `` `from -[kind]-> to` ``); and merge rejections in `ingredient_coresolution_rejection` (`{a, b, decided_at}`). None of it is visible in the admin panel. A ratified Claude Design bundle specifies the surfaces; this design maps its illustrative shapes onto the real data.

## Goals / Non-Goals

**Goals:**
- Read-only SSR observability: Normalize › Audits tab, Decisions Terms/Edges segment, Status identity-audit row + recipe-index backfill gauge.
- One new reader module (`audit-admin.ts`) in the reconcile-admin idiom: pure `derive*` functions over `JobRun[]` + thin `read*` wrappers, unit-testable without D1.
- Deterministic Playwright coverage with seeded audit fixtures and reviewable screenshots.

**Non-Goals:**
- No manual edge restore/immune actions (handoff open question #1 — deferred; human edge pins need a proper tool first).
- No new tables, migrations, bindings, or writes; no changes to the audit jobs themselves.
- No island/client JS — every new surface is a pure read (admin/CLAUDE.md rule 8).

## Decisions

1. **One reader module, `src/audit-admin.ts`, following `reconcile-admin.ts`.** `deriveAuditObservability(...)` is pure over the three jobs' `JobRun[]` windows + the two live backlog counts; `readAuditObservability(env)` wires `readJobRuns` + D1 counts. Edge-decision and rejection readers live in the same module (they are audit-observability reads, not Decisions-stream reads), keeping `normalize-admin.ts`'s existing shape intact.
   - *Alternative considered:* extending `normalize-admin.ts` — rejected; that module models the term-decision stream and the node graph, and the audit model is job-series-shaped like reconcile.
2. **Backlog burndown series are derived by back-summation, not stored.** The audit jobs don't record remaining-backlog per tick; the reader reconstructs it: for runs oldest→newest with per-run `audited` counts and current unaudited count `B`, `remaining_after(run k) = B + Σ audited(j>k)`. Monotone non-increasing by construction, lands exactly on the live count; new rows arriving mid-window skew old points slightly high, which is acceptable for a trend sparkline. The recipe backfill needs no reconstruction — `recipe-index` runs carry `unresolved` directly, so its series is read straight off `job_runs`.
3. **Converged is a state, not a zero.** `AuditObservability["state"]` is a discriminated union (`converging | converged | neverRun`) exactly like `ReconcileState`; the view renders converged as the positive green terminal state ("holds at zero") per the design, and `assertNever` closes every switch.
4. **Edge decisions come from the normalization log with a two-tier parse.** Rows `outcome IN ('edge_keep','edge_drop','edge_restore')`: structured `detail` fields (`from`/`to`/`kind`) win; legacy rows fall back to the calibration change's strict term parse. `EDGE_TERM_RE` (currently the module-local `DROP_TERM_RE` in `ingredient-edge-audit.ts`) is **exported from `ingredient-edge-audit.ts`** and imported by the reader — one regex, no drift. Unparseable rows are dropped from the stream (they are malformed legacy noise, not renderable edges). Restorations join `edge_restore` rows to their origin via `detail.replay_of`; a drop row is flagged "revisited" when a restore's `replay_of` names its log id (or its own `detail.replayed_at` is stamped).
5. **The Terms stream keeps its `edge_*` filter; the Edges segment is a separate read.** `normalize-admin.ts`'s JS filter on the Decisions read stays (term cards would mis-render edge rows); the Edges segment consumes a dedicated bounded query (`WHERE outcome IN (...) ORDER BY id DESC LIMIT n`) from `audit-admin.ts`. The segment control is a query param (`stream=terms|edges`, default terms) so both segments deep-link, matching the tab idiom.
6. **Status identity-audit is ONE row** (architect-pinned, design default): a self-terminating convergence sibling of `grocery-reconcile`'s row — backlog burndown sparklines (alias + edge), no uptime %, `<details>`-expandable per-pass this-tick counts. The sku-cache re-key participates in the passes list but not the backlog (it has no `audited_at` backlog; its convergence is `truncated=false`).
7. **Backfill gauge rides the existing recipe-index `JobRow`** as an extra child block (like `Uptime`), fed by the `recipe-index` run series; `degraded: true` renders a calm amber chip (`bf-degraded`), never the failure treatment — a degraded tick is "resolver outage for one tick; resumes next tick", not a job failure.
8. **Design-bundle CSS is translated, not copied wholesale**: the `au-*`/`ec-*`/`bf-*`/`.nz-stream-*` classes land in `src/admin/styles.css` as panel layout (what Basecoat lacks), mapped onto the panel's existing tokens (`--accent`, Basecoat vars) and the existing `rk-*` convergence vocabulary; components/badges/tables reuse Basecoat classes. Preview toggles from the mock are deleted (handoff instruction).
9. **Fixtures**: `seed.mjs` gains unaudited + audited alias/edge rows, edge-decision log rows (one keep, one flagged drop, one drop+restore pair linked by `replay_of`), one `ingredient_coresolution_rejection` row, and `job_runs` histories for the three audit jobs plus `recipe-index` runs with `unresolved > 0, degraded: true` — all offset from the runner's `now` so relative labels stay off the assertion surface. `fake-d1.ts` learns `job_runs` (and `COUNT(*)` if needed) for reader tests; pure `derive*` tests need no fake.

## Risks / Trade-offs

- [Back-summed burndown assumes audited rows came from the counted backlog] → It is a trend visual only; the headline number is the live `COUNT(*)`, always exact. Documented in the reader.
- [Legacy edge rows without structured detail may lack `direction`/`reason`] → The card renders what exists; verdict/reason lines are optional in the model (`| null`), not empty strings.
- [`job_runs` window (100 cap, 15-run window) limits series depth] → Same trade the reconcile card already made; consistent.
- [Edges segment reads unbounded-ish log growth] → bounded `LIMIT` like the Decisions read (200 default), newest first.

## Open Questions

None — the two handoff open questions were pinned by the architect (read-only translation; one Status row).
