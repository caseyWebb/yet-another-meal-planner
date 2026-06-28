// Resource-usage observability (usage-observability capability). Backs the operator
// Usage view (`/admin/usage` → `GET /admin/api/usage`): account-wide KV-operation and
// Workers-AI-neuron consumption for the current UTC day, against the daily free-tier
// limits, so the operator can see what is eating which budget.
//
// The data has exactly one accurate source that costs ZERO KV: Cloudflare's GraphQL
// Analytics API. The `KVNamespace`/`Ai` bindings expose no usage counters, and counting
// keys via `KV.list()` would itself burn the (budget-constrained) list quota — so this
// module reaches the Analytics API by an outbound `fetch` from the Worker's egress and
// performs NO KV operation of its own. That property is the whole point: observing the
// budget must not consume it.
//
// Opt-in + fail-gracefully, mirroring the Access gate / ntfy: with `CF_ACCOUNT_ID` or
// `CF_ANALYTICS_TOKEN` unset, this returns `{ configured: false }` (no fetch), and the
// Usage page renders an explicit "not configured" state. Aggregate-only and tenant-clean
// by construction — account/namespace totals, never a per-tenant identifier.
//
// The GraphQL request is split from the response→payload mapping (`mapAccountUsage`,
// pure) so the shape logic is unit-testable without the network, the same discipline as
// src/embedding.ts. NOTE: Cloudflare evolves these dataset/field names; they are verified
// against the live schema as part of landing this capability (see the change's tasks).

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/** Cloudflare free-tier daily limits the Usage view measures against. Hardcoded (like the
 *  10,000-neuron allocation in health.ts); an operator on a paid plan edits these. */
export const FREE_TIER_LIMITS = {
  kv: { read: 100_000, write: 1_000, delete: 1_000, list: 1_000 },
  aiNeurons: 10_000,
} as const;

/** The four KV operation classes the Analytics API reports (its `actionType` dimension). */
export type KvAction = "read" | "write" | "delete" | "list";
const KV_ACTIONS: readonly KvAction[] = ["read", "write", "delete", "list"];

/** Per-action operation counts for a day (or one namespace's slice of it). */
export type KvCounts = Record<KvAction, number>;

/** One namespace's operation counts (keyed by the Analytics namespace id — a Worker cannot
 *  map ids back to binding names at runtime, so the view labels rows by id). */
export interface NamespaceUsage extends KvCounts {
  namespace_id: string;
}

export interface AiModelUsage {
  model: string;
  neurons: number;
}

/** The Usage payload returned to the admin API. A discriminated union so "configured but
 *  empty" is unrepresentable: an unconfigured deployment is `{ configured: false }`. */
export type UsageResult =
  | { configured: false }
  | {
      configured: true;
      generated_at: number;
      /** The UTC day (YYYY-MM-DD) the figures cover. */
      day: string;
      kv: {
        limits: typeof FREE_TIER_LIMITS.kv;
        totals: KvCounts;
        namespaces: NamespaceUsage[];
      };
      ai: {
        neurons_limit: number;
        neurons_used: number;
        by_model: AiModelUsage[];
      };
    };

/** The current UTC calendar day as `YYYY-MM-DD` (the Analytics `date` dimension's format). */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

const zeroCounts = (): KvCounts => ({ read: 0, write: 0, delete: 0, list: 0 });

/** Coerce an Analytics `actionType` to one of the four KV action classes, or null if unknown
 *  (a new/unexpected class is dropped rather than mis-bucketed). */
