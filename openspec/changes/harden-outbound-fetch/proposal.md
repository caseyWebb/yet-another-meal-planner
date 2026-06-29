## Why

Four open issues (#53, #54, #55, #67) all trace to one unhardened primitive: `fetchWithBrowserHeaders` in `src/http.ts` does `fetch(url, { redirect: "follow" })` with no scheme/host validation, no timeout, and no body cap. Every server-side egress flows through it — the LLM-supplied `parse_recipe(url)`, the background sweep's feed and recipe-page fetches, and the operator feed-probe — so the same gaps recur as a blind-SSRF oracle (a benign host can 30x-redirect to an internal target), a hung host that stalls the whole batch, and an unbounded body read. Separately, the sweep's feed fan-out is the one external-fetch path that bounds nothing: it fetches **every** feed each tick via `Promise.all`, and at the current dozen feeds that already collides with the free-tier ~50-subrequest-per-invocation budget shared with the flyer warm.

These are cheap to fix together because they share one chokepoint, and they are exactly the "coarse, opinionated" boundary the repo already favors: harden the primitive once and all three callers inherit it.

> **Note for the implementer:** the issues' line references are **stale**. They cite `fetch_rss_discoveries` at `src/discovery-tools.ts:70-85`; that tool was retired when discovery became autonomous. The feed-fetch loop now lives in the background sweep's `loadCandidates` (`src/discovery-sweep.ts:725-738`). The vulnerabilities are unchanged, only relocated.

## What Changes

- **Harden the shared fetch primitive.** Before connecting, validate the URL is `http:`/`https:`, carries no userinfo, and resolves to a non-private host (reject loopback / link-local / RFC-1918 / unique-local literals); follow redirects **manually** with the same validation re-applied on every hop (bounded hop count); enforce a per-request timeout via `AbortSignal`; and cap the bytes read before parsing. All three callers (`parse_recipe`, the sweep's feed + recipe-page fetches, the operator probe) inherit this through `fetchWithBrowserHeaders` / `acquireRecipeContent`.
- **No status oracle.** A target blocked by the guard, or one that times out, surfaces as a generic `unreachable` with no upstream status — indistinguishable from a dead host, so a writer/LLM cannot use it to probe internal reachability.
- **Bound the feed fan-out with a rotation cursor.** Replace the all-feeds-every-tick `Promise.all` with a per-tick bounded batch of `K` feeds advanced by a persisted cursor (the flyer-warm pattern), so the feed set can grow add-only without ever exceeding the external-fetch budget; un-polled feeds are picked up on later ticks. `K` (`feedFetchMaxPerTick`) joins the existing `DiscoveryConfig` per-tick caps.
- **Validate feed URLs at write time.** `update_feeds` and the operator feed editor (both write through `addFeedRows`) reject a non-public / non-http feed URL with `validation_failed`, so a bad URL is never stored — fail-fast in addition to the load-bearing fetch-time guard.

## Capabilities

### New Capabilities
- `outbound-fetch-safety`: the egress invariants every server-side fetch of an externally-influenced URL must satisfy — scheme/userinfo/private-host validation, manual redirect re-validation, per-request timeout, capped body read, no internal-reachability oracle — plus the rule that URLs persisted for later fetch are validated with the same guard at write time.

### Modified Capabilities
- `discovery-sweep`: the feed-poll half of the existing "bound work per tick on the external cap via a cursor-swept bounded batch" requirement is made real — feeds are polled in a per-tick bounded batch advanced by a persisted rotation cursor, not fanned out wholesale.
- `recipe-discovery`: `update_feeds` rejects a non-public-http feed URL at write time (`validation_failed`); `parse_recipe` surfaces a guard-blocked URL as `unreachable` rather than probing it.
- `operator-admin`: the shared-corpus feed editor endpoint likewise rejects a non-public-http feed URL (the same `addFeedRows` guard).

## Impact

- **Code:** `src/http.ts` (primitive), `src/url.ts` (the pure `assertPublicHttpUrl` guard — already the dependency-free URL helper home), `src/discovery-sweep.ts` (`selectFeedBatch` + KV cursor in `loadCandidates`, `feedFetchMaxPerTick` in `DiscoveryConfig`/`DEFAULT_CONFIG`), `src/discovery-probe.ts` + `src/recipe-acquire.ts` (inherit the primitive + capped read), `src/corpus-db.ts` (`addFeedRows` write-time guard), `src/discovery-tools.ts` (`update_feeds` reject surface).
- **State:** one new ephemeral KV key (`discovery:feed-cursor` in `KROGER_KV`, the namespace the flyer cursor already uses). No D1 migration.
- **Config:** `feedFetchMaxPerTick` added to `DiscoveryConfig` (operator-tunable via the existing `loadDiscoveryConfig` override); calibrated against the residual external-fetch budget (`flyer + recipe-page + K ≤ ~50`).
- **Docs:** `docs/TOOLS.md` (`update_feeds` reject reason), `docs/ARCHITECTURE.md` (the egress guard + sweep feed-rotation).
- **Dependencies:** none added (pure-JS URL parsing + `AbortSignal`).
- **Known limit:** on Workers a host guard catches literal private targets and redirect hops but cannot pre-resolve DNS, so a public name that resolves to a private address is not caught — consistent with the issues' medium/low severities (Workers has no co-located metadata/loopback service).
