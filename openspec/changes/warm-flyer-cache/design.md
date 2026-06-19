## Context

`kroger_flyer` ([`src/tools.ts:509`](../../../src/tools.ts)) synthesizes a sale list because the public Kroger API has no flyer/circular endpoint: it fans out one `kroger.search` per term across `PAGES = 2`, keeps fulfillable genuine discounts, and dedupes by `productId`. Each search is one **external subrequest**. On the Cloudflare Workers **free tier** a single invocation may issue at most **50 external subrequests** and gets ~**10ms of CPU** (waiting on I/O is free; JSON-parsing responses is not). As the term set (broad `flyer_terms` + per-tenant stockup) grows, one flyer call exceeds the cap — and even within it, the fan-out is multi-second latency on the user's hot path plus load on the public Kroger tier.

The determinism boundary (ADR 0001) is a `capture → retrieve → narrow` loop: classify/derive once on a cold path, retrieve deterministically on the hot path, let the LLM narrow with context. A scheduled flyer warm is another instance of exactly that pattern — the cron sweep is the **capture**, the agent's read is the **retrieve**.

## Goals / Non-Goals

**Goals:**
- `kroger_flyer` never issues an external subrequest on the hot path; it reads a warmed cache (one KV read).
- The background warm respects the free-tier per-invocation caps (50 external subrequests, ~10ms CPU) with no per-call ceiling on the total term set.
- Correct handling of **multiple stores** (different Krogers across tenants) and sharing for tenants at the same store.
- Stay within free-tier KV limits (≤1000 writes/day) and use no new bindings.

**Non-Goals:**
- Per-tenant stockup warming (deferred; lands with the place-groceries split change).
- Any live fan-out fallback for ad-hoc caller terms.
- Paid-tier features (Queues, Workflows, raised subrequest caps).
- Splitting `kroger_flyer`'s double duty — that is a separate change.

## Decisions

### 1. Relocate the fetch off the hot path: background warm + cache read

A synchronous tool call has exactly **one** invocation's 50-subrequest budget and a waiting user; it cannot spread work out. A background job has **unlimited invocations over time**, each with its own budget. So the cap is not raised — it is moved to where it stops binding. The agent's `kroger_flyer` becomes a KV read (a *Cloudflare-services* subrequest, counted against the separate 1000/invocation budget, not the 50 external). **Alternative — keep it live and just curate `flyer_terms` smaller:** still pays the full fan-out on every call, still hammers Kroger, still grows back into the cap. Rejected: curation improves signal, not the structural cost.

### 2. Orchestration: one cron + a KV cursor sweep

A **single** cron trigger fires on a short cadence (~every 2–3 min). Each tick reads a cursor from KV, runs the next batch of scan units, writes results, advances the cursor, and stops. When the cursor reaches the end of the unit list the sweep is complete; subsequent ticks are a cheap cursor read that **no-ops** until the refresh window opens, then reset + rebuild + re-sweep.

- **vs. multiple cron schedules (one per category):** the free tier allows only ~3 triggers/worker (and the docs are inconsistent about per-worker vs per-account). A single trigger sidesteps that ambiguity entirely and decouples total work from trigger count — more terms just means more ticks, never more schedules.
- **vs. Cloudflare Queues / Workflows:** both are now free-tier eligible and would give native retry/backpressure (Queues) or durable steps (Workflows), but each adds a binding and concepts. The cursor sweep is idempotent and resumable with zero new bindings; a failed tick simply resumes next tick. Reach for Workflows only if losing a partial sweep ever proves costly.
- The 1-minute cron floor is the only frequency limit and is irrelevant — we *want* batches minutes apart (it self-throttles Kroger). Min sweep time is `ceil(units/batch)` minutes, comfortably inside any daily/hourly refresh window.

### 3. Batch size bounded by the free-tier per-invocation caps

A tick runs **≤ ~25 Kroger scans** so it stays under **both** the 50-external-subrequest cap (leaving headroom for the token mint and any incidental calls) **and** the ~10ms CPU cap (each search parses ~20 products; ~25 keeps active compute safely under budget). The concurrency limiter already in the Kroger client (`Semaphore`, default 6) bounds in-flight requests within the tick; the batch *count* is what the cap cares about. Batch size is a tunable constant.

### 4. Cache shape: one per-location rollup, stored at the noise floor, filtered at read

The warm writes a **single materialized rollup per location** (`flyer:{locationId}`), not per-term keys.
- **Rollup vs per-term keys:** per-term keys would dedupe overlapping terms for free and allow incremental resumption, but cost one KV write per (term × location) — pressuring the 1000-writes/day budget — and force the hot path to read many keys. A rollup is one write per location per sweep and one read on the hot path. Chosen for the write budget and hot-path simplicity.
- **Store at the noise floor, not the judgment floor:** the rollup keeps every product that passes `isOnSale` + `isFulfillable` with **raw `regular`/`promo` preserved** — it does **not** pre-apply the 5% `MIN_FLYER_DISCOUNT`. `kroger_flyer` applies `min_savings_pct` at **read** time, so the caller's "what counts as a deal" knob survives the cache. The only cost is a slightly fatter rollup (includes sub-5% markdowns), which is fine for a cache. **Alternative — cache the already-filtered 5% list:** smaller, but breaks the caller-tunable threshold (e.g. 4% for a bulk stockup item). Rejected.

