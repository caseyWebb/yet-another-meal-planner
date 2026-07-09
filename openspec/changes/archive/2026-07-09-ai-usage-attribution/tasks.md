## 0. Verification (early apply-time — connected box; blocked in the planning sandbox)

- [~] 0.1 Confirm `env.AI.run` populates `usage: { prompt_tokens, completion_tokens, total_tokens }` at runtime for `@cf/mistralai/mistral-small-3.1-24b-instruct`. **Type-level: confirmed** against the installed `@cloudflare/workers-types` (`UsageTags` + `usage?` on text-gen output; `neuron` absent; embeddings expose none). **Runtime populated-ness** still needs a deploy (`console.log(res.usage)` or the first `yamp_ai` rows) — the gateway already falls back to the input-length estimate if absent, so the panel shape is unchanged either way.
- [x] 0.2 Record the current published Cloudflare Workers AI neuron rates into `src/ai.ts` — mistral-small `31876`/M input, `50488`/M output; bge-base `6058`/M input ($0.011/1000 neurons). The estimate-vs-actual panel anchor surfaces drift.
- [x] 0.3 Confirm the analytics token's Account Analytics: Read scope covers the `yamp_ai` AE SQL read — reuses the `usage-trends`/`tool-usage-trends` client and finding; no new scope.

## 1. The AI gateway + AE binding

- [x] 1.1 `wrangler.jsonc`: add the `analytics_engine_datasets` binding `AI_AE` (dataset `yamp_ai`), alongside `USAGE_AE`/`TOOL_AE`.
- [x] 1.2 `src/env.ts`: add `AI_AE?: AnalyticsEngineDataset` (optional — unbound is a no-op).
- [x] 1.3 `src/ai.ts` (new): `runAi(env, { activity, trigger, calls?, inputTokensEstimate? }, model, input)` — wraps the single `env.AI.run`, times it, derives tokens (text-gen `res.usage`; embeddings from `inputTokensEstimate`) and `est_neurons`, and emits one best-effort tenant-clean `yamp_ai` point (`env.AI_AE?.writeDataPoint`, swallowed throws). Returns the raw response so callers destructure `.response`/`.data` unchanged. An `env.AI.run` throw emits an `outcome: "error"` point and rethrows.
- [x] 1.4 `src/ai.ts`: the documented per-model token→neuron rate table + `estimateNeurons`/`estimateTokens`/`modelLabel`.

## 2. Route every AI call through the gateway

- [x] 2.1 `src/embedding.ts`: `embedText`/`embedTexts`/`embedTextsCached` take an `AiEmbedContext` and call `runAi` (activities `embed-*`) — **below** the `embedTextsCached` KV short-circuit, so a cache hit emits nothing.
- [x] 2.2 `src/description.ts` (`generateDescription`), `src/discovery-classify.ts` (`classifyRecipe`→`runModel`), `src/ingredient-classify.ts` (`runModel`), `src/title-audit.ts` (`cleanTitleAI`), `src/night-vibe-naming.ts` (`nameCluster`/`starterVibesFromTaste`), `src/discovery-sweep.ts` (`confirmMatchesAI`): route through `runAi` with their `activity` literal.
- [x] 2.3 Thread `trigger`: `cron` default; `import` for `create_recipe`'s `seedRecipeDescription`/`seedRecipeFacets`; `request` for the member/agent tool path (search/propose/suggest/admin). No raw `env.AI.run` remains outside the gateway.

## 3. Read surface + endpoint

- [x] 3.1 `src/usage.ts`: `fetchAiUsage` + `mapAiUsageRows` over the `yamp_ai` AE SQL query (per activity/model/trigger: calls, tokens, `est_neurons`); unconfigured → `{ configured: false }` (no request); failure → `upstream_unavailable`. Reuses the AE SQL client + `this`-safe `fetch` from `usage-trends`.
- [x] 3.2 The account-level by-model actual stays in `fetchUsage`'s payload; the panel reconciles the summed estimate against it client-side (no duplication in `fetchAiUsage`).
- [x] 3.3 `src/admin/api.ts`: `GET /api/usage` gains `aiUsage` in its aggregate read (the one-aggregate-read-per-screen pattern — no separate route). Access-gated; degraded state is a 200 payload.
- [x] 3.4 Tests (`test/ai.test.ts`): estimators, the emission slot layout, usage→tokens extraction, error-path + best-effort no-op, and `mapAiUsageRows` (coercion/order/drop). Existing `embedding-cache` test updated for the new signature.

## 4. Panel (admin React SPA) + Playwright

- [~] 4.1 Design handoff: the panel follows the existing Usage-page panels' vocabulary (shared `kit`/`ui` primitives, no new CSS); a Claude Design fidelity pass can follow (noted for the operator). *(Built on the shared system; not routed through the Design project this session — flagged for review.)*
- [x] 4.2 `packages/admin-app/src/screens/usage.tsx`: `AiUsagePanel` on the Usage screen — ranked activity spend + share bar, cron/import/request trigger badges, estimate-vs-account-actual reconciliation strip, backlog strip (classify/describe/embed). Consumes the existing `usageQuery` payload's `aiUsage`/`aiBacklog` (no new query); not-configured degrades like the sibling panels.
- [x] 4.3 `admin/visual/`: `expectNeuronsByActivity()` time-free landmark on the Usage page object, wired into the Usage smoke test; `aubr test:admin` green (44 passed, via the sandbox Chromium binary).
- [x] 4.4 The Playwright landmark asserts the panel's not-configured state renders (the seeded env's readers return `{ configured: false }`).

## 5. Merge allowlist guard (third instance)

- [x] 5.1 `wrangler.jsonc`'s three `analytics_engine_datasets` instances propagate through `scripts/merge-wrangler-config.mjs` (the type is allowlisted; the array copies verbatim).
- [x] 5.2 Extended the `merge-wrangler-config` test to assert **all three** dataset instances survive the merge.

## 6. Docs (lockstep)

- [ ] 6.1 `docs/SCHEMAS.md`: the `yamp_ai` **positional** slot contract + the `/admin/api/usage` `aiUsage` payload shape; note `est_neurons` is a derived estimate anchored to the account total.
- [ ] 6.2 `docs/ARCHITECTURE.md`: the `src/ai.ts` gateway as the neuron-attribution seam, and the three-dataset AE picture (job / tool / AI).
- [ ] 6.3 `docs/SELF_HOSTING.md`: the `AI_AE` binding is code-level (no operator config); readback reuses the analytics token; `est_neurons` is an estimate, the account meter stays the neuron truth.

## 7. Gate

- [x] 7.1 `aubr typecheck` + Worker unit tests (full suite, 2203) + `aubr test:tooling` (merge guard, 106) green.
- [x] 7.2 `aubr test:admin` (panel) green — 44 passed.
- [x] 7.3 `/code-review` the full branch diff; triage findings. Fixed the one should-fix (night-vibe AI triggers were hardcoded, mislabeling the `suggest_night_vibes` tool/API path as `cron` — now threaded through `runDerivation` → `nameCluster`/`starterVibesFromTaste`/embed) + nit (relabeled the night-vibe dedup embed `embed-nightvibe`). The nit on `assertNever` was dismissed — the panel's boolean `configured` guard matches the sibling Trends/Tools panels.
