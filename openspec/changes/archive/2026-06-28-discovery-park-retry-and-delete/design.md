# Design — discovery-park-retry-and-delete

## The core shift: outcome-blind ledger → retryable/terminal lifecycle

Today every logged URL is in the dedup set, forever:

```
loadEvaluatedUrls() → SELECT DISTINCT url FROM discovery_log WHERE url IS NOT NULL
                      (outcome is never consulted)
```

The fix is to make `error/unreachable` and `failed` rows **retryable** rather than terminal, gated by a per-row backoff clock so retries don't re-spend the scarce fetch budget on every tick.

```
 park unreachable / log failed
        │  attempts=1, next_retry_at = now + backoff(1)        [health: failed ⇒ ok:false while in-retry]
        ▼
   (cron tick: row is due AND attempts < MAX)
        │
        ▼
   re-run full pipeline (processCandidate)
        ├── acquire OK → classify → match → IMPORT  ⇒ resolve row to imported/no_match/duplicate/…
        │                                              (no "error + reason:ok" zombie — it really imports)
        └── still fails → attempts++,
                next_retry_at = now + backoff(attempts)
                     │  attempts == MAX
                     ▼
                TERMINAL park: next_retry_at = NULL
                  · unreachable → stays outcome 'error' (truly parked)
                  · failed      → resolves to outcome 'error' (so /health clears: no standing 'failed')
```

### Decision 1 — only `unreachable` + `failed` retry

`no_jsonld` / `not_a_recipe` / `incomplete` are structural (a roundup page won't sprout a recipe); retrying them re-spends fetch+classify budget for near-zero recovery. `no_match` / `duplicate` / `dietary_gated` / `imported` are deterministic terminal outcomes. So the retryable set is exactly the two transient failures the user named. (A future taste-change re-evaluation of `no_match` is explicitly out of scope.)

### Decision 2 — retry state as two columns on `discovery_log`, not a side table

The log row already exists per URL and is the dedup key; co-locating `attempts INTEGER NOT NULL DEFAULT 0` and `next_retry_at TEXT NULL` keeps one source of truth and lets the due-retry scan and the resolve-in-place be plain updates. Migration `0018`, plus `CREATE INDEX ... ON discovery_log(outcome, next_retry_at)` for the due scan.

- `next_retry_at` semantics: a timestamp = "retryable, due at/after this"; `NULL` = "not retryable" (terminal park, or a non-retryable outcome). A terminal-by-cap row is `outcome IN ('error') AND next_retry_at IS NULL AND attempts = MAX`.

### Decision 3 — backoff schedule + cap are config (not contract)

`DEFAULT_CONFIG` gains `retryBackoffMinutes: [60, 360, 1440, 4320]` (1h, 6h, 1d, 3d) and `retryMaxAttempts: 5` — placeholders, tunable like the existing thresholds. The spec states "bounded backoff + attempt cap"; the numbers stay in code.

### Decision 4 — `loadEvaluatedUrls` splits into two notions

```
seen (exclude from FRESH intake)   = corpus source_urls
                                   ∪ discovery_rejections          (incl. operator-deleted)
                                   ∪ ALL logged urls               (unchanged — a feed re-listing
                                                                    a url must not double-process it)
retry stream (ADD as candidates)   = discovery_log rows WHERE outcome IN ('error','failed')
                                       AND next_retry_at IS NOT NULL AND next_retry_at <= now
                                       AND url NOT IN discovery_rejections
                                     reconstructed as SweepCandidate{url,title,source,summary:null}
```

Fresh intake still excludes every logged URL; retries are a **separate explicit stream** carrying the existing row's `id` so the result resolves that row instead of inserting a duplicate.

### Decision 5 — `processCandidate(candidate, opts)` extracted from the loop

The per-candidate body (`discovery-sweep.ts:310-443`) becomes a function shared by three callers: cron fresh intake, cron retry stream, and the manual `:id/retry` endpoint. `opts.existingRowId` (present for retries) switches the terminal `recordLog` from INSERT to a **resolve-in-place** UPDATE (set outcome/detail/slug, clear `next_retry_at`, leave `attempts`). For a retry that fails again, the catch/park paths instead bump `attempts` and set the next backoff (or terminalize at the cap). Fresh intake keeps INSERT semantics.

### Decision 6 — retry budget is a sub-cap, so retries can't starve fresh discovery

A `retryFetchMaxPerTick` (< `fetchMaxPerTick`) bounds retry fetches per tick; fresh intake keeps the remainder. Over-cap due rows simply wait for the next tick (their `next_retry_at` already passed; they stay due). Ordering: process fresh first, then retries, within their own sub-cap.

## Manual re-run — `POST /admin/api/discovery/:id/retry`

Runs `processCandidate` for that one row immediately via `buildDiscoveryDeps`, ignoring `next_retry_at` and the attempt cap (operator override — works even on a terminal-by-cap row). Allowed only for `outcome IN ('error','failed')`; other outcomes return a structured error. Returns the resolved outcome so the UI can reflect it. Imports on match like any sweep candidate. Access-gated, operator-only, not an MCP tool — like the existing admin routes. `405` on a non-POST.

## Delete = rejection — `DELETE /admin/api/discovery/:id`

```
DELETE :id  →  addDiscoveryRejection(canonical(row.url), reason="deleted by operator", by=operator)
            →  DELETE FROM discovery_log WHERE id = :id
```

`discovery_rejections` is already per-URL and already unioned into intake dedup (`corpus-db.ts:347`), so this is **permanent, non-reconsidered** suppression with no new mechanism — it also keeps the retry stream from re-admitting it (Decision 4 excludes rejected URLs). Removing the log row clears it from the operator's view and, if it was a standing `failed`, from the health count. Idempotent: a missing id is a no-op success. Access-gated, `405` on a non-DELETE.

## Removing the relabel-only re-probe

`reprobeParked` (`discovery-probe.ts`), `readLegacyUnreachable` + the `updateDiscoveryDetail({reason:"ok"})` path (`discovery-db.ts`), the `POST /admin/api/discovery/reprobe-parked` route (`admin.ts`), and the Elm re-probe button + `ReprobeState`/`ReprobeSummary` (`Logs.elm`) are deleted. Rationale: real retry both re-fetches *and* re-imports, so the "now-acquirable but stuck parked" state it was invented to flag no longer exists. The edge **feed-probe** (`probeFeed` / `POST .../test-feed` / the Feeds-editor Test action) is a different feature and is untouched.

Migration note: existing rows have no `attempts`/`next_retry_at` (defaults: `attempts=0`, `next_retry_at=NULL`). They are therefore terminal until an operator hits **Retry now**, which is the intended one-time drain of the legacy backlog (replacing the old bulk re-probe). New parks from the deploy onward set the retry clock automatically. (No data backfill — the operator drains legacy parks per-row, or deletes them.)

## Health interaction (why exhausted `failed` → `error`)

`countDiscoveryFailures` counts `outcome = 'failed'`. If exhausted `failed` rows stayed `failed`, a single permanently-dead URL would degrade `/health` forever (until delete). Resolving an exhausted `failed` row to a terminal `error` park keeps `failed` meaning **"infra is failing right now / still in retry"** — a true live signal — while a URL that consistently can't be processed becomes a visible, deletable content park. `/health` clears on its own once retries are spent.

## Open question for `/opsx:apply`

- Whether **Retry now** on a row whose URL was meanwhile imported by another path should short-circuit (corpus `source_url` dedup already prevents a re-import; the retry would just resolve to `duplicate`). Likely fine to let it run and resolve to `duplicate`; noted so the implementer doesn't add special-casing.
