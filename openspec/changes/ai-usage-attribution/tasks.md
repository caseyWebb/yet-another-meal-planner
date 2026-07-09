## 0. Verification (early apply-time — connected box; blocked in the planning sandbox)

- [ ] 0.1 Confirm `env.AI.run` populates `usage: { prompt_tokens, completion_tokens, total_tokens }` at runtime for `@cf/mistralai/mistral-small-3.1-24b-instruct` — a one-off `console.log(res.usage)` on a deployment, or the first `yamp_ai` rows after deploy. Type-level answer is settled (`usage` on text-gen output only; `neuron` absent; embeddings expose none); this confirms runtime populated-ness. If absent for our model, text-gen uses the same input-length token estimate as embeddings (panel shape unchanged).
- [ ] 0.2 Record the current published Cloudflare Workers AI neuron rates for `mistral-small-3.1-24b` and `bge-base-en-v1.5` into the `src/ai.ts` rate table; the estimate-vs-actual panel anchor (Decision 3) makes a stale value visible.
- [ ] 0.3 Confirm the analytics token's Account Analytics: Read scope covers the `yamp_ai` AE SQL read (reuse the `usage-trends` finding — no new scope expected).

## 1. The AI gateway + AE binding

- [ ] 1.1 `wrangler.jsonc`: add the `analytics_engine_datasets` binding `AI_AE` (dataset `yamp_ai`), alongside the existing `USAGE_AE`/`TOOL_AE`.
- [ ] 1.2 `src/env.ts`: add `AI_AE: AnalyticsEngineDataset` (optional — unbound is a no-op).
- [ ] 1.3 `src/ai.ts` (new): `runAi(env, { activity, trigger }, model, input, ctx?)` — wraps the single `env.AI.run`, times it, derives tokens (text-gen `res.usage`; embeddings from input length) and `est_neurons` from the rate table, and emits one best-effort tenant-clean `yamp_ai` point (`env.AI_AE?.writeDataPoint`, swallowed throws, `ctx.waitUntil` on the request path). Returns the raw response so callers destructure `.response`/`.data` unchanged. An `env.AI.run` throw emits an `outcome: "error"` point and rethrows.
- [ ] 1.4 `src/ai.ts`: the documented per-model token→neuron rate table + the `est_neurons` derivation (text-gen tokens; embed input-length estimate; batch `calls`/items).

## 2. Route every AI call through the gateway

- [ ] 2.1 `src/embedding.ts`: `embedText`/`embedTexts` call `runAi` (activities `embed-*`) — **below** the `embedTextsCached` KV short-circuit, so a cache hit emits nothing.
- [ ] 2.2 `src/description.ts` (`generateDescription`), `src/discovery-classify.ts` (`classifyRecipe`), `src/ingredient-classify.ts` (ingredient confirm), `src/night-vibe-naming.ts` (`nameCluster`/`starterVibesFromTaste`): route through `runAi` with their `activity` literal.
- [ ] 2.3 Thread `trigger` from callers: `cron` for the reconcile/audit passes; `import` for `create_recipe`'s `seedRecipeDescription`/`seedRecipeFacets`; `request` for the member/agent tool path (search/propose/suggest). Confirm no raw `env.AI.run` remains (grep guard).

## 3. Read surface + endpoint

- [ ] 3.1 `src/usage.ts`: a `fetchAiUsage` mapper over the `yamp_ai` AE SQL query (per activity/model/trigger/day: calls, tokens, `est_neurons`); unconfigured → `{ configured: false }` (no request); failure → `upstream_unavailable`. Reuse the AE SQL client + the `this`-safe `fetch` guard from `usage-trends`.
- [ ] 3.2 `src/usage.ts`: include the account-level by-model actual (from the existing `fetchUsage` path) in the payload as the reconciliation anchor for the summed estimate.
- [ ] 3.3 `src/admin/api.ts`: `GET /admin/api/usage/ai` → `fetchAiUsage`; `/admin*` Access-gated; aggregate-only, tenant-clean; degraded state is a 200 payload, not a throw; no `env.DB`/KV in the route.
- [ ] 3.4 Test: SQL-rows → per-activity series mapping; the unconfigured short-circuit (no request); `upstream_unavailable` on failure.

## 4. Panel (admin React SPA) + Playwright

- [ ] 4.1 Design handoff: author the "Neurons by activity" panel in the companion **Claude Design** project; take the exported bundle as the basis (do not improvise markup) — per the admin UI contract.
- [ ] 4.2 `packages/admin-app`: add the panel to the Usage screen — ranked activity spend, cron/import/request split, estimate-vs-account-actual anchor, and the per-activity series paired with job backlog (`pending` counts via the existing health readers). One `queryOptions` in `queries.ts`; `status` union → `assertNever`; not-configured/not-available as a state, not a throw.
- [ ] 4.3 `admin/visual/`: extend the `usage` page object + spec (a time-free landmark for the new panel), register it, add deterministic seed if needed; run `aubr test:admin` (web session: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and surface the screenshots.
- [ ] 4.4 Test: the panel decodes a payload + renders the not-configured state.

## 5. Merge allowlist guard (third instance)

- [ ] 5.1 Confirm `wrangler.jsonc`'s three `analytics_engine_datasets` instances (`USAGE_AE`/`yamp_usage`, `TOOL_AE`/`yamp_tool`, `AI_AE`/`yamp_ai`) propagate through `scripts/merge-wrangler-config.mjs` (the type is already allowlisted; the array copies verbatim).
- [ ] 5.2 Extend the `merge-wrangler-config` test to assert **all three** dataset instances survive the merge (not just the type), guarding the silent-drop trap for the third instance.

## 6. Docs (lockstep)

- [ ] 6.1 `docs/SCHEMAS.md`: the `yamp_ai` dataset's **positional** slot contract (Decision 4) + the `/admin/api/usage/ai` payload shape; note `est_neurons` is a derived estimate anchored to the account total.
- [ ] 6.2 `docs/ARCHITECTURE.md`: the `src/ai.ts` gateway as the neuron-attribution seam (capture→retrieve→narrow: capture per-call at one seam, retrieve via AE SQL, narrow to activity), and the three-dataset AE picture (job / tool / AI).
- [ ] 6.3 `docs/SELF_HOSTING.md`: the `AI_AE` binding is code-level (no operator config); readback reuses `CF_ACCOUNT_ID` + the analytics token; `est_neurons` is an estimate, the account meter stays the neuron truth.

## 7. Gate

- [ ] 7.1 `aubr typecheck` + `aubr test` (Worker) + `aubr test:tooling` (merge guard) + `aubr test:admin` (panel) green.
- [ ] 7.2 `/code-review` the full branch diff; triage findings.
