## Why

The discovery sweep's specific park-reasons and the `POST /admin/api/discovery/reprobe-parked` backfill (which re-classifies legacy catch-all `unreachable` rows) both shipped, but the re-probe endpoint has **no UI** — an operator can only drain the backlog via `curl` through their Access session. The parked rows themselves are already visible in **Logs › Discovery**, so the natural place to trigger the backfill is right there, beside the existing Refresh.

## What Changes

- Add a **Re-probe parked** action to the admin **Logs › Discovery** view that `POST`s `/admin/api/discovery/reprobe-parked`, renders the returned summary (`scanned / reclassified / stillUnreachable / nowAcquirable`), and on success reloads the log so the re-classified reasons appear immediately.
- The action's in-flight state, result, and failure are one modeled state (per `admin/CLAUDE.md`), independent of the log's `WebData` load.
- No Worker change — the endpoint already exists; this is the operator affordance for it.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `operator-admin`: the Logs › Discovery view gains an operator action to run the `reprobe-parked` backfill and show its summary (the endpoint requirement is unchanged).

## Impact

- **Code:** `admin/src/Logs.elm` (the reprobe state, the button, the summary render, the POST + decoder), `admin/tests/LogsTest.elm` (decoder + summary-text), and the rebuilt `admin/dist/` bundle. `docs/SELF_HOSTING.md` updates the "curl-only" note to "a button in Logs › Discovery (or curl)".
- **No Worker / D1 / tool change** — purely the admin SPA consuming an existing endpoint.
