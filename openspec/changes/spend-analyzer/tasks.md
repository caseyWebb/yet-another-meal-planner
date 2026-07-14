## Traceability and footprint guard

Requirement keys used below are `ST1` MCP/profile aggregate, `ST2` bounded UTC windows, `ST3` coverage-aware shape, `ST4` KPIs, `ST5` breakdowns/drivers, `ST6` insight, `ST7` read-only projection, `ST8` production contracts/tests, `MA1` member shell/panel, `MA2` member endpoint, and `MA3` real-entry browser coverage. A task's named scenario cluster refers to the scenarios under that requirement.

The anticipated concrete surface is:

- `packages/worker/src/spend.ts` and `packages/worker/src/cooking-tools.ts`;
- a narrow `packages/worker/src/api/retrospective.ts` area composed in `packages/worker/src/api/app.ts`, with `api/profile.ts` touched only if shared delegation requires it;
- `packages/worker/test/spend.test.ts`, `api-member.test.ts`, and `cooking-tools.test.ts`;
- `packages/app/src/lib/data.ts` and `packages/app/src/routes/_app.retrospective.tsx`;
- `packages/ui/src/cookbook.css`;
- `packages/worker/admin/visual/seed.mjs`;
- `packages/worker/app/visual/pages/retrospective.page.ts` and `specs/retrospective.spec.ts`;
- the two living specs, `docs/{TOOLS,SCHEMAS,ARCHITECTURE}.md`, and `packages/worker/AGENT_INSTRUCTIONS.md`; and
- the active OpenSpec artifacts that the separate archive step will move after implementation.

No migration, dependency, cron, generated bundle, Waste implementation, or unrelated surface is anticipated.

| Requirement | Implemented and accepted by tasks |
|---|---|
| ST1 MCP/profile aggregate | 1.2, 1.8, 3.3-3.4, 6.2 |
| ST2 bounded UTC windows | 1.3-1.4, 2.1, 5.1 |
| ST3 coverage-aware shape | 1.2, 1.5, 2.2, 4.4 |
| ST4 KPIs | 1.6, 2.2-2.3, 4.4 |
| ST5 breakdowns/drivers | 1.7, 2.4, 4.4 |
| ST6 deterministic insight | 1.8, 2.5, 4.4 |
| ST7 read-only projection | 1.1, 1.4-1.5, 2.6, 7.4 |
| ST8 production contracts/tests | 1.1-7.4 |
| MA1 member shell/panel | 4.1-4.5, 5.2-5.4, 6.1, 7.2 |
| MA2 member endpoint | 3.1-3.4, 4.1, 6.1, 7.1 |
| MA3 real-entry browser coverage | 5.1-5.4, 7.1-7.2 |

## 1. Shared bounded Spend reader

- [ ] 1.1 Before production edits, record the merge-base footprint and enforce the non-goals: if Spend requires cart recovery/ownership, grocery or pantry tokens, generic CAS, re-key convergence, settlement/compensation, operation registries/oracles, satellite receipt atomicity, or generic error infrastructure, document the exact reachable production entry path and stop for user approval without editing that system. (maps: ST7 excluded-systems and repeated-read scenarios; ST8 production-design requirement)
- [ ] 1.2 In `packages/worker/src/spend.ts`, define/export the exact `SpendRange`, coverage, KPI, breakdown, driver, week, and `SpendAnalyzer` types plus the fixed range/cap/template constants; reuse `COST_PER_MEAL_EXCLUDED` and add no dependency or generic framework. Acceptance: the public type exactly matches design D2 and admits no extra synthetic state. (maps: ST1 additive-fields scenarios; ST3 all shape/coverage scenarios; ST4 denominator scenarios; ST5 driver-cap scenarios)
- [ ] 1.3 Implement UTC ISO-Monday range derivation for `4w`, `8w`, and `12w`, including selected/prior bounds, chronological buckets, `through`, and `is_partial`; make `readSpendAnalyzer(env, tenant, range, now?)` the sole analyzer entry and default only its clock. (maps: ST2 four-week, Sunday, all-range, largest-range, future, UTC-boundary scenarios)
- [ ] 1.4 Read profile budget, non-voided spend facts from matched prior start through `as_of`, selected recipe/ad-hoc cooking count, and current sent `in_cart` count through `db(env)` with tenant predicates and both date bounds where dates exist; use existing indexes/constants and no write, migration, index, cache, queue, or cron. (maps: ST2 bounded-read/tenant scenarios; ST7 read-only, pending-classification, prior-schema scenarios)
- [ ] 1.5 Reduce stored decimals through per-value integer cents into aggregate and per-week monetary/department/savings coverage, normalized budget, legacy fields, awaiting count, and truthful `empty|unavailable|partial|complete` status. Acceptance: estimated, unpriced, null-department, null-savings, and voided rows follow ST3 without `Not mapped`. (maps: ST3 all scenarios; ST7 correction scenario)
- [ ] 1.6 Compute total, N-bucket average, exact cost-per-meal denominator/numerator, matched trend with reason precedence, and budget tri-state; never infer servings, weights, household size, timezone, or missing values. (maps: ST4 average, cooking-row, D17 exclusion, excluded-only, pending/partial numerator, zero-meal, empty-spend, trend, budget, and rounding scenarios)
- [ ] 1.7 Build department/store/provenance breakdowns and top drivers strictly from captured keys, including unpriced-only groups, exact denominators, labels, representative-row choice, stable sorting, percentages, cap six, and pre-cap count. (maps: ST5 every breakdown, denominator, grouping, representative, tie, and cap scenario)
- [ ] 1.8 Implement the fixed insight ladder and exact grammar/currency/trend clauses; preserve awaiting placement as a separate fact. Replace the legacy reducer with 4w delegation or update all callers so no second analyzer implementation survives. (maps: ST6 every template/grammar/optional-clause scenario; ST1 legacy-default scenarios)

