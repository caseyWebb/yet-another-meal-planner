# Design — ai-usage-attribution

## Context

Neuron observability today has two tiers, neither of which attributes spend to the activity that caused it:

```
 ACCOUNT TRUTH (GraphQL Analytics)      PER-JOB HISTORY (yamp_usage AE)      MISSING
 ─────────────────────────────────      ────────────────────────────────    ──────────────────
 total neurons / day                    per-job run count + duration         neurons/tokens by ACTIVITY
 30-day neuron sparkline                per-job summary counts               cron vs import vs request
 neurons by MODEL  ── 2 bars            (pending backlog lives here)         create_recipe import spend
        │                                       │                            steady churn vs draining backlog
        └────────── both models feed ~13 activities; neither tier
                    can say which activity is the cost ───────────────►  THIS CHANGE
```

The enabling fact (settled by the binding-return spike, corroborating `usage-trends`' task 0.2): `env.AI.run` returns **no neuron count** for any model; it returns `usage: { prompt_tokens, completion_tokens, total_tokens }` **only** for text-generation output, and nothing usage-shaped for `bge` embeddings. So the design captures what the binding *does* give (real tokens for the neuron-dominant mistral calls), estimates the rest, and reconciles the whole against the account-level total that Cloudflare *does* expose.

This is the third instance of a pattern the repo already runs twice: a wrap-once instrumentation seam emitting one tenant-clean AE point per unit of work, read back via the AE SQL API onto the Usage page (`yamp_usage` per-job, `yamp_tool` per-tool → `yamp_ai` per-AI-call).

## Decision 1 — The single AI gateway (the enabling seam)

Every `env.AI.run(...)` call routes through one function:

```
runAi(env, { activity, trigger }, model, input, ctx?)
  → const started = performance.now()
    const res = await env.AI.run(model, input)     // the only env.AI.run in the codebase
    emitAiPoint(env, { activity, model, trigger,
                       outcome: "ok",
                       durationMs: performance.now() - started,
                       calls, inputTokens, outputTokens, estNeurons }, ctx)
    return res                                       // caller destructures .response / .data as before
```

- **Wrap-once**, like `src/tool-instrumentation.ts`: the ~7 helpers (`embedText`/`embedTexts` in `embedding.ts`; `generateDescription` in `description.ts`; `classifyRecipe` in `discovery-classify.ts`; the ingredient confirm in `ingredient-classify.ts`; `nameCluster`/`starterVibesFromTaste` in `night-vibe-naming.ts`) each swap `env.AI.run(M, x)` → `runAi(env, {activity, trigger}, M, x)`. Any future AI call added through the gateway is captured with no extra wiring; a raw `env.AI.run` becomes the thing a reviewer flags (the coarse-tool discipline).
- **Below the embedding cache.** `embedTextsCached` (`embedding.ts`) short-circuits on a KV hit *before* `env.AI.run`; the gateway sits at the real inference, so a cache hit spends no neurons and emits no point — request-path `embed-search` appears in the breakdown only for genuine cache misses, which is exactly the spend worth attributing.
- **Best-effort + non-blocking**, exactly like the two existing AE emits: `env.AI_AE?.writeDataPoint(...)` inside a `try/catch(()=>{})`, emitted *after* the result is in hand so it adds no latency; on the request path the emit rides `ctx.waitUntil` so it never delays the response.
- **Error outcome.** If `env.AI.run` throws, the gateway emits an `outcome: "error"` point (duration only, zero tokens) and rethrows — the caller's existing error handling is unchanged, and quota-exhaustion (4006) still surfaces through the existing `job_health`/`/health` path.

## Decision 2 — The activity taxonomy is a fixed, documented enum

`activity` is finer than a job name (one job spans several) and spans triggers (the same activity fires from cron and import). The enum, fixed and documented in `docs/SCHEMAS.md`:

```
 text-gen (mistral-small — the neuron-heavy calls; real usage tokens)
   classify            facet classification over recipe body
   describe            consumer description generation
   confirm-match       discovery taste-negation check
   title-clean         title-audit cleanup
   ingredient-confirm  ingredient-identity confirmation
   nightvibe-name      cluster naming / starter vibes

 embeddings (bge-base — cheap/batched/cached; input-length token estimate)
   embed-recipe · embed-discovery · embed-nightvibe · embed-taste ·
   embed-ingredient · embed-search · embed-admin-search
```

Passing a literal at each seam (not deriving it) keeps the taxonomy explicit and greppable, and lets one physical helper (`generateDescription`) report `describe` under `trigger: cron` from the reconcile and `trigger: import` from `create_recipe`.

## Decision 3 — `est_neurons`: a documented estimate anchored to the account total

The binding gives no neurons, so the gateway derives one:

- **text-gen:** real `prompt_tokens` + `completion_tokens` from `res.usage` × a per-model neuron rate.
- **embeddings:** input tokens estimated from the input text length (a `chars/4` heuristic) × the embed-model rate; `calls`/items = the batch size (≤25), so a batched embed is one point covering the batch.

The per-model rate lives in one documented constant in `src/ai.ts` (sourced from Cloudflare's published Workers AI pricing, the same source as the hardcoded `FREE_TIER_LIMITS.aiNeurons = 10_000`). Because it is an estimate, the panel **always renders the summed `est_neurons` against the account-level by-model actual** (`fetchUsage`'s `ai.by_model`, the canonical neuron source) — so the operator sees estimate-vs-actual side by side and the estimate's fidelity is self-evident, never presented as billing truth. Storing raw tokens *and* `est_neurons` (AE has ample slots) means a later rate correction recomputes forward from tokens without a schema change.

## Decision 4 — The `yamp_ai` slot contract is positional and documented

AE has no named columns; positions are the contract (reordering corrupts historical queries), so `docs/SCHEMAS.md` documents it like a table:

```
yamp_ai (Analytics Engine dataset — binding AI_AE)
  index1   = activity              (sampling key)
  blob1    = activity
  blob2    = model                 ("mistral-small" | "bge-base")
  blob3    = trigger               ("cron" | "import" | "request")
  blob4    = outcome               ("ok" | "error")
  double1  = duration_ms
  double2  = calls                 (1 for text-gen; batch size for embeddings)
  double3  = input_tokens          (text-gen: usage; embeddings: length estimate)
  double4  = output_tokens         (text-gen: usage; embeddings: 0)
  double5  = est_neurons           (derived from the rate table)
  timestamp= write time (AE-supplied)
```

Volume is comfortably within AE's free allocation and below the sampling threshold, so the series are exact: request-path calls are cache-gated to near-zero, and cron AI work is bounded by the per-tick caps (classify 6, describe 20, embed 100-in-batches-of-25, …).

## Decision 5 — The trigger dimension captures the import-time blind spot

`trigger ∈ { cron, import, request }` is the fix for "import-time AI is invisible": `create_recipe` → `seedRecipeDescription`/`seedRecipeFacets` call `generateDescription`/`classifyRecipe`, which now route through the gateway with `trigger: "import"`, so member-import spend becomes a first-class line without a separate ledger. `cron` is the reconcile/audit passes; `request` is the member/agent tool path (search/propose/suggest — cache-gated). The dimension is a blob, tenant-clean.

## Decision 6 — The panel answers "which activity" and "normal vs draining"

One aggregate read per screen (`GET /admin/api/usage/ai`) → an SQL query over `yamp_ai`:

```sql
SELECT blob1 AS activity, blob2 AS model, blob3 AS trigger,
       toStartOfDay(timestamp) AS day,
       count() AS calls, sum(double3) AS in_tok, sum(double4) AS out_tok,
       sum(double5) AS est_neurons
FROM yamp_ai
WHERE timestamp > now() - INTERVAL '30' DAY
GROUP BY activity, model, trigger, day ORDER BY day
```

The "Neurons by activity" panel (authored via the Claude Design project, rendered on the shared shadcn primitives per `src/admin/CLAUDE.md`):

- ranks activities by `est_neurons` share over the window, with the cron/import/request split;
- shows the summed estimate against the account-level by-model actual (Decision 3);
- **pairs each cron activity's series with its job backlog** — the `pending`/`describePending` counts already in `job_runs`, read via the existing `readAllJobRuns`/health readers — so a bounded, falling backlog reads as "draining, will finish" while high neurons at ≈0 backlog reads as steady churn or anomaly. This is the "normal vs draining" answer, and it is mostly *presentation* of one new series plus data the Status/Logs screens already read.

It follows the Usage-page discipline exactly: TanStack Query `status` union → `assertNever`; degraded/not-configured returned as a 200 payload, not a throw; URL owns any deep-linkable panel state.

## Decision 7 — Third AE dataset instance → extend the merge guard

`analytics_engine_datasets` is already on the `scripts/merge-wrangler-config.mjs` allowlist (from `usage-trends`), and the merge copies the whole array verbatim, so adding the `AI_AE`/`yamp_ai` entry to `wrangler.jsonc` propagates for free. The regression guard is the risk: the existing test asserts the *type* survives; it grows to assert **all three instances** (`yamp_usage`, `yamp_tool`, `yamp_ai`) survive, so a future edit can't silently drop one.

## Decision 8 — Graceful degradation, both ends

- **Emit:** `env.AI_AE?.writeDataPoint(...)` — unbound ⇒ no-op; a throw is swallowed; the AI call is unaffected.
- **Read:** `GET /admin/api/usage/ai` returns `{ configured: false }` when `CF_ACCOUNT_ID`/token is unset (no SQL call), and `upstream_unavailable` on a SQL/transport failure — the panel renders "not available", identical to the Trends/Tools panels. The account-total anchor reuses the existing `fetchUsage` path, so it degrades on the same config.

## Open questions / apply-time verification (gated, low-risk)

1. **Is `usage` populated at runtime for `mistral-small-3.1-24b`?** The type declares it on text-gen output; a type can lag runtime. A one-off `console.log(res.usage)` on a connected box (or the first deploy's `yamp_ai` rows) confirms it. If absent for our model, text-gen falls back to the same input-length token estimate as embeddings — the panel shape is unchanged, only the fidelity. Blocked in the planning sandbox (no deps, no `CF_ACCOUNT_ID`); it is an early task-0 apply gate, not a design fork.
2. **Current per-model neuron rates.** Record the published `mistral-small` / `bge-base` rates into the rate table at apply; the estimate-vs-actual panel anchor makes a stale constant visible rather than silently wrong.
3. **AE SQL token scope.** Reuse the `usage-trends` finding (Account Analytics: Read covers AE SQL); no new scope expected.

## Non-goals

Cap/budget forecasting or alerting (the user did not want a "how close to the limit" view — that framing stays on the existing neuron meter). An MCP tool (this is operator-only observability). Retiring or changing `yamp_usage`/`yamp_tool` (the per-job and per-tool tiers stay). Precise billing reconciliation (the account GraphQL total remains the billing truth; `est_neurons` is an attribution estimate).
