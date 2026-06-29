## 1. Binding & config

- [x] 1.1 Add the `grocery_tool` Analytics Engine dataset binding `TOOL_AE` to `wrangler.jsonc` (alongside the existing `grocery_usage`/`USAGE_AE`).
- [x] 1.2 Add the optional `TOOL_AE?: AnalyticsEngineDataset` binding to `Env` in `src/env.ts`, with a doc comment mirroring `USAGE_AE` (unbound deployment ⇒ silent no-op).
- [x] 1.3 Verify `scripts/merge-wrangler-config.mjs` propagates a **second** `analytics_engine_datasets` instance (confirm the allowlist keys by type, not binding name); adjust if it dedupes/drops.
- [x] 1.4 Add a merge regression test (in `tests/*.test.mjs`) asserting **both** `grocery_usage` and `grocery_tool` bindings survive the config merge.

## 2. Emission (write path)

- [x] 2.1 Add `recordToolPoint(env, tool, { ok, durationMs })` to `src/health.ts`, sibling to `recordUsagePoint`, owning the `grocery_tool` slot layout (`index1`/`blob1` = tool, `blob2` = ok/error, `blob3` reserved, `double1` = duration_ms) in its doc comment; best-effort try/catch + `TOOL_AE?.` no-op.
- [x] 2.2 Add a tool-registration decorator (e.g. `instrumentTools(server, env)`) that rebinds `server.registerTool` so each handler is timed, its outcome derived from `result.isError` (raw throw ⇒ `ok:false` via `finally`), and one `recordToolPoint` fired — returning the unchanged result.
- [x] 2.3 Call the decorator once in `buildServer` (`src/tools.ts`) immediately after `new McpServer(...)`, **before** any inline registration and before the `register*Tools(server, …)` calls, so all modules are covered.
- [x] 2.4 Unit-test the decorator: an `ok` result emits `ok`, an `isError` result and a thrown handler both emit `error`, the result object is returned unchanged, and a throwing/absent `TOOL_AE` does not affect the result.

## 3. Read path

- [x] 3.1 Add `fetchToolUsage(env, deps)` + its `ToolUsageResult` types to `src/usage.ts`, mirroring `fetchUsageTrends`: AE SQL API, reuse `CF_ACCOUNT_ID` + analytics token, `{ configured: false }` when unset, `upstream_unavailable` on transport/non-2xx/unparseable, no KV/D1.
- [x] 3.2 Implement the per-tool SQL (count, p50/p95 via `quantileWeighted`, error rate via `sum(blob2 = 'error')/count()`) over a window (reuse `TRENDS_WINDOW_DAYS` unless decided otherwise); add a pure `mapToolUsageRows` for offline unit testing.
- [x] 3.3 Unit-test `mapToolUsageRows` (grouping, numeric coercion, ordering) and the `{ configured: false }` / `upstream_unavailable` paths with an injected fetch.

## 4. Admin endpoint & panel

- [x] 4.1 Add `GET /admin/api/usage/tools` to the admin route layer, behind the same Access gate, serializing `fetchToolUsage` (mirroring the `/admin/api/usage/trends` wiring).
- [x] 4.2 Add a sortable per-tool table section (tool · calls · p50 · p95 · error-rate) to the Elm Usage view in `admin/`, with the not-configured "not available" state; rebuild `admin/dist` via `aubr build:admin`.

## 5. Docs

- [x] 5.1 Add a `grocery_tool` slot-contract section to `docs/SCHEMAS.md` and the `GET /admin/api/usage/tools` endpoint entry.
- [x] 5.2 Add the per-tool history-tier note to the AE section of `docs/ARCHITECTURE.md` (sibling to the per-job `grocery_usage` note).

## 6. Verification

- [x] 6.1 Run `aubr typecheck`, `aubr test`, and `aubr test:tooling`; confirm the new tests pass and `openspec validate "add-tool-usage-trends"` is green.