## 2. Production-reader SQLite coverage

- [ ] 2.1 Extend `packages/worker/test/spend.test.ts` through the exported production reader over `sqliteEnv`'s real current migrations for 4/8/12 ranges, Monday/Sunday and prior-window edges, future exclusion, chronological bounds, and cross-tenant spend/cooking/budget/awaiting isolation. (maps: ST2 all scenarios; ST8 operation-entry scenario)
- [ ] 2.2 Add reader cases for empty, wholly unpriced, mixed unpriced, estimated, pending department, missing savings, per-week mixed coverage, void exclusion, cents rounding, and zero denominators; assert the exact shared shape rather than recreating a reducer in tests. (maps: ST3 all scenarios; ST4 rounding/zero-denominator scenarios; ST8 no-parallel-model scenario)
- [ ] 2.3 Add exact KPI cases covering every qualifying cooking type/meal value, `ready_to_eat` exclusion, D17 Household/Beverages exclusion only from cost, excluded-only zero, pending/unpriced/estimated numerator states, N-bucket average, trend precedence, and positive/null/zero budget behavior. (maps: ST4 all KPI and budget scenarios)
- [ ] 2.4 Add captured department/store/provenance and driver fixtures that prove raw-key grouping, no registry/current-state lookup, unpriced-only visibility, denominator rules, labels, all tie-breaks, latest-row name+department pairing, event-not-quantity counts, and cap/total count. (maps: ST5 all scenarios)
- [ ] 2.5 Assert each exact insight string for empty, unavailable, partial singular/plural ordering, complete top-department tie, planned/impulse percentages, higher/lower/unchanged trend, unavailable-trend omission, and awaiting independence. (maps: ST6 all scenarios)
- [ ] 2.6 Exercise late insertion, existing purchase-assertion replay identity, existing void correction, and refresh around committed independent writes through real production operations; compare schema/state before and after repeated reads and prove current and already-migrated rows need no analyzer DDL. (maps: ST7 late, duplicate, correction, concurrency, compatibility, repeated-read scenarios; ST8 fresh/current-schema scenarios)

## 3. API, MCP, and compatible profile adapters

- [ ] 3.1 Add a session-gated `GET /retrospective/spend` area in `packages/worker/src/api/retrospective.ts` and compose it in `api/app.ts`; accept only `range`, default to `8w`, emit the exact validation error, call the shared reader, and return its object through `jsonWithEtag`. (maps: MA2 authenticated, default, invalid, ETag, identity, side-effect scenarios)
- [ ] 3.2 Extend `packages/worker/test/api-member.test.ts` through the composed app for explicit/default ranges, exact 400 body, unauthenticated rejection before analysis, ignored tenant-like inputs, ETag/304 behavior, tenant isolation, and deterministic repeat GET. (maps: MA2 every endpoint scenario; ST8 production-entry requirement)
- [ ] 3.3 Update `packages/worker/src/cooking-tools.ts` so `loadRetrospective` additively accepts `spend_range` defaulting to `4w`, the registered `retrospective` schema/description exposes the enum, cooking `period` stays independent, and profile retrospective delegates to the same 4w object with non-Spend fields unchanged. (maps: ST1 every MCP/profile/default/read-only scenario; MA2 legacy-profile scenario)
- [ ] 3.4 Extend `packages/worker/test/cooking-tools.test.ts` via the registered tool harness and profile/composed adapter to compare the same `.spend` shape for omitted/explicit ranges, preserve legacy fields and cooking period, prove household scope, and confirm no Spend writer appears. (maps: ST1 all scenarios; ST8 tool-entry scenario; MA2 shared-shape scenario)

## 4. Member Spend panel only

