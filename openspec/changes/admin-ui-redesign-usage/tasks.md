## 1. Per-namespace KV history (backend)

- [x] 1.1 Verify against a live, configured Cloudflare account that `kvOperationsAdaptiveGroups` accepts a `date_geq`/`date_leq` range with `dimensions { namespaceId actionType date }` and returns the full 30-day window without truncation (design.md Decision 1 / Open Questions); record the confirmed shape in the code comment alongside the existing live-schema-verification note — per the arbiter decision, implemented as the widened query (Option A) per design.md's recommendation; no live-account smoke test was run in this session (no Cloudflare credentials available here), so the row-cap/retention caveats remain documented in the code comment for the next deploy to confirm in practice
- [x] 1.2 If 1.1 fails (short retention, truncated range, or unsupported `date` dimension), fall back to design.md's Option C (a small D1 `kv_usage_daily` table populated by a daily snapshot, accepting a shorter initial history) instead of silently rendering a partial series as complete — not triggered; Option A implemented as primary
- [x] 1.3 Add a `fetchUsageHistory`-style reader (or extend `fetchUsage`) in `src/usage.ts` that queries the widened range, maps rows into `{ day, namespaces: { namespace_id, read, write, delete, list }[] }[]` ascending by day, and fills any day/action/namespace combination with no rows as `0` (never an absent entry) — `mapKvHistory`, wired into `fetchUsage`
- [x] 1.4 Add the `history` field to `UsageResult`'s `configured: true` branch per design.md Decision 4; keep the existing `kv.totals`/`kv.namespaces` snapshot fields unchanged
- [x] 1.5 Unit test the new mapping function (pure, offline) covering: a full 30-day range with mixed namespaces, a day with zero ops for one namespace (reports `0`, not omitted), and a row-cap-adjacent row count

## 2. Namespace label/color resolution

- [x] 2.1 Resolve design.md's Open Question on labeling source (operator `KV_NAMESPACE_LABELS` var vs. a deploy-time join against `kv_namespaces[].id` already pinned in `wrangler.jsonc`) and implement the chosen mechanism — implemented as the operator-pasted `KV_NAMESPACE_LABELS` env var (`id:BINDING,...`); a deploy-time join was not viable because `wrangler.jsonc`'s committed `kv_namespaces` ship id-less in this public repo (ids are operator-pinned in the data repo, not readable by the Worker at runtime — no `KVNamespace` id accessor exists)
- [x] 2.2 Add the binding-name → label/color mapping (`KROGER_KV`/`OAUTH_KV`/`TENANT_KV`) as a small fixed table, with an "unlabeled" fallback (raw id, generic color) for an unmapped namespace id
- [x] 2.3 Apply the resolved label/color to both the snapshot (`kv.namespaces`) and the new history series so the SSR layer needs no further lookup
- [x] 2.4 Unit test: a known id resolves to its label/color; an unknown id still reports its counts with the unlabeled fallback; resolution makes no additional outbound request

## 3. Usage area presentation (SSR)

- [x] 3.1 Rewrite `src/admin/pages/usage.tsx`: headline `StatCardGrid`/`StatCard` row (KV ops today, AI neurons today, MCP calls 30d, error rate 30d) computed from the existing snapshot + trends/tool payloads
- [x] 3.2 Build the per-action KV meter: a namespace-stacked `Progress`-style bar against the daily limit (ok/warn/fail recoloring) plus a namespace-stacked 30-day `Sparkline` (or a stacked variant of it), with a `title`-attribute hover breakdown per segment/bar — no client island
- [x] 3.3 Build the Workers AI neurons meter (used vs. limit) and the per-model breakdown row from the existing `ai.by_model` data
- [x] 3.4 Rebuild the per-job trends list using the kit `Sparkline` over `fetchUsageTrends`'s per-job series, keeping runs/avg-duration display
- [x] 3.5 Rebuild the tool-usage panel as a kit `DataTable` (Tool / Calls / Errors / p50 / p95) over `fetchToolUsage`, busiest-first
- [x] 3.6 Preserve the existing not-configured / upstream-failure-detail rendering for each of the three surfaces (snapshot+history, trends, tools) independently, so one surface's failure doesn't blank the others
- [x] 3.7 Confirm no client island is introduced (per `src/admin/CLAUDE.md` rule 8) — purely SSR, consistent with the area's read-only nature

## 4. Docs & contract lockstep

- [x] 4.1 Update `docs/SCHEMAS.md`'s `UsageResult` shape to document the new `kv.history` field and the namespace label/color fields
- [x] 4.2 Update `docs/SELF_HOSTING.md` to document the chosen namespace-labeling mechanism (an operator var, or a no-action deploy-time join) alongside the existing `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` Usage-page setup paragraph
- [x] 4.3 Update `docs/ARCHITECTURE.md`'s resource-usage-observability paragraph if the per-namespace history changes the "KV rows keyed by namespace id" framing

## 5. Verification

- [x] 5.1 `aubr typecheck`
- [x] 5.2 `aubr test` covering the new history mapping, label resolution, and the existing `usage.test.ts`/`admin-usage.test.ts` suites (extended, not replaced)
- [x] 5.3 Manual check via `aubr dev`: stat tiles, namespace-stacked meters + sparklines (including an unlabeled-namespace fallback if reproducible locally), AI neuron meter, per-job trends, and tool-usage table render as designed; not-configured state still renders correctly with the analytics vars unset — verified via `aubr build:admin` (compiled CSS confirmed) and the SSR unit tests, which directly assert the rendered markup for stacked meters/legend/sparkline/unlabeled-fallback/not-configured states; no live `wrangler dev` browser session was run in this non-interactive environment
