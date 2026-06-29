## 1. Pure URL guard (foundation)

- [x] 1.1 Add `assertPublicHttpUrl(url)` (and/or a boolean `isPublicHttpUrl`) to `src/url.ts` — pure, dependency-free, beside `canonicalizeUrl`: reject a non-`http(s)` scheme, any userinfo, and a host that is an IPv4 private/loopback/link-local literal (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0`), an IPv6 `::1`/`fc00::/7`/`fe80::/10` literal (handle bracketed `[::1]` form), or a `localhost`/`*.localhost` name. Return a discriminated result or throw a typed error the callers map to `unreachable` / `validation_failed`.
- [x] 1.2 Unit-test the guard (`test/url.test.ts` or extend an existing url test) against a table: allowed public `http`/`https`; rejected `file:`/`ftp:`/`data:`; rejected userinfo; rejected IPv4 literals across each private range; rejected IPv6 loopback/ULA/link-local (bracketed and bare); rejected `localhost`/`x.localhost`; allowed normal public hostnames.

## 2. Harden the shared fetch primitive

- [x] 2.1 In `src/http.ts`, rewrite `fetchWithBrowserHeaders` to: validate the URL with `assertPublicHttpUrl` before connecting; use `redirect: "manual"` and follow redirects in a bounded loop (hop cap const), re-validating each hop's `Location`; pass `signal: AbortSignal.timeout(ms)` (timeout const). Keep `fetchImpl` injectable. A guard rejection, a bad hop, an over-cap hop count, or a timeout SHALL surface as a thrown/again-mapped failure the existing `acquireRecipeContent` try/catch turns into `{ ok:false, reason:"unreachable" }` with **no** `status` (no oracle). Update the file header comment to describe the guard + timeout + manual-redirect contract.
- [x] 2.2 Add a capped body-read helper (e.g. `readTextCapped(res, maxBytes)`) in `src/http.ts`: short-circuit on an over-cap `Content-Length`, then read the stream and stop at the cap, treating an over-cap body as unusable. Export it for the text-read callers.
- [x] 2.3 Unit-test the primitive with an injected `fetchImpl` (`test/http.test.ts`): a private-host URL never calls `fetchImpl` and surfaces unreachable with no status; a 302→private `Location` is blocked at the hop; an over-hop-cap chain is bounded; a never-resolving fetch aborts at the timeout; `readTextCapped` truncates an over-cap body and passes an under-cap one.

## 3. Wire the body cap into the text-read callers

- [x] 3.1 In `src/discovery-sweep.ts` `loadCandidates`, replace the feed `await res.text()` with the capped read before `parseFeed`.
- [x] 3.2 In `src/discovery-probe.ts` `probeFeed`, replace the feed `await res.text()` with the capped read before `parseFeed` (operator path stays behavior-consistent with the sweep).
- [x] 3.3 Confirm `src/recipe-acquire.ts` needs no change beyond inheriting the hardened primitive (the recipe-page body is read via streaming `extractJsonLd`); add a `Content-Length` pre-check only if the streaming path can over-read.

## 4. Feed rotation cursor in the sweep

- [x] 4.1 Add `feedFetchMaxPerTick` to `DiscoveryConfig` and `DEFAULT_CONFIG` (`src/discovery-sweep.ts`), default `6`, as a **pure constant modeled on `retryFetchMaxPerTick`** — NOT added to the D1 `discovery_config` override, `loadDiscoveryConfig`/`saveDiscoveryConfig`, the PUT validator, or the Elm calibration UI (a budget guardrail, not an operator knob). Extend the `DEFAULT_CONFIG` budget comment with the `flyer(~25) + recipe(16) + feed(K) ≤ ~50` residual-budget math.
- [x] 4.2 Add a pure, exported `selectFeedBatch(sortedFeeds, cursor, k) → { batch, nextCursor }` (stable url ordering, wrap-around) mirroring flyer-warm's testable `buildPlan`.
- [x] 4.3 In `buildDiscoveryDeps` (`loadCandidates`), read the `discovery:feed-cursor` integer from `KROGER_KV`, sort feeds, call `selectFeedBatch`, fetch only the batch (concurrency unchanged — no Semaphore at this K), and write the advanced cursor back to KV. Losing/absent cursor starts at 0.
- [x] 4.4 Unit-test `selectFeedBatch` (`test/discovery-sweep.test.ts` or a new file): batch ≤ k; cursor advances; wrap covers every feed over successive calls; an inserted feed is reached within a bounded number of rotations; cursor 0 on cold start.

## 5. Write-time feed-URL validation (both write paths)

- [x] 5.1 In `src/corpus-db.ts` `addFeedRows`, validate each feed `url` with `assertPublicHttpUrl` before the existing non-empty/dedup checks; a non-conforming URL is skipped/rejected with a `validation_failed` structured error and no row written. This one edit covers both `update_feeds` (`discovery-tools.ts`) and the operator feed editor (`admin-corpus.ts`).
- [x] 5.2 Reflect the reject in the `update_feeds` tool description (`src/discovery-tools.ts`) and confirm the admin `POST /admin/api/corpus/feeds` path surfaces the structured error (no throw).
- [x] 5.3 Unit-test write-time rejection (extend the corpus-db / feeds test): a private-host/non-http/userinfo feed URL is rejected with `validation_failed` and nothing is written; a valid public URL stores under the existing add-only dedup.

## 6. Docs (lockstep, same pass)

- [x] 6.1 `docs/TOOLS.md`: `update_feeds` returns `validation_failed` for a non-public-http feed URL; note `parse_recipe` maps a guard-blocked URL to `unreachable`.
- [x] 6.2 `docs/ARCHITECTURE.md`: document the outbound-fetch guard (scheme/userinfo/private-host + manual redirect + timeout + body cap) and the discovery-sweep feed-rotation cursor (residual-budget rationale). Describe current state only (no history narration).

## 7. Verify

- [x] 7.1 `aubr typecheck` clean.
- [x] 7.2 `aubr test` green (the new url/http/sweep/corpus-db unit tests included); `aubr test:tooling` unaffected.
- [x] 7.3 `openspec validate "harden-outbound-fetch" --strict` passes; re-read the four `*.live.test.ts` expectations (`discovery.live`) to confirm the hardened primitive doesn't break a legitimate public fetch.
