// The single Workers AI gateway (ai-usage-attribution). Every `env.AI.run` inference the Worker
// performs routes through `runAi` here — the AI-call sibling of the tool-registration seam
// (`src/tool-instrumentation.ts`). One seam means one place that emits per-call attribution and one
// thing a reviewer flags (a raw `env.AI.run` outside this file bypasses the metering). The gateway
// captures WHICH activity spent the neurons — an attribution Cloudflare's account-level analytics,
// which groups only by model, cannot show (the Worker uses two models across ~13 activities).
//
// Each call emits ONE tenant-clean data point to the `yamp_ai` Analytics Engine dataset — activity,
// model, trigger, outcome, duration, item count, tokens, and an ESTIMATED neuron figure. Emission is
// best-effort and non-blocking (an unbound/throwing binding is a swallowed no-op that never changes
// the call), tenant-data-free by construction (labels + numbers only, never a slug/tenant/input
// text), and costs no KV/D1 budget — exactly like `recordUsagePoint`/`recordToolPoint`.
//
// Neurons are NOT reported per call by the binding (the Workers AI types carry no neuron field, and
// `usage` tokens only on text-generation output — not embeddings). So `est_neurons` is DERIVED from
// token counts × a per-model neuron rate (below), and the Usage panel renders the summed estimate
// AGAINST the account-level by-model actual so its fidelity is visible — it is an attribution
// estimate, never a billing figure.

import type { Env } from "./env.js";

/** Where an AI call was triggered from — the dimension that makes non-cron spend first-class. */
export type AiTrigger = "cron" | "import" | "request";

/**
 * The fixed attribution taxonomy — finer than a job name (one job spans several) and spanning
 * triggers (the same activity fires from cron and import). Text-gen activities carry the neuron-
 * heavy mistral spend; `embed-*` are the cheap/batched bge calls. Documented in `docs/SCHEMAS.md`.
 */
export type AiActivity =
  // text-gen (mistral-small) — the neuron-heavy calls; real `usage` tokens
  | "classify"
  | "describe"
  | "confirm-match"
  | "title-clean"
  | "ingredient-confirm"
  | "nightvibe-name"
  // embeddings (bge-base) — cheap/batched/cached; input-length token estimate
  | "embed-recipe"
  | "embed-discovery"
  | "embed-nightvibe"
  | "embed-taste"
  | "embed-ingredient"
  | "embed-search"
  | "embed-admin-search";

/** Per-model neuron rates (neurons per 1,000,000 tokens), from Cloudflare's published Workers AI
 *  pricing ($0.011 / 1,000 neurons). An estimate anchored to the account-level by-model actual the
 *  Usage panel shows alongside — a stale value surfaces as estimate-vs-actual drift, not silent
 *  error. Confirm against current pricing when the model set changes (the change's task 0.2). */
interface ModelNeuronRate {
  /** Neurons per 1M input (prompt) tokens. */
  inPerM: number;
  /** Neurons per 1M output (completion) tokens. Embeddings produce none. */
  outPerM: number;
}
const MODEL_NEURON_RATES: Record<string, ModelNeuronRate> = {
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { inPerM: 31876, outPerM: 50488 },
  "@cf/baai/bge-base-en-v1.5": { inPerM: 6058, outPerM: 0 },
};

/** Short, low-cardinality model label for the `yamp_ai` `blob2` slot (the full id is verbose and
 *  the panel groups by family). Falls back to the raw id for an unmapped model. */
export function modelLabel(model: string): string {
  if (model.includes("mistral")) return "mistral-small";
  if (model.includes("bge")) return "bge-base";
  return model;
}

/** Estimate the neuron cost of a call from its token counts and the per-model rate. Returns 0 for
 *  an unmapped model (the account meter stays the neuron truth). Pure — unit-testable without a
 *  binding, like `cosineSimilarity`. */
export function estimateNeurons(model: string, inputTokens: number, outputTokens: number): number {
  const rate = MODEL_NEURON_RATES[model];
  if (!rate) return 0;
  return (inputTokens / 1_000_000) * rate.inPerM + (outputTokens / 1_000_000) * rate.outPerM;
}

/** Rough input-token estimate (~4 chars/token) for models that report no `usage` — the embeddings
 *  (bge) return `{ data }` with no token counts. Pure. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The call context every seam passes: WHICH activity and (optionally) which trigger. */
