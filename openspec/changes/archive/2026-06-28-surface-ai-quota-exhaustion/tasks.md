## 1. Classify-pass failure handling

- [x] 1.1 `reconcileRecipeFacets` distinguishes transient (`storage_error`/AI) vs permanent (`validation_failed`) failures — transient leaves the gate un-advanced (retry), permanent parks (`upsertEmpty`); quota (4006) stops the tick early and flags `quotaExhausted`
- [x] 1.2 Result type + `recipe-classify` health summary carry `classified`/`pending`/`parked`/`errored`/`pruned`/`quota_exhausted`; the job reports `ok: !quotaExhausted`
- [x] 1.3 Unit tests for transient (no gate advance), permanent (park), and quota (no rows, flagged) paths

## 2. Health signal

- [x] 2.1 `src/health.ts`: `isAiQuotaError` (4006 / neurons match), `ai_quota_exhausted` on the payload, aggregated from job summaries, degrades `ok`
- [x] 2.2 `/health.svg`: an explicit `ai  quota exhausted` row (red) when flagged
- [x] 2.3 Tests: aggregation from a 4006 error string and from an explicit `quota_exhausted` flag; healthy-jobs negative; the SVG row

## 3. Admin Status UI

- [x] 3.1 `admin/src/Status.elm`: decode `ai_quota_exhausted` (back-compat default false), render an explicit red "Workers AI quota exhausted" banner
- [x] 3.2 `admin/tests/StatusTest.elm`: decode true + the back-compat default; rebuild the committed `admin/dist/`

## 4. Docs

- [x] 4.1 `docs/ARCHITECTURE.md`: the explicit quota signal in background-job-health + the classify pass's transient-vs-permanent failure handling