### 5. Per-location keying, shared across tenants → multiple Krogers handled by construction

Kroger sale prices are **store-specific** (the Products API returns `price.promo` keyed by `filter.locationId`), so the cache **must** be keyed by `locationId`. This directly answers the multi-Kroger question:

```
  tenant A → preferred_location → locationId X ─┐
  tenant B → preferred_location → locationId X ─┴─► flyer:X   (same store: ONE shared rollup)
  tenant C → preferred_location → locationId Y ───► flyer:Y   (different store: independent rollup)
```

The sweep's unit list is the **union of distinct `locationId`s across all tenants × the shared broad terms**. Two tenants at different Krogers get independent rollups; two at the same store share one (a higher hit rate, and the first deliberately shared *data-plane* cache). Sharing is sound because store-wide sale prices are public-derived, not tenant-private — consistent with the multi-tenancy isolation requirement. A newly-joined store appears in the next sweep's plan automatically (Decision 6), so it self-heals without redeploy; until then its read is a graceful empty (Decision 7).

### 6. Build the sweep plan once, persist it in KV

Enumerating the work means reading the **tenant directory + each tenant's store file + `flyer_terms.toml`** — all **external GitHub subrequests** that would otherwise eat the per-tick 50-budget and grow with tenant count. So the plan (resolved distinct `locationId`s × broad terms, as an ordered unit list) is built **once at sweep start** and **persisted in KV**. Every subsequent tick reads the plan from KV (a Cloudflare-services read, not an external subrequest) and spends its external budget only on Kroger scans. Plan-build is itself bounded; if a deployment ever has dozens of distinct stores whose label→`locationId` resolution exceeds one invocation, plan-build can be chunked too — an edge case, noted not solved.

### 7. `kroger_flyer` becomes a pure cache reader

New contract: `kroger_flyer(min_savings_pct?) → { items: FlyerItem[], as_of }`.
- Reads `flyer:{locationId}` for the caller's resolved location, applies `min_savings_pct` (default 5%) over the cached candidates, returns the surviving `FlyerItem[]` plus `as_of` (the sweep completion timestamp) so the LLM knows the flyer's age.
- **Removes** `terms` (ad-hoc) and `against_stockup` — the live fan-out is gone. These precise/per-tenant concerns move to the place-groceries skill flow under the separate split change.
- **Empty/cold cache → empty list, never an error**, mirroring today's absent-`flyer_terms` graceful degradation.
- Staleness is low-stakes because the order path **re-prices live** at fulfillment (cache-hit revalidation via `productById`, [`matching.ts:352`](../../../src/matching.ts); ARCHITECTURE.md:134). `as_of` lets the LLM caveat or defer a high-stakes buy.

### 8. Refresh cadence: daily, aligned to the weekly promo flip

Kroger promotions run a weekly (~Wednesday) cycle, so a **daily** sweep is more than fresh enough. Encoded as a UTC cron with the local offset. Tunable; hourly is possible but unnecessary and costs more KV writes.

### 9. Token, observability, forward-compat

- **Token:** re-mint per tick (one external subrequest of the 50). Separate cron invocations are separate isolates, so the in-memory token cache doesn't carry across ticks; persisting it in KV is a micro-optimization not worth the complexity at one-of-50.
- **Observability:** one structured `console.log` line per sweep (mirrors the `email()` handler precedent in `src/index.ts`). No alerting in v1 — a failed tick resumes next tick.
- **Forward-compat:** key the shared rollup as `flyer:{locationId}` so a later per-tenant stockup layer can add `flyer:{locationId}:{tenant}` (or similar) without reshaping existing keys.

## Risks / Trade-offs

- **Cold cache after deploy / new store** → graceful empty until the next sweep; self-heals within one refresh cycle (Decision 5/6). Acceptable for a serendipity scan.
- **Stale flyer price vs. live price** → order-time live re-pricing (`matching.ts:352`) is the backstop; `as_of` surfaces age to the LLM.
- **Cross-tenant shared cache** is a departure from strict per-tenant scoping → bounded to public-derived sale data; documented and blessed in `docs/ARCHITECTURE.md`. No tenant-private state is shared.
- **Plan-build subrequest cost grows with distinct store count** → fine for personal/small scale; chunkable if a large multi-store deployment ever appears.
- **KV write budget (1000/day free)** → rollup-not-per-term keeps writes to ~(locations + cursor updates) per sweep; a daily sweep is far under budget.
- **Loss of `against_stockup` / ad-hoc terms in `kroger_flyer`** → intentional; re-homed to the place-groceries flow. v1 is the broad serendipity flyer only.

## Migration Plan

1. Land the warm module + `scheduled()` handler + `triggers.crons` and the `kroger_flyer` cache-read contract together (the tool's live path is removed in the same change).
2. On first deploy the cache is cold; the first sweep populates it within one refresh cycle, and reads degrade gracefully to empty until then — no flag-day.
3. Deployment remains operator-run from the private data repo (`gh workflow run deploy.yml`), unchanged.
4. **Rollback:** revert the change; `kroger_flyer` returns to its live fan-out. The `flyer:` KV keys are inert cache entries that expire/idle harmlessly.

## Open Questions

None blocking — the cache shape (rollup, read-time filter), refresh cadence (daily), live-fallback (dropped), GitHub-once (plan persisted), and graceful degradation are all decided. Batch size and exact cron cadence are tunable constants to settle during implementation against observed sweep timing.
