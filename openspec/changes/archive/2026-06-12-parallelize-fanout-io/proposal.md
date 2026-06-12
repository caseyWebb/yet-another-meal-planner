## Why

Several tools issue **independent** network calls **sequentially**, so latency scales linearly with the list length:

- [`kroger_flyer`](src/tools.ts:590) awaits each `term × page` Kroger search one at a time — dozens of round-trips per call (the worst offender).
- [`kroger_prices`](src/tools.ts:530) and [`ready_to_eat_available`](src/tools.ts:633) run one search per item, in series.
- [`placeOrder`](src/order.ts:215) resolves each to-buy line one at a time (each line = a matcher run = 1–2 Kroger calls).
- [`proposeSale`](src/substitutions.ts:110) checks each substitute's sale status in series.
- GitHub/RSS fan-outs: [`verify_pantry_for_candidates`](src/tools.ts:712), [`read_recipe_notes`](src/notes-tools.ts:101), [`read_store_notes`](src/notes-tools.ts:244), [`fetch_rss_discoveries`](src/discovery-tools.ts:68).

Every one of these does work whose iterations don't depend on each other — prime candidates for concurrency. The catch: [`kroger.ts`](src/kroger.ts:140)'s `authedGet` has 429-retry backoff but **no concurrency limiter**, so a naive `Promise.all` over flyer's ~30 terms would burst ~60 simultaneous requests and trigger self-inflicted 429 storms — slower than serial in the worst case. So the fix is two-part: **bound Kroger concurrency at the client**, then **parallelize the fan-out sites** — preserving each tool's output (byte-identical for the nine pure-perf sites; `kroger_flyer` additionally gets a small, deliberate contract improvement folded in — see below).

## What Changes

- **Counting semaphore in the Kroger client.** A small concurrency cap inside [`kroger.ts`](src/kroger.ts) `authedGet` (the single choke point for `search`, `productById`, `resolveLocationId`). Callers fan out with plain `Promise.all` and are bounded automatically — regression-proof against a future careless caller. The existing 429 backoff stays as the backstop.
- **Parallelize 10 fan-out sites** (6 Kroger, 4 GitHub/RSS), in every case by mapping to `Promise.all` and then consuming the **ordered results array** — never racing into shared mutable state — so outputs match today's exactly.
- **`kroger_flyer` contract fix (folded in).** Replace the lossy single `matched_term` with `matched_terms: string[]` — every term that surfaced a product, so the caller can tell a stockup/menu match from a broad-category one. This also removes the parallel-merge ordering concern entirely (nothing order-dependent left). And expose the discount floor as a `min_savings_pct` filter param (default 5%, preserving today's behavior), moving the "what counts as a deal" judgment to the caller while the noise filters (fake-sale echo, penny markdowns) stay hygiene in the tool.
- **Leave intentionally-sequential loops alone:** the matcher's cache-hit revalidation ([`matching.ts:352`](src/matching.ts:352), short-circuits on first hit), RTE slug-minting ([`write-tools.ts:662`](src/write-tools.ts:662), depends on accumulated state), and all retry/backoff/redirect loops.

## Capabilities

### Modified Capabilities

- `kroger-integration`:
  - the `client_credentials` API client now **bounds its own concurrent in-flight requests** to a small fixed limit — a new client invariant alongside token caching and 429 backoff.
  - `kroger_flyer` now returns **all** matching terms per product (`matched_terms[]`, was a single first-wins `matched_term`) and accepts a **`min_savings_pct`** filter (default 5%) so the caller owns the discount threshold.

## Impact

- **Worker (`src/`):** new tiny concurrency util (`semaphore.ts`); `kroger.ts` wraps `authedGet` (per-client cap, injectable for tests); parallelize call sites in `tools.ts` (3 tools), `order.ts`, `substitutions.ts` + its tool wiring, `discovery-tools.ts`, `notes-tools.ts`.
- **Behavior:** the nine non-flyer sites are unchanged — same results, ordering, and structured errors, only faster (output-equivalence tests). `kroger_flyer` changes deliberately: `matched_term` → `matched_terms[]`, plus a new optional `min_savings_pct` whose 5% default preserves today's discount floor. Plus a concurrency-cap test (max in-flight ≤ N — the demo pattern).
- **Docs:** `kroger-integration` spec delta (client cap + flyer scan). `docs/TOOLS.md` updated for the flyer contract (`matched_terms[]` return + `min_savings_pct` param). No `docs/SCHEMAS.md` change (no data-file change); an optional one-line `docs/ARCHITECTURE.md` note on the client cap.
- **Risk:** the limit value is an estimate of Kroger's undocumented burst tolerance; the 429 backoff remains the backstop and the value is a one-line constant to tune. GitHub/RSS fan-outs stay unbounded (handful of items, distinct hosts).
