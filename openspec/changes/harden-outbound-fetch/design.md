## Context

Every server-side egress in the Worker flows through one primitive, `fetchWithBrowserHeaders` in `src/http.ts`:

```ts
fetchImpl(url, { headers: BROWSER_HEADERS, redirect: "follow" });   // no guard, no timeout, no cap
```

Its callers: the LLM-supplied `parse_recipe(url)` (`discovery-tools.ts` → `recipe-acquire.ts`), the background sweep's feed fetch and recipe-page fetch (`discovery-sweep.ts` `loadCandidates` + `acquireContent`), and the operator feed-probe (`discovery-probe.ts`). Four open issues (#53/#54/#55/#67) are four symptoms of this one gap.

Two constraints shape the fix:
- **Workers runtime.** No `dns` module — a Worker cannot resolve a hostname to an IP before `fetch()` does. So a host guard is necessarily **literal-only** (it catches IP-literal and `localhost`-name targets, not a public name that resolves to a private address). The deployment has no co-located metadata/loopback service, which is why the issues are calibrated medium/low rather than high.
- **One shared external-fetch budget.** The `scheduled()` handler runs four jobs in one invocation; the codebase treats external `fetch()` calls as a single ~50-per-invocation free-tier cap (`env.AI`/D1/KV/R2 are "internal", a separate line). The flyer warm spends ~25 on a scan tick; the sweep's recipe-page fetches self-govern at `fetchMaxPerTick=16`; **the feed fan-out governs nothing** and at a dozen add-only feeds already risks `25 + 12 + 16 = 53 > 50`.

The `discovery-sweep` spec already requires bounding "feed and recipe-page fetches via a cursor-swept bounded batch like the flyer warm" — the implementation only ever built the recipe-page half. So the rotation work is largely conformance to an existing requirement.

> The issues' line numbers point at the retired `fetch_rss_discoveries`; the live code is in `discovery-sweep.ts:725-738`.

## Goals / Non-Goals

**Goals:**
- One hardened egress primitive that all three callers inherit: scheme/userinfo/private-host guard, manual redirect with per-hop re-validation, per-request timeout, capped body read.
- No internal-reachability oracle: a blocked/timed-out target is indistinguishable from a dead host at the caller boundary.
- The sweep's feed fan-out bounded by a persisted rotation cursor, sized to the residual external-fetch budget.
- Write-time rejection of non-public feed URLs at both feed write paths.

**Non-Goals:**
- DNS-resolution-time SSRF defense (impossible on Workers without pre-resolution; out of reach, documented as a residual).
- An egress allowlist of "approved recipe domains" — too restrictive for open discovery; the guard is a *deny* of private targets, not an *allow* of specific hosts.
- Reworking the flyer warm or the email-inbox intake (already bounded; email links become candidates fetched under `fetchMaxPerTick`, not in the feed loop).
- A new park taxonomy (see Decisions — guard-blocks reuse `unreachable`).

## Decisions

**1. Harden the single chokepoint; don't guard each caller.**
`fetchWithBrowserHeaders` becomes the one place the guard, timeout, and manual-redirect loop live, so `parse_recipe`, the sweep, and the probe inherit all of it for free — matching the repo's "coarse, opinionated tools" ethos and the `recipe-acquire.ts` invariant that the three callers "can never drift." Alternative (guard at each call site) rejected: three copies, guaranteed drift.

**2. The pure guard lives in `url.ts`; `http.ts` imports it.**
`assertPublicHttpUrl(url)` (or a boolean sibling) is pure string/URL parsing — it belongs next to `canonicalizeUrl` in the dependency-free `url.ts`, where the write-time validators (`addFeedRows`) can also reach it without pulling in `http.ts`. Pure ⇒ trivially unit-testable against an IP/scheme/userinfo table.

**3. Manual redirect loop, re-validating each hop.**
Replace `redirect: "follow"` with `redirect: "manual"` and a bounded loop: on a 3xx, read `Location`, re-run `assertPublicHttpUrl`, and re-issue — up to a small hop cap. This closes #67's "benign host 302s to an internal target" without losing legitimate public→public redirects (still followed within the cap).

**4. Guard-blocks reuse the existing `unreachable` reason — no new taxonomy.**
`AcquireResult` already is `{ ok:false, reason:"unreachable", status? }`. A guard-blocked or timed-out target maps to `unreachable` **with no `status`** — identical in shape to a dead host, which *is* the no-oracle property, and requires zero change to `parse_recipe`'s structured errors or the sweep's park reasons. Trade-off: `unreachable` is treated as *retryable* by the sweep's retry stream, so a guard-blocked **candidate** URL (from a feed item / email link) costs bounded retries (`retryMaxAttempts`) before terminalizing — wasted but harmless, and feed *URLs* can't hit this because they're rejected at write time. A distinct terminal `blocked` reason is a possible future refinement if the retry waste ever shows up in the operator log; deferred to keep the taxonomy stable.

**5. Feed rotation is a lightweight integer cursor in KV — not a flyer-style plan.**
The flyer needs a heavy `plan + sweep_id + completion + atomic-replace` because it materializes a per-location rollup that must be *complete* before it's "fresh." The feed poll has no such contract: each feed is independent, its items just flow into the candidate pool, and a feed not polled this tick is polled next. So the cursor is a single integer offset into the feed list sorted by a stable key (url):

