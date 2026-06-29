## Why

The MCP tool surface — the ~40 tools members actually call — is currently unobservable in aggregate: the operator can see background-job history (`usage-trends`) and account-level KV/AI budget (`usage-observability`), but nothing reports **which tools are used, how often, and how they perform**. That is the operator's primary signal for what the agent does in practice, where latency lives (a Kroger-fanout tool vs. a D1 read), and which tools fail — and it is invisible today.

## What Changes

- Add a second Workers Analytics Engine dataset, `grocery_tool` (binding `TOOL_AE`), carrying **one tenant-clean data point per tool call**: tool name, outcome (`ok`/`error`), and duration. Separate from `grocery_usage` because a per-call event has a different shape than a per-job-run event — overloading one dataset rots its positional slot contract.
- Capture the points from **one decorator** that wraps `server.registerTool` once in `buildServer`, so every tool in every module (present and future) is instrumented at a single seam — no per-call-site changes, no `runTool` signature churn. Outcome is read from the MCP result's `isError`; emission is best-effort and non-blocking (swallowed, after the result is computed), so it never affects request latency or a tool outcome.
- Add the `analytics_engine_datasets` binding **instance** `TOOL_AE` to the Worker config, and ensure the deploy config merge propagates a *second* dataset of that type (the allowlist already permits the type; verify it is keyed by type, not name, with a regression test asserting both datasets survive the merge).
- Add a read path: `fetchToolUsage` (AE SQL API, reusing `CF_ACCOUNT_ID` + the analytics token, no KV/D1) and a `GET /admin/api/usage/tools` endpoint, reporting per-tool call count, p50/p95 duration, and error rate over a recent window — opt-in and degrading exactly like the existing trends endpoint.
- Surface it on the operator Usage page as a sortable per-tool table (tool · calls · p50 · p95 · error-rate).

## Capabilities

### New Capabilities
- `tool-usage-trends`: Per-MCP-tool-call usage and performance history — a tenant-clean Analytics Engine data point emitted per tool call (tool, outcome, duration) at zero KV/D1 cost via a single registration-time decorator, read back as per-tool aggregates (frequency, latency percentiles, error rate) on the operator Usage page.

### Modified Capabilities
<!-- None. usage-trends (per-job background history) and usage-observability (account snapshot)
     are untouched; this is an additive sibling tier with its own dataset, endpoint, and contract. -->

## Impact

- **New dataset/binding**: `grocery_tool` / `TOOL_AE` in `wrangler.jsonc`; the `scripts/merge-wrangler-config.mjs` allowlist path for a second `analytics_engine_datasets` instance (+ a merge regression test).
- **Code**: a tool-instrumentation decorator and `recordToolPoint` helper (sibling to `recordUsagePoint`, owning its own slot contract) in `src/health.ts`; the wrap site in `buildServer` (`src/tools.ts`); `fetchToolUsage` + types in `src/usage.ts`; the new admin route (`src/admin*.ts`); the Elm Usage panel addition (`admin/`).
- **Docs**: a new `grocery_tool` slot-contract section in `docs/SCHEMAS.md`, the new `/admin/api/usage/tools` endpoint entry, the AE history-tier note in `docs/ARCHITECTURE.md`, and `src/env.ts` for the `TOOL_AE` binding type.
- **Determinism boundary**: unchanged — instrumentation is best-effort and reads only bounded-cardinality, tenant-free dimensions (tool name is a fixed enum). No tool behavior changes.
- **Operator setup**: no new credential — reuses the `usage-observability` analytics token/account id; an unbound `TOOL_AE` is a silent no-op, an unset token renders "not available".
