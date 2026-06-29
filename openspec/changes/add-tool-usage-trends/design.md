## Context

The Worker has three observability planes already: the GraphQL Analytics snapshot (`usage-observability`, account-level KV/AI budget *today*), the `job_health` D1 row (per-job *liveness*), and the `grocery_usage` Analytics Engine dataset (`usage-trends`, per-background-job *history*). None of them sees the **request path**: the ~40 MCP tools members call. The operator cannot answer "which tools are used, how often, and how fast/reliably."

Analytics Engine is the right plane for this: a write is non-blocking and costs no KV/D1 budget, dimensions are queried as aggregate time series via the AE SQL API, and free-tier retention (~90 days) bounds the window. The constraints inherited from `usage-trends` carry over verbatim: AE data is account-level and queryable, so it MUST be **tenant-data-free**; AE has no named columns, so the blob/double layout is a **positional contract** that a later change must never reorder; each dataset is a **binding** that must survive the deploy config merge (`scripts/merge-wrangler-config.mjs`) or it is silently dropped.

Two facts about the codebase make this tractable. First, **every** tool across all nine registration modules goes through the single `server.registerTool` on the one `McpServer` instance created in `buildServer(env, tenant, origin)` — so one wrap covers all of them. Second, `runTool` already encodes success/failure as `isError` on the returned MCP result, so outcome is derivable from the result without changing `runTool` or any tool body.

## Goals / Non-Goals

**Goals:**
- Per-tool-call frequency, latency (incl. p95), and error rate, queryable as a trend over a recent window.
- Instrument at exactly **one seam**, covering every current and future tool, with zero per-call-site or `runTool` signature changes.
- Best-effort and non-blocking: instrumentation never changes a tool's outcome or adds latency to the response.
- Tenant-data-free by construction; a documented, never-reordered slot contract.
- Opt-in read, reusing the existing analytics token/account id; graceful not-configured degradation.

**Non-Goals:**
- Per-tenant attribution (who called what) — that is the tenant line; explicitly excluded from the dataset.
- Per-call argument capture or individual-event debugging — that is Workers Logs/Observability, not AE.
- Error-*code* attribution in v1 (which code a tool failed with) — `blob3` is reserved for it, not populated now.
- Reworking `grocery_usage`/`usage-trends` — this is an additive sibling tier, not a modification.
- The Kroger match-pipeline funnel (a separate, deferred surface with its own tenant-cleanliness ruling).

## Decisions

### Decision 1: One `registerTool` decorator, not `runTool` threading or per-call-site edits
Wrap `server.registerTool` once in `buildServer`, before any tool is registered, so each registered handler is decorated with: stamp `start`, run the original handler, derive `ok = !result?.isError`, fire one AE point in a `finally`, return the **unchanged** result.

