## 0. Spikes (gate the design before coding)

- [ ] 0.1 Verify the AE **SQL API** shape against a live account: the `analytics_engine/sql` endpoint, the dataset table name, and that the analytics token's scope can read it (else document the extra scope)
- [ ] 0.2 Determine whether `env.AI.run` exposes a **per-call neuron/token cost** in its response — decides whether per-job neuron attribution is in scope or durations/counts only

## 1. Analytics Engine binding + merge allowlist

- [ ] 1.1 `wrangler.jsonc`: add the `analytics_engine_datasets` binding (`USAGE_AE`, dataset `grocery_usage`)
- [ ] 1.2 `src/env.ts`: add the `USAGE_AE: AnalyticsEngineDataset` binding (optional — unbound is a no-op)
- [ ] 1.3 `scripts/merge-wrangler-config.mjs`: add `analytics_engine_datasets` to the allowlist (verbatim-from-code, like `ai`/`assets`/`r2_buckets`)
- [ ] 1.4 `tests/*` (merge-config): assert the AE binding type survives the merge (the silent-drop regression guard)

## 2. Per-run emission

- [ ] 2.1 A shared `recordUsagePoint(env, job, { ok, durationMs, counts })` helper: `env.USAGE_AE?.writeDataPoint({ indexes:[job], blobs:[job, ok?"ok":"fail"], doubles:[durationMs, ...counts] })`, best-effort (swallow throws), tenant-clean
- [ ] 2.2 Call it from each job runner (`flyer-warm`, `recipe-classify`, `recipe-index`, `recipe-embed`, `discovery-sweep`, `email`) alongside the existing `job_health` write — same numbers, no per-tenant data
- [ ] 2.3 Document the dataset's **positional** slot layout (per-job `double` order) in `docs/SCHEMAS.md`
- [ ] 2.4 Test: emission shape (slots) + best-effort (unbound/throwing binding is a no-op that doesn't fail the job)

## 3. Trends data source + endpoint

- [ ] 3.1 `src/usage.ts`: an AE **SQL** client (`POST /accounts/<id>/analytics_engine/sql`, reuse `CF_ACCOUNT_ID` + analytics token); map rows → a per-job/per-day series; unconfigured → `{ configured: false }` (no request); failure → `upstream_unavailable`
- [ ] 3.2 `src/admin.ts`: `GET /admin/api/usage/trends` → the trends client; Access-gated; non-GET `unsupported`
- [ ] 3.3 Test: SQL-response → series mapping; the unconfigured short-circuit (no request)

## 4. Trends panel (Elm)

- [ ] 4.1 `admin/src/Usage.elm`: a Trends section (`WebData` + not-configured state), per-job last-N-days metrics (table/sparkline), styled with the existing Usage vocabulary
- [ ] 4.2 `admin/tests/UsageTest.elm`: decode a trends payload + the not-available state
- [ ] 4.3 Rebuild + commit `admin/dist/` (`aubr build:admin`)

## 5. Docs (lockstep)

- [ ] 5.1 `docs/ARCHITECTURE.md`: AE as the history tier alongside the `job_health` liveness tier; the emit→SQL→panel flow
- [ ] 5.2 `docs/SCHEMAS.md`: the `grocery_usage` AE dataset's positional slot contract + the `/admin/api/usage/trends` shape
- [ ] 5.3 `docs/SELF_HOSTING.md`: the AE binding is code-level (no operator config); note any extra analytics-token scope the AE SQL read needs
