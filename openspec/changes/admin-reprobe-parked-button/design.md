## Context

`POST /admin/api/discovery/reprobe-parked` (shipped in `2026-06-28-discovery-park-reasons-and-feed-probe`, `src/discovery-probe.ts`) re-classifies a bounded batch of legacy `unreachable` parked rows and returns `{ scanned, reclassified, stillUnreachable, nowAcquirable }`. The parked rows are already visible in the admin **Logs › Discovery** view (`admin/src/Logs.elm`, `GET /admin/api/logs/discovery`), whose `log-head` has a single **Refresh** button. This change adds the operator trigger for the backfill there. No Worker change.

## Goals / Non-Goals

**Goals:**
- One-click backfill from the UI, with the summary shown and the log auto-reloaded so re-classified reasons appear.
- Model the action's state per `admin/CLAUDE.md` — no `Bool` + `Maybe String`.

**Non-Goals:**
- No per-row "re-probe this candidate" action and no parked-only filter (possible later; out of scope here).
- No change to the endpoint, the sweep, or any tool.

## Decisions

**1. A dedicated `ReprobeState` field on the Logs `Model`, separate from `discovery : WebData Loaded`.** The backfill is independent of the log load, so it gets its own state: `ReprobeIdle | ReprobeRunning | ReprobeDone ReprobeSummary | ReprobeFailed Http.Error`. This makes "running", "the summary", and "the failure" mutually exclusive by construction (no busy-flag-beside-a-maybe-error). *Alternative considered:* reuse a generic action type like `TableEditor.ActionState` — rejected; the reprobe has a result payload (the summary) that `ActionState` doesn't carry, and Logs isn't a TableEditor.

**2. On success, set `ReprobeDone summary` AND reload the log** (`discovery = Loading` + `fetchDiscovery`). The whole point is that the re-classified `detail.reason`s become visible, so a refetch is correct here (unlike the read-only feed Test, which must not refetch). A `Refresh`/source-reselect clears the stale summary back to `ReprobeIdle`.

**3. The button lives in the Discovery arm's `log-head`, beside Refresh**, disabled while `ReprobeRunning`. A `viewReprobe` line under the head renders the summary (e.g. "Re-probed 25: 18 reclassified, 5 still unreachable, 2 now acquirable") or the failure via the existing `httpError`. The summary-to-text is a pure helper pinned by a unit test, and the `ReprobeSummary` decoder gets a decode test (the compiler-opaque logic, like `entryDecoder`).

## Risks / Trade-offs

- **[Operator clicks it repeatedly / subrequest cost]** the endpoint is already bounded per call and idempotent; the button is disabled while running, so a click can't stack. Draining a large backlog still takes several clicks — the summary's `scanned` makes that visible.
- **[Stale summary after a manual Refresh]** cleared to `ReprobeIdle` on `Reload`/source-reselect so the shown summary always matches the last reprobe.

## Open Questions

None blocking.
