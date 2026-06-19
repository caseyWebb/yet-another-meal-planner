## 1. Cache model & shared helpers

- [ ] 1.1 Define the KV key scheme and value shapes in a new `src/flyer-warm.ts` (or a small `src/flyer-cache.ts`): per-location rollup `flyer:{locationId}` (noise-floor candidates with raw `regular`/`promo` + `matched_terms` + `as_of`), the sweep cursor `flyer:cursor`, and the persisted plan `flyer:plan` — all under the existing `KROGER_KV` binding, no new binding.
- [ ] 1.2 Define the `FlyerRollup` / cached-candidate types (reuse `FlyerItem` from `src/matching.ts`; add `as_of`). Decide the at-rest shape so `min_savings_pct` can be applied at read without re-fetching.
- [ ] 1.3 Add a read helper `readFlyerRollup(kv, locationId)` returning `{ items, as_of }` or an empty/null result when the key is absent (graceful cold cache).

## 2. Warm sweep core (capture)

- [ ] 2.1 Implement plan-build: read the tenant directory + each tenant's store file + shared `flyer_terms.toml` once, resolve the **distinct** set of `locationId`s (union of `preferred_location`s), cross with broad terms → an ordered unit list; persist it to `flyer:plan` in KV.
- [ ] 2.2 Implement the cursor: read `flyer:cursor` (sweepId, index, lastCompletedAt); on a fresh/expired sweep reset index and rebuild the plan; advance by the batch each tick.
- [ ] 2.3 Implement batch execution: run the next ≤BATCH (tunable, ~25) units' Kroger searches bounded by the existing client `Semaphore`, filter to the **noise floor** (`isOnSale` + `isFulfillable`, no 5% floor), merge into per-location rollups, and write each touched `flyer:{locationId}` (idempotent write).
- [ ] 2.4 Implement idle no-op + refresh re-arm: when the cursor is at the end and the refresh window (default daily) is not due, return after a cheap cursor read with no external subrequests/writes; when due, reset and re-sweep.
- [ ] 2.5 Stamp each rollup with the sweep's `as_of` at completion, and emit one structured `console.log` summary line per sweep (locations, units, errors) mirroring the `email()` handler precedent.
- [ ] 2.6 Ensure a failed tick does not advance the cursor past unwritten work (resumable; idempotent rollup writes make re-processing safe).

## 3. Wire the schedule

- [ ] 3.1 Add a single `triggers.crons` schedule to `wrangler.jsonc` (short cadence, e.g. every 2–3 min) with a comment explaining the cursor-sweep + daily-refresh model and the UTC/local offset.
- [ ] 3.2 Add a `scheduled(controller, env, ctx)` handler to the default export in `src/index.ts` (alongside `fetch`/`email`) that invokes the warm tick; keep it thin and log-on-error.

## 4. `kroger_flyer` → pure cache reader

- [ ] 4.1 Rewrite `kroger_flyer` in `src/tools.ts`: resolve the caller location, read `flyer:{locationId}`, apply `min_savings_pct` (default 5%) at read over the noise-floor rollup, return `{ items, as_of }`.
- [ ] 4.2 Remove the `terms` and `against_stockup` params and the live fan-out (`flyerFilterShape` reduces to `min_savings_pct`); cold/absent cache returns `{ items: [], as_of: null }` without error.
- [ ] 4.3 Update the tool description to reflect cache-read semantics, the `as_of` freshness signal, and that precise/stockup scanning has moved to the place-groceries flow.

## 5. Tests

- [ ] 5.1 Unit-test plan-build (distinct-location dedup across tenants; same-store sharing; empty `flyer_terms` → empty plan) with injected fake GitHub/Kroger reads.
- [ ] 5.2 Unit-test the sweep: a batch stays ≤BATCH units; multi-batch sweeps advance the cursor and complete; idle ticks no-op; refresh re-arms; failed tick resumes — using the Kroger client's injectable `fetch`/`cache`/`now` plus a fake KV.
- [ ] 5.3 Unit-test `kroger_flyer` read path: served-from-cache (no external subrequest), read-time `min_savings_pct` filtering over a noise-floor rollup, cold-cache graceful empty, `as_of` passthrough.
- [ ] 5.4 Manual verification via `wrangler dev --test-scheduled` (`/__scheduled`) against a fake/recorded Kroger response.

## 6. Docs (same pass — no drift)

- [ ] 6.1 `docs/TOOLS.md`: update the `kroger_flyer` contract (params, return `{ items, as_of }`, cache-read, removed `terms`/`against_stockup`).
- [ ] 6.2 `docs/ARCHITECTURE.md`: add the scheduled cold-path warm as a `capture` step in the determinism-boundary framing; document the per-location cache and bless the first deliberately shared cross-tenant data-plane cache as public-derived.
- [ ] 6.3 `docs/SCHEMAS.md`: note `flyer_terms.toml` now feeds the warm job; document the KV flyer-cache value shape.
- [ ] 6.4 `docs/SELF_HOSTING.md`: note the cron exists and the free-tier posture (one trigger, cursor sweep, daily refresh).
- [ ] 6.5 (Optional) Add a short ADR for the scheduled-capture pattern.

## 7. Ship

- [ ] 7.1 `npm run build:plugin` if any tool surface in the persona/skills references the changed `kroger_flyer` contract; run the full test + typecheck suite.
- [ ] 7.2 After merge to `main`, operator kicks the deploy from the private data repo (`gh workflow run deploy.yml`); confirm the first sweep populates `flyer:{locationId}` and `kroger_flyer` reads it.
