## Why

The discovery log is an **outcome-blind terminal ledger**: `loadEvaluatedUrls` selects *every* logged URL regardless of outcome (`src/discovery-db.ts:54`) and the sweep unions that into its intake `seen` set, so once a candidate is logged with **any** outcome it is never reconsidered. That is correct for `imported` / `duplicate` / `no_match`, but wrong for the two **transient** failures:

- **`error/unreachable`** — a fetch that threw or returned a non-2xx (an outage, a momentary bot wall). The source is often fine an hour later, but the sweep has already written it off forever.
- **`failed`** — a transient `env.AI` / D1 infrastructure error. It flips `/health` to `ok:false` via `countDiscoveryFailures`, and because it is in the evaluated set it never retries — the **only** thing that ever clears it is the 60-day prune. One AI hiccup degrades health for two months.

There is **no manual re-run and no delete**. The only existing operator control — the `reprobe-parked` button — re-fetches a parked row but *imports nothing*; on a now-acquirable page it rewrites `detail.reason` to `"ok"` while leaving `outcome = "error"`, producing the confusing **`error` + `{ "reason": "ok" }`** rows in the admin log (a parked candidate that is actually fine but stuck out of the corpus with no way back in).

## What Changes

- **The sweep retries transient parks across ticks, with backoff.** `error/unreachable` and `failed` rows become **retryable**: each carries an attempt count and a `next_retry_at`, and the sweep re-gathers a due row as a candidate and runs the **full pipeline** (acquire → classify → match → import on match), resolving the existing row in place. Retries are bounded (exponential backoff, an attempt cap) and budgeted so they cannot starve fresh intake. On exhausting the cap a row becomes a **terminal** park (`next_retry_at` cleared); an exhausted `failed` row resolves to a terminal `error` park so `/health` clears once infra retries are spent. A successful retry actually **imports** — the `error` + `reason:"ok"` zombie state cannot occur.
- **Per-discovery manual re-run in the admin UI.** The Discovery log gains a per-row **"Retry now"** action (`POST /admin/api/discovery/:id/retry`) that runs that single candidate through the pipeline immediately, bypassing the backoff wait — for retryable rows, including ones that have exhausted their auto-retries (operator override).
- **Delete = rejection.** The Discovery log gains a per-row **"Delete"** action (`DELETE /admin/api/discovery/:id`) that adds the candidate's canonical URL to `discovery_rejections` (the existing per-URL, group-wide suppression set the intake dedup already honors) and removes the log row. A deleted discovery is **never reconsidered** — by the cron retry stream or fresh intake.
- **The relabel-only `reprobe-parked` machinery is removed.** Real retry supersedes it; its endpoint, its `readLegacyUnreachable` / `updateDiscoveryDetail` "ok"-relabel path, and the Elm re-probe button/state go away (the per-row Retry/Delete actions replace the bulk button). The edge **feed-probe** (`probeFeed` / `test-feed`) is unrelated and stays.

## Capabilities

### New Capabilities
<!-- none — all changes modify existing capabilities -->

### Modified Capabilities
- `discovery-sweep`: transient acquisition (`unreachable`) and infrastructure (`failed`) parks SHALL be retried across ticks with bounded backoff and an attempt cap, re-running the full pipeline on a due row and becoming terminal only after the cap; intake dedup SHALL re-admit a due retryable row while continuing to exclude rejected URLs.
- `operator-admin`: the Discovery log SHALL offer per-row **Retry now** and **Delete** actions (delete = group-wide rejection) backed by new Access-gated endpoints, replacing the removed bulk `reprobe-parked` re-probe action.

## Impact

- **Code:** `src/discovery-sweep.ts` (factor the per-candidate loop body into a reusable `processCandidate`; add a retry-intake stream; resolve rows in place), `src/discovery-db.ts` (retryable-aware `loadEvaluatedUrls`, due-retry query, row resolve/update, delete; drop `readLegacyUnreachable`/`updateDiscoveryDetail`), `src/admin.ts` (new `:id/retry` + `:id` DELETE routes; drop `reprobe-parked`), `src/discovery-probe.ts` (drop `reprobeParked`; keep `probeFeed`), `admin/src/Logs.elm` (per-row Retry/Delete actions + their state; drop the re-probe button/state).
- **Data:** migration `0018` adds `attempts` and `next_retry_at` to `discovery_log`, plus an index on `(outcome, next_retry_at)` for the due-retry scan. No `detail.reason = "ok"` value is ever written again.
- **Docs:** `docs/SCHEMAS.md` (new `discovery_log` columns; retired `"ok"` reason), `docs/ARCHITECTURE.md` (discovery-sweep retry lifecycle; admin Retry/Delete; removed re-probe), `docs/TOOLS.md` (`read_discovery_errors` outcome semantics note — `failed` is now transient/in-retry).
- **Cost:** retries reuse the existing per-tick fetch/classify caps under a dedicated retry sub-budget, so steady-state cost is bounded; manual retry is one operator-triggered run off the cron budget.
