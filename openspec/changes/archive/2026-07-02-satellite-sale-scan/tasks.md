Ordered so the store-namespacing + generalized read (§2–§3) land before the sale producer/consumer (§4–§7); implementation stays **serial** on the shared surfaces (`flyer-warm.ts`, the `FlyerItem` layer, the read tool, `scheduled()`, docs). No spike tasks — the design settled the rollup/schema/read-path unknowns against production.

## 1. Shared contract: the `sale` observation + `sale-scan` task shapes

- [x] 1.1 In `packages/contract/src/ingest.ts` add the `sale` arm to the `ObservationItem` discriminated union: `{ kind: "sale", store, locationId, productId, description, size?, regular, promo, brand?, categories?, url? }` — `store`/`locationId`/`productId`/`description` non-empty strings, `regular` a positive number, `promo` a non-negative number, `size`/`brand` optional strings, `categories` an optional string array, `url` an optional http(s) URL. **No `savings`/`savings_pct`/on-sale field.** Add `parseSaleObservation` (the satellite self-validates its emit with it).
- [x] 1.2 In `packages/contract/src/satellite-pull.ts` add the `sale-scan` task-payload shape `{ store, locationId, terms: string[] }` (the concrete first `kind`), keeping the channel's `TaskEnvelope.payload` opaque. Export the new symbols from `packages/contract/src/index.ts`.
- [x] 1.3 Contract tests: a `sale` observation round-trips; a `sale` with a `savings` field set is accepted structurally but the field is ignored/unmodeled (no wire savings); an implausible-but-structural `sale` still parses (plausibility is Worker-side); a `recipe`-only consumer is unaffected by the new arm.

## 2. Store-namespaced flyer rollup (generalize the key; Kroger writes `kroger`)

- [x] 2.1 In `packages/worker/src/flyer-warm.ts` generalize `rollupKey` to `rollupKey(store, locationId) = "flyer:{store}:{locationId}"`; the Kroger warm writes `flyer:kroger:{locationId}`. Keep `flyer:cursor`/`flyer:plan` as the Kroger sweep's internal state (unchanged). Extract the merge/replace + `FlyerItem` build into a store-agnostic helper reused by the sale intake (§4).
- [x] 2.2 Add a read-time legacy fallback for the Kroger namespace: `readStoreFlyer(store, locationId)` reads `flyer:{store}:{locationId}` and, for `store === "kroger"`, falls back to the legacy `flyer:{locationId}` when the namespaced key is absent — no cold gap on deploy, no data migration. Optionally reap orphaned legacy keys best-effort in the warm.
- [x] 2.3 Update the Kroger warm's `publish`/`readFlyerRollup` call sites to the namespaced key; keep the rollup value shape `{ sweep_id, as_of, items }` (add a `store`/`location_id` marker as needed for the shared helper).

## 3. Generalized read: `store_flyer` (+ `kroger_flyer` namespaced key)

- [x] 3.1 Add the `store_flyer(min_savings_pct?)` MCP tool in `packages/worker/src/tools.ts`: resolve the caller's primary fulfillment store (slug + location from `profile.stores`), read its `flyer:{store}:{locationId}` rollup via `readStoreFlyer`, apply `min_savings_pct` at read (default 5%, `filterByMinSavings`) and the staleness ceiling for a satellite-scanned store, return `{ items, as_of }`. Cold/stale/absent → empty `items`, never an error. No external subrequest.
- [x] 3.2 Point `kroger_flyer` at `readStoreFlyer("kroger", locationId)` (the legacy fallback lives there); its `{ items, as_of }` contract + description otherwise unchanged.
- [x] 3.3 Add the staleness ceiling as an `operator_config` knob (default ~7 days), applied to satellite-scanned rollups only (Kroger keeps its cron-refresh freshness). *(Realized as a compiled `scanStalenessDays` default on `OperatorConfig` — no D1 column/migration in this change, per the no-migration invariant; a later change wires the column + save/validate path.)*

## 4. Sale observation intake (dispatch by `kind` → the store rollup)