- [ ] 4.1 Add the exact response types/query helper in `packages/app/src/lib/data.ts`; the query key includes range, calls only the dedicated typed endpoint, is enabled only on the active Spend tab, and is never added to offline persistence. (maps: MA1 URL/query/offline requirements; MA2 shared-object scenario)
- [ ] 4.2 In `_app.retrospective.tsx`, validate/canonicalize missing or invalid Spend `range` to `8w` with replace navigation, persist valid range across tabs, and render a named three-button range group with exactly one `aria-pressed=true`. (maps: MA1 missing/invalid canonicalization, selection, inactive-tab, range-control scenarios)
- [ ] 4.3 Complete stable tab/panel ids and reciprocal ARIA, roving `tabIndex`, and wrapping ArrowLeft/ArrowRight/Home/End activation+focus while preserving Cooking log default, `/log` redirect, and the untouched Waste placeholder. (maps: MA1 shell, URL-tab, keyboard, legacy-route, Waste-scope scenarios)
- [ ] 4.4 Render status-region loading, structured error with keyboard retry, distinct empty/unavailable states, partial evidence, complete KPIs, separate awaiting notice, optional budget/tri-state labels, chronological text-equivalent weekly list, breakdowns, drivers, and server insight without client-side reclassification or guessed values. (maps: MA1 loading/retry, empty/unavailable, partial, budget, awaiting, weekly-text scenarios; ST3-ST6 shared-shape presentation)
- [ ] 4.5 Add only Spend-scoped rules in `packages/ui/src/cookbook.css`: readable controls/cards, decorative bar geometry hidden from assistive technology, labelled horizontal chart overflow at narrow/tall viewports, and no canvas/chart library or unrelated redesign. (maps: MA1 narrow/tall, text-equivalent, no-library scenarios)

## 5. Real browser harness and responsive evidence

- [ ] 5.1 Extend `packages/worker/admin/visual/seed.mjs` with stable, current-window tenant-owned spend/cooking/budget/awaiting facts sufficient for a complete 8w analyzer result and range changes; seed existing tables only and keep values exported for assertions. (maps: MA3 primary-production-data scenario; ST2/ST3/ST4 tenant and aggregate scenarios)
- [ ] 5.2 Extend `packages/worker/app/visual/pages/retrospective.page.ts` with semantic Spend tab/range/KPI/week/notice locators, keyboard helpers, retry, and desktop/tall/narrow review capture helpers; address production markup, not a browser-only model. (maps: MA1 accessibility/layout scenarios; MA3 no-test-model scenario)
- [ ] 5.3 Extend `retrospective.spec.ts` with a primary signed-in case using the real composed endpoint/reader to prove 8w default canonicalization, 4w/12w URL and content changes, tab/range ARIA and keyboard behavior, textual KPIs/weeks, awaiting notice, Waste unchanged, and desktop plus tall/narrow review captures. (maps: MA1 all shell/primary-panel scenarios; MA3 primary-production-data scenario)
- [ ] 5.4 Cover sustained loading, exact structured error/retry, and valid partial/unavailable/empty presentations only with narrowly scoped endpoint interception using the production response type; keep all aggregate correctness assertions in the real seeded case. (maps: MA1 loading/error/missingness scenarios; MA3 presentation-interception and no-parallel-model scenarios)

## 6. Living contracts and persona

- [ ] 6.1 Sync the approved deltas exactly into `openspec/specs/spend-telemetry/spec.md` and `openspec/specs/member-app-core/spec.md`, preserving current-state language and checking every delta requirement/scenario for parity. (maps: ST8 contract-alignment scenario; MA1-MA3 all requirements)
- [ ] 6.2 Update `docs/TOOLS.md`, `docs/SCHEMAS.md`, and `docs/ARCHITECTURE.md` with the exact optional MCP/API ranges/defaults, shared fields/statuses/denominators/order, existing-column/index reads, tenant/read-only guarantees, and explicit read-time/no-analyzer-cron decision; add no migration entry or historical narration. (maps: ST1 contract; ST2-ST7 semantics; ST8 docs-alignment scenario)
- [ ] 6.3 Update `packages/worker/AGENT_INSTRUCTIONS.md` so `cooking-retrospective` knows when/how to act on read-only Spend aggregates and truthful partial/unavailable values, then run the parse-only generated-plugin check and confirm no generated bundle is edited. (maps: ST8 persona/plugin alignment scenario)

## 7. Focused implementation verification and scope handoff

- [ ] 7.1 Run focused Worker, app, UI, and visual-harness typechecks plus focused Vitest files for Spend, composed member API, registered cooking tool/profile compatibility, and any directly changed app unit tests; fix only failures attributable to this change. (maps: ST8 production-entry tests; MA2/MA3 adapter coverage)
- [ ] 7.2 Run the focused Retrospective Playwright spec and inspect desktop, tall, and narrow captures for accessible labels, readable cards/controls, horizontal weekly overflow, truthful states, and unchanged Waste; do not substitute this for the later full browser gate. (maps: MA1 responsive/accessibility scenarios; MA3 both scenarios)
- [ ] 7.3 Run `mise exec -- openspec validate spend-analyzer --strict` and confirm all checklist/spec references remain aligned; do not archive the change or mark later whole-repo gates, whole-PR review, CI, or PR work complete here. (maps: ST8 contract-alignment scenario)
- [ ] 7.4 Recount the complete merge-base diff. Stay within the frozen 24-34 files / 2,800-4,500 additions forecast; stop for approval at 43 or more files or above 5,625 additions, and also at more than 70 files or 7,000 additions. Report exact files/additions/deletions and any unresolved finding to the main thread before archive handoff. (maps: ST7 scope/non-goals; ST8 production-design requirement)