function asKvAction(raw: unknown): KvAction | null {
  return typeof raw === "string" && (KV_ACTIONS as readonly string[]).includes(raw) ? (raw as KvAction) : null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The slice of the GraphQL response this module reads: one account's two adaptive-group
 *  lists. Everything is optional/loosely typed because it is external data. */
interface AccountAnalytics {
  kvOperations?: { dimensions?: { namespaceId?: string; actionType?: string }; sum?: { requests?: number } }[];
  aiInference?: { dimensions?: { modelName?: string }; sum?: { neurons?: number } }[];
}

/**
 * Pure mapping of one account's analytics rows into the `UsageResult` payload. Sums KV
 * operations per namespace and per action (plus a grand total), and Workers AI neurons per
 * model (plus a total). Unknown action classes are dropped; missing numbers read as 0.
 */
export function mapAccountUsage(account: AccountAnalytics, day: string, nowMs: number): UsageResult {
  const byNamespace = new Map<string, KvCounts>();
  const totals = zeroCounts();
  for (const row of account.kvOperations ?? []) {
    const action = asKvAction(row.dimensions?.actionType);
    if (!action) continue;
    const nsId = row.dimensions?.namespaceId ?? "unknown";
    const requests = num(row.sum?.requests);
    const counts = byNamespace.get(nsId) ?? zeroCounts();
    counts[action] += requests;
    byNamespace.set(nsId, counts);
    totals[action] += requests;
  }
  const namespaces: NamespaceUsage[] = [...byNamespace.entries()]
    .map(([namespace_id, counts]) => ({ namespace_id, ...counts }))
    .sort((a, b) => b.write - a.write || b.read - a.read);

  const byModel = new Map<string, number>();
  for (const row of account.aiInference ?? []) {
    const model = row.dimensions?.modelName ?? "unknown";
    byModel.set(model, (byModel.get(model) ?? 0) + num(row.sum?.neurons));
  }
  const aiByModel: AiModelUsage[] = [...byModel.entries()]
    .map(([model, neurons]) => ({ model, neurons }))
    .sort((a, b) => b.neurons - a.neurons);
  const neuronsUsed = aiByModel.reduce((s, m) => s + m.neurons, 0);

  return {
    configured: true,
    generated_at: nowMs,
    day,
    kv: { limits: FREE_TIER_LIMITS.kv, totals, namespaces },
    ai: { neurons_limit: FREE_TIER_LIMITS.aiNeurons, neurons_used: neuronsUsed, by_model: aiByModel },
  };
}

/** The GraphQL query: today's KV operations (by namespace + action) and Workers AI neurons
 *  (by model) for one account. `$accountTag`/`$date` are bound from env + the current day. */
const USAGE_QUERY = `query Usage($accountTag: String!, $date: String!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      kvOperations: workersKvOperationsAdaptiveGroups(
        limit: 1000
        filter: { date: $date }
      ) {
        dimensions { namespaceId actionType }
        sum { requests }
      }
      aiInference: workersAiInferenceRequestsAdaptiveGroups(
        limit: 1000
        filter: { date: $date }
      ) {
        dimensions { modelName }
        sum { neurons }
      }
    }
  }
}`;

/** Injectable IO so `fetchUsage` is testable offline. */
export interface UsageDeps {
  fetchImpl: typeof fetch;
  now: () => number;
}

const defaultDeps: UsageDeps = { fetchImpl: fetch, now: () => Date.now() };

/**
 * Fetch the current UTC day's usage from the Cloudflare GraphQL Analytics API. Returns
 * `{ configured: false }` (with NO network call) when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN`
 * is unset. Maps a transport failure, a non-2xx, or a GraphQL `errors` payload to an
 * `upstream_unavailable` ToolError (the admin route serializes it). Performs no KV operation.
 */
export async function fetchUsage(env: Env, deps: UsageDeps = defaultDeps): Promise<UsageResult> {
  const accountTag = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_ANALYTICS_TOKEN?.trim();
  if (!accountTag || !token) return { configured: false };

  const nowMs = deps.now();
  const day = utcDay(nowMs);
  let res: Response;
  try {
    res = await deps.fetchImpl(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: USAGE_QUERY, variables: { accountTag, date: day } }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("upstream_unavailable", `Cloudflare Analytics request failed: ${message}`);
  }
  if (!res.ok) {
    throw new ToolError("upstream_unavailable", `Cloudflare Analytics returned HTTP ${res.status}`);
  }
  let body: {
    data?: { viewer?: { accounts?: AccountAnalytics[] } };
    errors?: { message?: string }[];
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("upstream_unavailable", `Cloudflare Analytics returned an unparseable body: ${message}`);
  }
  if (body.errors && body.errors.length > 0) {
    throw new ToolError("upstream_unavailable", `Cloudflare Analytics error: ${body.errors[0]?.message ?? "unknown"}`);
  }
  const account = body.data?.viewer?.accounts?.[0] ?? {};
  return mapAccountUsage(account, day, nowMs);
}