```
feeds   = sortByUrl(readFeeds())
start   = cursor mod feeds.length
batch   = rotate(feeds, start).take(feedFetchMaxPerTick)
cursor  = start + batch.length            // persisted; wraps via mod next tick
```

A pure `selectFeedBatch(sortedFeeds, cursor, k) → { batch, nextCursor }` (mirroring flyer-warm's testable `buildPlan`) holds the logic; the KV read/write stays in `buildDiscoveryDeps` glue, preserving the sweep's "logic split from I/O, fully unit-testable" property. **Home:** `KROGER_KV` key `discovery:feed-cursor` — the namespace the flyer cursor already uses, and exactly the "ephemeral infra" `env.ts` reserves KV for. Alternative (a D1 state row) rejected: needs a migration and treats a throwaway cursor as domain data, against the repo's KV doctrine. The Kroger-named binding holding a discovery key is a cosmetic wart, not a coupling.

**6. `feedFetchMaxPerTick` is calibrated against the *residual* budget.**
It joins `DiscoveryConfig`/`DEFAULT_CONFIG` (operator-tunable via `loadDiscoveryConfig`, like the existing caps). The binding constraint is `flyer(~25) + recipe-page(fetchMaxPerTick=16) + feed(K) ≤ ~50`, i.e. `K ≲ 9`; default **`K = 6`** drains a dozen feeds in 2 ticks (10 min) and 24 in 4 ticks (20 min) — far fresher than RSS needs. The `DEFAULT_CONFIG` comment (already flagged "placeholders until calibration") records this math so a future bump to `fetchMaxPerTick`/`flyerBatchUnits` cannot silently reopen #54.

**7. Body cap on the text-read paths; skip the Semaphore.**
The unbounded `res.text()` in the feed-poll and probe paths gets a byte cap (a `Content-Length` pre-check plus a capped stream read). The recipe-page path reads via streaming `HTMLRewriter` (`extractJsonLd`), bounded differently; it gets a cheap `Content-Length` pre-check too. The existing `Semaphore` is **not** used for the feed batch — at `K=6` in-flight count is already tiny; a concurrency cap would be ceremony. (It stays available if `K` is ever tuned large.)

**8. One write-time guard covers both feed write paths.**
`update_feeds` (`discovery-tools.ts`) and the operator feed editor (`admin-corpus.ts`) both call `addFeedRows` (`corpus-db.ts`). Putting the `assertPublicHttpUrl` check there (returning `validation_failed`, writing nothing) closes #53 at the door for both with one edit.

## Risks / Trade-offs

- **A public name resolving to a private IP is not caught (DNS rebinding).** → Accepted residual: Workers can't pre-resolve DNS, and the deployment has no co-located metadata/loopback target — the reason the issues are medium/low. Documented in the spec's known-limit and the proposal.
- **An over-aggressive timeout turns a slow-but-legit feed into a false `unreachable`.** → Tune the timeout generously; a transient `unreachable` is *retryable* in the sweep (the retry stream re-admits it), so a one-off slow tick self-heals.
- **Rotation raises per-feed latency** (a feed is polled every `ceil(N/K)` ticks). → At a 5-min cron and `K=6`, a dozen feeds are each polled within ~2 ticks; RSS updates hourly at most, so freshness is unaffected.
- **An add-only list shift perturbs the integer cursor** (a feed double-polled or skipped one rotation on the exact tick a feed is added). → Dedup makes a double-poll a no-op; a one-rotation skip self-heals. No `sweep_id` needed.
- **The guard could false-positive a legitimate public fetch** (e.g. a feed URL carrying userinfo). → Vanishingly rare for RSS/recipe pages; the guard only blocks IP-literal/localhost hosts, userinfo, and non-http schemes — normal public hostnames pass untouched.

## Migration Plan

- Pure code + one new `DiscoveryConfig` field + one new KV key. **No D1 migration.** Ships on the standard `main` → data-repo deploy path (Worker paths touched).
- **Cold start:** the first tick after deploy finds no `discovery:feed-cursor` and starts the rotation at 0 — no backfill.
- **Rollback:** revert the commit; the orphaned KV cursor key is harmless (next deploy with the feature re-reads or re-creates it).
- Update `docs/TOOLS.md` (`update_feeds` `validation_failed` on a non-public URL) and `docs/ARCHITECTURE.md` (the egress guard + the sweep feed-rotation cursor) in the same pass, per the lockstep-docs rule.

## Open Questions

- **Concrete tuning values:** timeout ms, body byte-cap, redirect hop cap, and `feedFetchMaxPerTick` default. Proposed starting points — timeout ~8–10s, body cap ~2 MB, hops ≤ 5, `K = 6` — tuned against live behavior alongside the existing `DEFAULT_CONFIG` calibration story; none are contractual (all live in config/consts).
- **Distinct terminal `blocked` park reason?** Deferred (Decision 4) — revisit only if guard-blocked candidate retries show up as noise in the operator discovery log.