- [x] 4.1 In `packages/worker/src/ingest.ts` make `intakeObservations` dispatch by observation `kind`: `recipe` → the existing `ingest_candidates` path (unchanged); `sale` → the new sale arm. Preserve the shared per-item-validation + arrival-dedup contract (no re-implementation) so `/satellite/results` lands `sale` observations through the same intake as `/admin/api/ingest`.
- [x] 4.2 Implement the `sale` arm: per-item plausibility (§6) → drop `!isOnSale` (as the Kroger scan does) → group by `(store, locationId)` → build `FlyerItem`s with the Worker-re-derived `savings` (reuse the §2.1 helper) → **replace** each store's `flyer:{store}:{locationId}` rollup with the observed set at a fresh `as_of`. Idempotent (arrival dedup by `productId` within the store); per-item dispositions echo `productId`/`url`.
- [x] 4.3 Worker tests: a `sale` batch replaces the store rollup; a late/double report dedups to the same rows; a mixed recipe+sale results report routes each arm correctly; a `sale` results report for a `sale-scan` task lands via `/satellite/results` end-to-end.

## 5. The scan-plan producer (a `scheduled()` sibling)

- [x] 5.1 Add `packages/worker/src/sale-scan-plan.ts` with a testable `runSaleScanPlanJob(env, deps)` over injected deps (tenant directory, `profile.stores` reader, `flyer_terms` reader, the enqueue, a KV cursor, `now`). Build the plan: distinct **non-Kroger** `(store, locationId)` from tenants' primary/preferred stores × `flyer_terms`; enqueue one operator-scope `sale-scan` task per pair (`dedup_key = "sale-scan:{store}:{locationId}"`, `scope: "operator"`, `tenant: null`) via the change-2 `enqueueTask`. Enqueue-only — no external subrequest.
- [x] 5.2 Refresh-gate via a KV `sale-scan:cursor` (`{ last_refresh_at }`, mirroring `flyer:cursor`); run a fresh cycle only when due (default aligned to the flyer daily cadence, `operator_config`-tunable), else a cheap no-op. Empty plan → clean no-op.
- [x] 5.3 Prune terminal (`done`/`failed`) `sale-scan` rows past a small age each cycle (through `src/db.ts`) so the recurring queue stays bounded.
- [x] 5.4 Wire `runSaleScanPlanJob` into the single `scheduled()` handler as a `Promise.allSettled` sibling (its own phase entry, beside `runWarmJob`); write a `sale-scan-plan` `job_health` + `job_runs` record; add `"sale-scan-plan"` to `HEALTH_JOBS` in `src/health.ts`.

## 6. Sensor validation for `sale` (equal-or-stricter, provenance)

- [x] 6.1 Add a Worker-side `validateSale` (called in the §4.2 arm): keep only `0 < promo < regular`; reject out-of-range `regular`/`promo` (absolute ceiling); reject a re-derived markdown > ~95%; require `size` to parse via the existing unit-price parser or be null. Reject **per-item** with a reason, never sinking the batch.
- [x] 6.2 Retain provenance (`productId`, product `url` when present) on the `FlyerItem` so a claim is spot-checkable. Add a code comment noting change 5's sensor-audit would sample these `sale` claims (no sampling built here).
- [x] 6.3 Tests: plausibility rejects (`promo>=regular`, >95% markdown, out-of-range price, unparseable size) are per-item; a valid batch with one bad item still lands the rest.

## 7. Satellite package: pull client + `sale-scan` adapter

