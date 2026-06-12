## Context

Independent async work is awaited sequentially in 10 places. Parallelizing is mechanically simple except for one real constraint — the Kroger client has no concurrency limiter — and one correctness obligation — output must stay deterministic.

## Decisions

### 1. The concurrency cap lives in the Kroger client, not at each call site

Decided with the maintainer. Centralizing the limit in `authedGet` — where 429 handling already lives — keeps call sites clean (`Promise.all`) and makes it physically impossible for a future caller to burst Kroger. The alternative (a per-site `mapPool(items, limit, fn)` helper) is more visible but repetitive and regression-prone: every new fan-out site must remember to use it.

### 2. Placement: per-client closure (recommended) over module-level

`createKrogerClient` is called once per request in `buildServer`. A semaphore created **inside** `createKrogerClient` bounds concurrency **within a request** — which is exactly the fan-out problem (one flyer call = one client = ≤ N in flight). Recommended because it has **no shared mutable state across requests**, is trivially testable (inject a low limit + a counting fake `fetch`), and needs no reset hook.

- **Alternative — module-level** (like the existing `moduleCache` token/location): bounds total Kroger concurrency **per isolate**, protecting the upstream even when two tenants' requests overlap in one isolate. More protective, but adds cross-request coupling and a reset path. Adopt only if cross-request 429s actually appear — the 429 backoff already covers that case.

### 3. Permit count: a small constant, injectable, with 429 retry as backstop

Start at **6** — conservative relative to Kroger's undocumented per-second tolerance, while still collapsing a 30-term flyer from ~30 serial round-trips to ~5 waves. Exposed as `createKrogerClient(env, { maxConcurrency })` so tests pin it low. A request keeps its permit **through** its 429 `Retry-After` sleep — intentionally, so a rate-limited call doesn't invite more load while it waits.

### 4. Determinism: consume the ordered results, never race shared state

The universal rule for every parallelized site: `const r = await Promise.all(items.map(fn))`, then build the output by iterating `r` **in order**. `Promise.all` already guarantees result-position order regardless of completion order, so this is "don't reintroduce nondeterminism," not extra work. Concretely:

- `kroger_flyer` — see §6: switching to `matched_terms[]` keeps every term per product, so there is **no** order-dependent output left to preserve (the term-order merge is gone).
- `placeOrder` resolve — `map` lines → `Promise.all` → partition into `resolved` / `checkpoint` in line order.
- `proposeSale`, `verify_pantry_for_candidates`, note aggregation, `fetch_rss` — filter/flatten the ordered array; never `push` into a shared array from inside a parallel task.

### 5. GitHub/RSS fan-outs stay unbounded

`verify_pantry_for_candidates` (a few recipe reads), the note aggregations (a handful of group members), and `fetch_rss` (distinct external domains) are low-volume and/or hit different hosts. Plain `Promise.all`, no semaphore. If GitHub secondary limits ever bite, the same `semaphore.ts` util can wrap a GitHub client later.

### 6. `kroger_flyer` attribution + discount threshold (folded-in contract change)

The dedup itself is legitimate **entity** hygiene — no sibling tool returns the same SKU twice. But two parts of flyer's current behavior are worth correcting:

- **Lossy attribution → `matched_terms[]`.** `matched_term` keeps only the first term that surfaced a product. The ordering isn't arbitrary (precise terms iterate before broad — [tools.ts:585](src/tools.ts:585) — so a stockup match wins over a category match), but collapsing to one term discards the rest. Returning **every** surfacing term (`matched_terms`) is more faithful to "return facts, let the LLM reason," and it removes the parallel-merge ordering dependency (§4).
- **The 5% floor is the one real judgment in the tool.** `isFulfillable` and `isOnSale` (drop `promo == regular` echoes) are noise hygiene by any standard and stay. But `MIN_FLYER_DISCOUNT = 5%` is a value line the caller could own — for a bulk stockup item, 4% off might be worth it. Expose it as a `min_savings_pct` filter (default 5%, backward-compatible): the noise floor stays in the tool, the deal threshold moves to the caller.

Deliberately **not** doing: dropping the discount floor entirely / returning every penny markdown. Flyer is an open-ended scan with no query key, so an unfiltered sweep over dozens of broad terms × 2 pages is mostly junk — the default floor is what keeps the output signal.

## What stays sequential (and why)

- [`matching.ts:352`](src/matching.ts:352) — cache-hit revalidation returns on the **first** fulfillable hit in priority order (same-location first); parallelizing wastes `productById` calls and complicates "first wins." The list is usually 1 entry.
- [`write-tools.ts:662`](src/write-tools.ts:662) — RTE draft slug-minting depends on the accumulated `taken` set (`while (taken.has(...))`).
- `kroger.ts` / `github.ts` / `commit.ts` / `email.ts` redirect — retry/backoff/redirect loops are causally sequential.

## Risks / open

- The limit value is a guess at Kroger's burst tolerance; mitigated by 429 backoff + being a one-line tunable constant.
- Holding a permit during a long `Retry-After` could briefly idle a slot — acceptable (it's the throttle-don't-pile-on direction).