export interface AiCall {
  activity: AiActivity;
  /** Where the call was driven from. Default `"cron"` (the reconcile/audit path); import/request
   *  callers pass their own. */
  trigger?: AiTrigger;
  /** Items in this call: 1 for a text-gen call, the batch size for a batched embedding call.
   *  Default 1. */
  calls?: number;
  /** Input-token estimate used when the response carries no `usage` (embeddings). Ignored when the
   *  response reports real `usage.prompt_tokens` (text-gen). */
  inputTokensEstimate?: number;
}

/** What an embedding caller passes — just WHICH activity and (optionally) the trigger. The item
 *  count and input-token estimate are derived inside the embed helper from the texts it holds. */
export type AiEmbedContext = { activity: AiActivity; trigger?: AiTrigger };

/** The Workers AI text-gen `usage` shape (present on text-generation output; absent on embeddings).
 *  Read structurally so the gateway stays model-agnostic. */
interface UsageShape {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Emit ONE tenant-clean per-call data point to the `yamp_ai` Analytics Engine dataset. The
 * blob/double **slot layout is a documented positional contract** (`docs/SCHEMAS.md`); a later
 * change MUST NOT reorder existing slots:
 *
 *   indexes: [activity]                                   — the sampling key
 *   blobs:   [activity, model, trigger, ok ? "ok":"error"]
 *   doubles: [duration_ms, calls, input_tokens, output_tokens, est_neurons]
 *
 * **Best-effort and non-blocking**, exactly like `recordUsagePoint`/`recordToolPoint`: an unbound
 * `AI_AE` is a silent no-op (`AI_AE?.`) and a throw is swallowed, so instrumentation never changes
 * a call's result. **Tenant-clean by construction** — only the activity (a fixed enum), model,
 * trigger, outcome, and numbers; never a per-tenant id or input text. AE `writeDataPoint` is
 * non-blocking and consumes neither the KV nor the D1 budget.
 */
export function recordAiPoint(
  env: Pick<Env, "AI_AE">,
  point: {
    activity: AiActivity;
    trigger: AiTrigger;
    model: string;
    ok: boolean;
    durationMs: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  },
): void {
  try {
    const estNeurons = estimateNeurons(point.model, point.inputTokens, point.outputTokens);
    env.AI_AE?.writeDataPoint({
      indexes: [point.activity],
      blobs: [point.activity, modelLabel(point.model), point.trigger, point.ok ? "ok" : "error"],
      doubles: [point.durationMs, point.calls, point.inputTokens, point.outputTokens, estNeurons],
    });
  } catch {
    // Emission must never affect the call — swallow (mirrors recordUsagePoint / recordToolPoint).
  }
}

/**
 * Run one Workers AI inference through the single metered seam. Returns the RAW binding response
 * (typed by the caller's `T`), so a caller destructures `.response` / `.data` exactly as it did
 * against `env.AI.run`. Reads `usage` token counts off text-gen output automatically; falls back to
 * the caller's `inputTokensEstimate` for embeddings. Emits an `ok` point on success and an `error`
 * point (duration only, zero tokens) on a throw — then rethrows, so the caller's existing error
 * handling (the structured-error mapping, the 4006 quota path) is unchanged.
 */
export async function runAi<T>(
  env: Pick<Env, "AI" | "AI_AE">,
  call: AiCall,
  model: string,
  input: Record<string, unknown>,
): Promise<T> {
  const trigger = call.trigger ?? "cron";
  const calls = call.calls ?? 1;
  const started = Date.now();
  let res: T;
  try {
    // The binding's `run` is overloaded per model literal; the gateway is model-generic, so we cast
    // through a widened signature (the same `as unknown` escape hatch the call sites used inline).
    res = (await (env.AI.run as unknown as (m: string, i: unknown) => Promise<unknown>)(model, input)) as T;
  } catch (e) {
    recordAiPoint(env, {
      activity: call.activity,
      trigger,
      model,
      ok: false,
      durationMs: Date.now() - started,
      calls,
      inputTokens: 0,
      outputTokens: 0,
    });
    throw e;
  }
  const usage = (res as UsageShape)?.usage;
  const inputTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : (call.inputTokensEstimate ?? 0);
  const outputTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0;
  recordAiPoint(env, {
    activity: call.activity,
    trigger,
    model,
    ok: true,
    durationMs: Date.now() - started,
    calls,
    inputTokens,
    outputTokens,
  });
  return res;
}
