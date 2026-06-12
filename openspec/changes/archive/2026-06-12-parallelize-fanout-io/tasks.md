## 1. Concurrency primitive + Kroger client cap

- [x] 1.1 Add `src/semaphore.ts`: a counting `Semaphore` (`acquire()` / `release()`, FIFO `waiters`) + a `withPermit(sem, fn)` helper that releases in `finally`. Unit test: peak in-flight ≤ N under a burst.
- [x] 1.2 Wrap `authedGet` in [`kroger.ts`](src/kroger.ts) with a per-client semaphore; add `maxConcurrency` (default 6) to `createKrogerClient` opts. The permit spans the whole retry loop (held through backoff).
- [x] 1.3 Test: a counting fake `fetch` asserts in-flight never exceeds `maxConcurrency` across a fan-out; `search` / `productById` are gated (both route through `authedGet`).

## 2. Parallelize Kroger fan-out (bounded by §1)

- [x] 2.1 `kroger_prices` ([tools.ts:530](src/tools.ts:530)) — `Promise.all` over ingredients; preserve order.
- [x] 2.2 `kroger_flyer` ([tools.ts:590](src/tools.ts:590)) — `Promise.all` across **terms** (keep the ≤2-page sequential loop + break-on-empty inside each term); dedup by `productId` into `matched_terms: string[]` (every surfacing term — no order dependency; supersedes the old first-term-wins `matched_term`).
- [x] 2.3 `ready_to_eat_available` ([tools.ts:633](src/tools.ts:633)) — `Promise.all` over catalog items; bucket by meal from the ordered results.
- [x] 2.4 `placeOrder` resolve ([order.ts:215](src/order.ts:215)) — `map` lines → `Promise.all(deps.resolve)` → partition `resolved` / `checkpoint` in line order. (Cache read once up-front, commit after the loop — already safe.)
- [x] 2.5 `proposeSale` ([substitutions.ts:110](src/substitutions.ts:110)) — `Promise.all` the per-substitute `isOnSale`; filter the ordered array.
- [x] 2.6 `kroger_flyer` discount floor — add `min_savings_pct` to `flyerFilterShape` (default 5%); thread it into `isFlyerWorthy` in place of the hardcoded `MIN_FLYER_DISCOUNT` (5% stays the default). `isFulfillable` + `isOnSale` (fake-sale echo) stay unconditional.
- [x] 2.7 Output-equivalence tests for 2.1, 2.3–2.5 (identical to the serial version on fixed fixtures). For 2.2 / 2.6: assert the new shape — `matched_terms[]` carries all surfacing terms; the default `min_savings_pct` reproduces today's 5% set; a lower `min_savings_pct` widens it.

## 3. Parallelize GitHub/RSS fan-out (plain Promise.all)

- [x] 3.1 `verify_pantry_for_candidates` ([tools.ts:712](src/tools.ts:712)) — `Promise.all` the per-slug `getRecipeIngredients`; aggregate in slug order.
- [x] 3.2 `read_recipe_notes` ([notes-tools.ts:101](src/notes-tools.ts:101)) + `read_store_notes` ([notes-tools.ts:244](src/notes-tools.ts:244)) — `Promise.all` across tenant ids; build `perTenant` in directory order.
- [x] 3.3 `fetch_rss_discoveries` ([discovery-tools.ts:68](src/discovery-tools.ts:68)) — `Promise.all` the per-feed fetch+parse; flatten `entries` / `skipped` in feed order; an unreachable feed still lands in `skipped`.

## 4. Spec + docs + verify

- [x] 4.1 Apply the `kroger-integration` spec delta (client concurrency-cap requirement + the modified `kroger_flyer` scan requirement).
- [x] 4.2 Update `docs/TOOLS.md` for the `kroger_flyer` contract — `matched_terms[]` return field (was `matched_term`) and the `min_savings_pct` filter param. (No `docs/SCHEMAS.md` change — no data-file change.)
- [x] 4.3 Optional one-line `docs/ARCHITECTURE.md` note on the client concurrency cap.
- [x] 4.4 `openspec validate parallelize-fanout-io --strict`; typecheck; full test suite green.