- [x] 7.1 Add a pull-channel client in `packages/satellite/src/` (e.g. `pull.ts`): claim `POST /satellite/tasks/claim` (`capabilities: ["sale-scan"]`, ingest key), dispatch each claimed task to its adapter, report `POST /satellite/results` (`sale` observations or a `failed` reason). Strictly outbound-only; reuse the push transport/backoff idioms.
- [x] 7.2 Add a `SaleScanAdapter` interface parallel to `SourceAdapter` (`scan(sdk, { store, locationId, terms }) → SaleObservation[] | { error }`) over the shared SDK (tiered fetch + captured session + logger); validate each emit with `parseSaleObservation` before reporting (no non-contract shape, no derived saving on the wire). Load operator adapters from the mounted `adapters_dir`; **ship no built-in named-retailer adapter**.
- [x] 7.3 Extend `packages/satellite/src/config.ts` so a machine can declare it runs `sale-scan` and map a store → its scan adapter module; extend the CLI `test` verb to dry-run a sale adapter against a store/location/terms, printing + locally validating the `sale` observations it would report.
- [x] 7.4 Satellite tests (fixture-based, no live source): the pull client claims → runs a fake adapter → reports; an adapter emitting a non-contract shape (or a `savings` field) is rejected locally and not reported; `test` prints validated observations without reporting.

## 8. Persona: menu-gen store-aware flyer pre-pass

- [x] 8.1 Update `AGENT_INSTRUCTIONS.md` menu-gen pre-pass: include the store-aware flyer read for the caller's primary store when it has a warmed flyer (`kroger_flyer` for Kroger, `store_flyer` for a satellite-scanned store); omit when neither exists. Generalize sale-steering — Kroger keeps the `kroger_prices` unit-price cross-check; a scanned store steers on the Worker-re-derived markdown (no cross-brand API). Validate conversationally.

## 9. Docs in lockstep

- [x] 9.1 `docs/SCHEMAS.md`: the store-namespaced rollup `flyer:{store}:{locationId}` (Kroger writes `kroger`; legacy `flyer:{locationId}` fallback), the `sale-scan:cursor` KV marker, and the `sale` observation + `sale-scan` task-payload wire shapes.
- [x] 9.2 `docs/ARCHITECTURE.md`: the sale-scan loop beside the flyer warm + pull channel (producer enqueues → satellite claims/scans → `sale` observations → store rollup → `store_flyer`); the cross-tenant data plane generalized from Kroger-only to all stores; the sale intake as the first non-recipe arm of the shared raw-observation intake; the `sale-scan-plan` cron sibling.
- [x] 9.3 `docs/TOOLS.md`: add `store_flyer` (store-aware read, `{ items, as_of }`); note `kroger_flyer` reads the `kroger`-namespaced key (contract unchanged).

## 10. Admin coverage: the `sale-scan-plan` job row

- [x] 10.1 Extend the admin Status Playwright coverage under `admin/visual/`: seed a `sale-scan-plan` `job_health` row (healthy + never-run), assert the Status card renders it, run `aubr test:admin` (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), surface the per-area screenshot. Data-only addition to the existing registered-jobs render (no new design; no companion-Claude-Design pass needed). *(Seed + spec added and typecheck-clean; the Playwright runner hit a pre-existing sandbox harness/version error unrelated to this change — CI's blocking admin-ui gate runs it.)*

## 11. Verification

- [x] 11.1 `aubr typecheck` + `aubr test` + `aubr test:tooling` green (contract, worker, satellite suites cover the new loop). *(Run as `pnpm -r typecheck`, worker vitest 1826 passed on default + CI Node 22.17.1, satellite 76 passed, tooling `node --test` 102 passed.)*
- [x] 11.2 Acceptance fixture (the change's convergence check): seed a non-Kroger `target` store + a tenant primary + an operator-authored fake sale adapter; drive producer → claim → scan → `sale` results → `store_flyer` end-to-end; assert satellite sales read identically to Kroger sales and the store-namespaced convergence holds. *(`test/sale-scan-acceptance.test.ts`.)*
- [ ] 11.3 On deploy (no `--remote` KV write from this environment): verify the Kroger legacy-key fallback serves reads until the first namespaced sweep, then the namespaced `flyer:kroger:{locationId}` keys appear — verified against the current production `flyer:{locationId}` rollup rows.
- [x] 11.4 `openspec validate "satellite-sale-scan" --strict` passes; run `/code-review` on the diff before opening a PR. *(openspec strict validation passes; `/code-review` is the main thread's follow-up.)*