- **Why over threading `(env, toolName)` through `runTool`**: `runTool(body)` receives only a closure — adding env/name/outcome would touch every `runTool` call site across nine modules, on the hot path. The decorator is one site and reads outcome from the result that already exists.
- **Why over a `register()` wrapper helper each module calls**: that still requires editing ~40 call sites and is easy to forget for a new tool. Wrapping `server.registerTool` itself is transparent — sub-registration functions (`registerGroceryListTools`, etc.) receive the already-wrapped `server` and are instrumented for free.
- **Outcome semantics**: `ok` is `true` unless the MCP result has `isError: true` (set by `runTool`'s `fail()`). A raw throw that bypasses `runTool` is caught by the decorator's `finally` and recorded as `ok: false`, so coverage is total.

### Decision 2: A new dataset `grocery_tool` / `TOOL_AE`, separate from `grocery_usage`
A per-call event (`index = tool name`, one duration) has a fundamentally different shape than a per-job-run event (`index = job`, a per-job count vector). Merging them would force `index1`/`blob1` to carry two incompatible meanings discriminated by nothing — exactly the rot the positional contract warns against. Datasets are cheap (a binding); the real cost is the contract + reader, and those are genuinely distinct here.

**Slot layout (positional contract, `docs/SCHEMAS.md`):**
```
index1  = tool name        (sampling key; ~40-value bounded enum)
blob1   = tool name
blob2   = "ok" | "error"
blob3   = RESERVED (future error code; not written in v1)
double1 = duration_ms
timestamp = AE-supplied
```
Tool name is a fixed, low-cardinality, tenant-free enum, so it is clean as both index and dimension — unlike the match pipeline's ingredient term, which is why tool-tracking is the cleaner first build.

### Decision 3: A per-domain `recordToolPoint` helper, not a generalized writer
Add `recordToolPoint(env, tool, { ok, durationMs })` as a sibling to `recordUsagePoint`, each owning its own slot layout next to a doc comment that pins it. The only thing worth sharing is the swallow-and-no-op primitive (`TOOL_AE?.` + `try/catch`). Generalizing to a thin `writePoint(dataset, {...})` would discard the one thing the helper exists to protect: the executable record of the positional contract.

### Decision 4: Read via `fetchToolUsage` + `GET /admin/api/usage/tools`, p95 not just avg
Mirror `fetchUsageTrends`: an AE SQL client reusing `CF_ACCOUNT_ID` + the analytics token, performing no KV/D1, returning `{ configured: false }` when unset and `upstream_unavailable` on failure. The query groups by tool over the window:
```sql
SELECT blob1 AS tool, count() AS calls,
       quantileWeighted(0.5)(double1, 1)  AS p50_ms,
       quantileWeighted(0.95)(double1, 1) AS p95_ms,
       sum(blob2 = 'error') / count()     AS error_rate
FROM grocery_tool WHERE timestamp > now() - INTERVAL '<window>' DAY
GROUP BY tool ORDER BY calls DESC
```
p95 is reported because it is the number that matters for a request-path tool (avg hides the Kroger-fanout tail). The panel is a **sortable per-tool table** — a different shape from the per-job line series, so a new section on `/admin/usage`, not a tweak to the existing chart.

### Decision 5: v1 carries no error code
`blob2` distinguishes ok/error; the specific `ErrorCode` would have to be parsed out of the `fail()` JSON body (not a top-level field), which is fragile. The slot layout reserves `blob3` so a v2 can add it without reordering. "Why did it error" is a Logs question until then.

## Risks / Trade-offs

- **Second AE binding silently dropped by the config merge** → The allowlist permits the `analytics_engine_datasets` *type*, but a second instance could be dropped if the merge keys/dedupes by binding name. Mitigation: explicit verification + a regression test asserting **both** `grocery_usage` and `grocery_tool` survive `merge-wrangler-config.mjs`.
- **Emission on the hot path adds latency** → Emit in `finally` *after* the result is computed; `writeDataPoint` is non-blocking (no awaited network); swallow all throws. The response is already returned-shaped before the point is written.
- **`Date.now()` is coarse in Workers** → It advances after I/O, and tool handlers do I/O (D1/Kroger), so ms-scale duration is meaningful; sub-ms pure-compute tools will read ~0, which is fine for a latency trend.
- **High write volume triggers AE sampling** → Tool-call volume for a friend group is low; sampling only kicks in at very high rates, and `count()`/quantiles remain representative under AE's sampling model. Acceptable.
- **A decorator that throws would break tool registration** → The decorator's own body must be trivially safe (timing + a swallowed helper call); the helper already cannot throw. No tool logic runs inside the try that the emit depends on.

## Migration Plan

1. Add `TOOL_AE` to `wrangler.jsonc` and `src/env.ts`; add the merge-allowlist coverage + test.
2. Land `recordToolPoint` + the decorator + the `buildServer` wrap; ship emission first (the dataset starts filling).
3. Add `fetchToolUsage` + the `/admin/api/usage/tools` endpoint + the Elm panel once data exists to read.
4. Update `docs/SCHEMAS.md` (slot contract + endpoint), `docs/ARCHITECTURE.md` (history-tier note).

Rollback: remove the binding (emission becomes a no-op via `TOOL_AE?.`) and the endpoint; no data migration, no schema change, no effect on tool behavior at any step.

## Open Questions

- **Window length**: reuse `TRENDS_WINDOW_DAYS` (30) for symmetry, or a shorter default for the higher-volume tool stream? Leaning reuse.
- **Panel placement**: a new section on the existing Usage trends panel vs. a sibling tab. Leaning same page, new section.
