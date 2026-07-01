// Resource-usage observability (usage-observability capability). Backs the operator
// Usage view (server-rendered at `/admin/usage`): account-wide KV-operation and
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

/** How many days of history the trends/tool-usage/per-namespace-KV queries cover (AE free-tier
 *  retention is ≈90 days; this is also the window the per-namespace KV history widens to, per
 *  design.md Decision 1/4 — one shared window across all three history surfaces). */
export const TRENDS_WINDOW_DAYS = 30;

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

/** A namespace's resolved display identity: the binding name it maps to and a stable
 *  categorical color, or the "unlabeled" fallback (Decision 2) for an id the Worker has no
 *  mapping for — never dropped, just shown generically. */
export type NamespaceLabel = { label: string; color: string; unlabeled: false } | { label: string; color: string; unlabeled: true };

/** One namespace's operation counts (keyed by the Analytics namespace id) plus its resolved
 *  label/color (an unmapped id still reports counts, with the "unlabeled" fallback). */
export interface NamespaceUsage extends KvCounts {
  namespace_id: string;
  resolved: NamespaceLabel;
}

export interface AiModelUsage {
  model: string;
  neurons: number;
}

/** One day's per-namespace KV-operation counts within the history window. Every namespace seen
 *  ANYWHERE in the window appears in every day's entry (zero-filled), so a day with no activity
 *  for a namespace reports `0`, never an absent entry. */
export interface KvHistoryDay {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  namespaces: NamespaceUsage[];
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
        /** Per-namespace, per-day history over `history.window_days` (oldest → newest), the
         *  same window `usage-trends`/`tool-usage-trends` use. Sourced from the same GraphQL
         *  Analytics API the snapshot uses, widened to a date range — zero additional KV cost. */
        history: { window_days: number; days: KvHistoryDay[] };
      };
      ai: {
        neurons_limit: number;
        neurons_used: number;
        by_model: AiModelUsage[];
      };
    };

/** The current UTC calendar day as `YYYY-MM-DD` (the KV `date` dimension's format; the AI bounds
 *  append `THH:00:00Z` to it for the `datetimeHour` dimension). */
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

// ─────────────────────────────────────────────────────────────────────────────
// Namespace label/color resolution (usage-observability: "KV namespace ids resolve to a
// friendly label and display color"). A Worker cannot map a Cloudflare KV `namespaceId` back to
// its `wrangler.jsonc` binding name at runtime (the `KVNamespace` binding exposes no id
// accessor) — so this is a STATIC mapping, never a Cloudflare REST lookup: a small fixed
// binding-name → {label, color} palette in code, joined against an operator-pasted
// `KV_NAMESPACE_LABELS` env var (`id:BINDING,id:BINDING`, see env.ts) that records which id is
// which binding. An id with no entry resolves to the generic "unlabeled" fallback — it still
// reports its counts, just without a friendly label/color, so aggregate totals stay accurate
// even when labeling is incomplete (a fresh deploy, or a future 4th namespace).

/** The three known KV bindings (wrangler.jsonc `kv_namespaces`), each a fixed display color from
 *  a small warm categorical palette (mirrors the design mock's `--kv-kroger`/`--kv-oauth`/
 *  `--kv-tenant` swatches). Colors are NOT operator-configurable — only the id→binding join is. */
const NAMESPACE_PALETTE: Record<string, { color: string }> = {
  KROGER_KV: { color: "var(--kv-kroger)" },
  OAUTH_KV: { color: "var(--kv-oauth)" },
  TENANT_KV: { color: "var(--kv-tenant)" },
};

/** The generic fallback for a namespace id with no resolvable binding name. */
const UNLABELED_COLOR = "var(--kv-unlabeled)";

/** Parse the operator's `KV_NAMESPACE_LABELS` var (`id:BINDING,id:BINDING`, whitespace-tolerant)
 *  into an id → binding-name map. Malformed pairs (no `:`, empty id/binding) are dropped rather
 *  than throwing — a typo degrades to "unlabeled" for that one id, not a broken page. */
function parseNamespaceLabels(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (raw ?? "").split(",")) {
    const [id, binding] = pair.split(":").map((s) => s.trim());
    if (id && binding) out.set(id, binding);
  }
  return out;
}

/** Resolve a namespace id to its display identity, given the operator's id→binding map. An id
 *  with no entry — or whose mapped binding isn't one of the known three — gets the generic
 *  "unlabeled" fallback (raw id as the label) rather than being dropped. Makes no outbound
 *  request: purely a static-table lookup (the "no additional Cloudflare API call" scenario). */
export function resolveNamespaceLabel(namespaceId: string, idToBinding: Map<string, string>): NamespaceLabel {
  const binding = idToBinding.get(namespaceId);
  const swatch = binding ? NAMESPACE_PALETTE[binding] : undefined;
  if (binding && swatch) return { label: binding, color: swatch.color, unlabeled: false };
  return { label: namespaceId, color: UNLABELED_COLOR, unlabeled: true };
}

/** The slice of the GraphQL response this module reads: one account's two adaptive-group
 *  lists. Everything is optional/loosely typed because it is external data. */
interface AccountAnalytics {
  kvOperations?: { dimensions?: { namespaceId?: string; actionType?: string; date?: string }; sum?: { requests?: number } }[];
  aiInference?: { dimensions?: { modelId?: string }; sum?: { totalNeurons?: number } }[];
}

/**
 * Pure mapping of one account's analytics rows into the `UsageResult` payload. Sums KV
 * operations per namespace and per action (plus a grand total), and Workers AI neurons per
 * model (plus a total). Unknown action classes are dropped; missing numbers read as 0. Resolves
 * each namespace's label/color via the static `idToBinding` map (empty map → every namespace
 * "unlabeled", still correctly totaled).
 */
export function mapAccountUsage(
  account: AccountAnalytics,
  day: string,
  nowMs: number,
  idToBinding: Map<string, string> = new Map(),
  history: { window_days: number; days: KvHistoryDay[] } = { window_days: TRENDS_WINDOW_DAYS, days: [] },
): UsageResult {
  const byNamespace = new Map<string, KvCounts>();
  const totals = zeroCounts();
  for (const row of account.kvOperations ?? []) {
    const action = asKvAction(row.dimensions?.actionType);
    if (!action) continue;
    const nsId = row.dimensions?.namespaceId ?? "unknown";
    // KV requests are an operation count (integral), but round defensively so every count the
    // payload exposes as INT actually is one — the same invariant the neuron rounding below holds.
    const requests = Math.round(num(row.sum?.requests));
    const counts = byNamespace.get(nsId) ?? zeroCounts();
    counts[action] += requests;
    byNamespace.set(nsId, counts);
    totals[action] += requests;
  }
  const namespaces: NamespaceUsage[] = [...byNamespace.entries()]
    .map(([namespace_id, counts]) => ({ namespace_id, ...counts, resolved: resolveNamespaceLabel(namespace_id, idToBinding) }))
    .sort((a, b) => b.write - a.write || b.read - a.read);

  const byModel = new Map<string, number>();
  for (const row of account.aiInference ?? []) {
    const model = row.dimensions?.modelId ?? "unknown";
    byModel.set(model, (byModel.get(model) ?? 0) + num(row.sum?.totalNeurons));
  }
  // Cloudflare reports neurons as a fractional amount (e.g. 10453.8); the usage meter is a whole-
  // neuron budget gauge, so round each model's total to an integer (matching the integer KV meters
  // and the `neurons`/`neurons_used` INT contract the admin payload exposes).
  const aiByModel: AiModelUsage[] = [...byModel.entries()]
    .map(([model, neurons]) => ({ model, neurons: Math.round(neurons) }))
    .sort((a, b) => b.neurons - a.neurons);
  const neuronsUsed = aiByModel.reduce((s, m) => s + m.neurons, 0);

  return {
    configured: true,
    generated_at: nowMs,
    day,
    kv: { limits: FREE_TIER_LIMITS.kv, totals, namespaces, history },
    ai: { neurons_limit: FREE_TIER_LIMITS.aiNeurons, neurons_used: neuronsUsed, by_model: aiByModel },
  };
}

/** The GraphQL `kvOperationsAdaptiveGroups` row shape shared by the today-snapshot and the
 *  history-range query (the same dimensions/metric; the history query adds `date`). */
interface KvOperationRow {
  dimensions?: { namespaceId?: string; actionType?: string; date?: string };
  sum?: { requests?: number };
}

/**
 * Pure mapping of a 30-day-ranged `kvOperationsAdaptiveGroups` response into the per-namespace
 * history series, ascending by day. Every namespace observed ANYWHERE in the window is zero-
 * filled into EVERY day's entry — a day with no rows for a namespace still reports `0` for that
 * namespace's four actions, never an absent entry (the per-namespace history requirement). Days
 * with literally zero rows anywhere are synthesized from `windowStartDay`..`windowEndDay`
 * inclusive, so the series never has a gap even on a quiet day.
 */
export function mapKvHistory(
  rows: KvOperationRow[],
  windowStartDay: string,
  windowEndDay: string,
  idToBinding: Map<string, string>,
): { window_days: number; days: KvHistoryDay[] } {
  // byDay[day][nsId] = counts
  const byDay = new Map<string, Map<string, KvCounts>>();
  const allNsIds = new Set<string>();
  for (const row of rows) {
    const action = asKvAction(row.dimensions?.actionType);
    if (!action) continue;
    const day = typeof row.dimensions?.date === "string" ? row.dimensions.date.slice(0, 10) : "";
    if (!day) continue;
    const nsId = row.dimensions?.namespaceId ?? "unknown";
    allNsIds.add(nsId);
    const dayMap = byDay.get(day) ?? new Map<string, KvCounts>();
    const counts = dayMap.get(nsId) ?? zeroCounts();
    counts[action] += Math.round(num(row.sum?.requests));
    dayMap.set(nsId, counts);
    byDay.set(day, dayMap);
  }

  // Enumerate every UTC day in [windowStartDay, windowEndDay] inclusive, ascending — so the
  // series has no gap even for a day with zero rows anywhere.
  const days: string[] = [];
  const start = new Date(`${windowStartDay}T00:00:00Z`).getTime();
  const end = new Date(`${windowEndDay}T00:00:00Z`).getTime();
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));

  const nsIds = [...allNsIds].sort();
  const historyDays: KvHistoryDay[] = days.map((day) => {
    const dayMap = byDay.get(day);
    const namespaces: NamespaceUsage[] = nsIds.map((namespace_id) => {
      const counts = dayMap?.get(namespace_id) ?? zeroCounts();
      return { namespace_id, ...counts, resolved: resolveNamespaceLabel(namespace_id, idToBinding) };
    });
    return { day, namespaces };
  });

  return { window_days: days.length, days: historyDays };
}

/** The current UTC calendar day minus `n` days, as `YYYY-MM-DD`. */
function utcDayMinus(nowMs: number, n: number): string {
  return new Date(nowMs - n * 86_400_000).toISOString().slice(0, 10);
}

/** The GraphQL query for one account's current-day usage PLUS the trailing per-namespace KV
 *  history: KV operations (by namespace + action + date, the date range covering the history
 *  window) from `kvOperationsAdaptiveGroups`, and Workers AI neurons (by model, today only) from
 *  `aiInferenceAdaptiveGroups`. The KV query is intentionally the SAME `kvOperationsAdaptiveGroups`
 *  node the same-day snapshot already used, widened from a single-day filter to a `windowStartDay`..
 *  `today` range with `date` added to `dimensions` (design.md Decision 1 / Decision 4: one widened
 *  query, additive — the existing today-only behavior is the last day of this same series, not a
 *  separate code path). The two datasets filter on different time dimensions — KV by `date`, AI by
 *  `datetimeHour` — so both ranges are inlined (server-controlled `YYYY-MM-DD`, no injection surface)
 *  and only `$accountTag` is a bound variable. Field/dimension/metric names match the live schema: KV
 *  `namespaceId`/`actionType`/`date` with `sum { requests }`; AI `modelId` with `sum { totalNeurons }`.
 *  Row-cap note (design.md Decision 1): `limit: 1000` comfortably covers this Worker's
 *  namespaces(~3) × actions(4) × days(30) ≈ 360 rows; a response landing exactly at 1000 rows would
 *  indicate truncation — not expected at this Worker's namespace count, but worth knowing about if it
 *  ever shows up in production telemetry. */
const usageQuery = (windowStartDay: string, today: string) => `query Usage($accountTag: String!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      kvOperations: kvOperationsAdaptiveGroups(
        limit: 1000
        filter: { date_geq: "${windowStartDay}", date_leq: "${today}" }
      ) {
        dimensions { namespaceId actionType date }
        sum { requests }
      }
      aiInference: aiInferenceAdaptiveGroups(
        limit: 1000
        filter: { datetimeHour_geq: "${today}T00:00:00Z", datetimeHour_leq: "${today}T23:00:00Z" }
      ) {
        dimensions { modelId }
        sum { totalNeurons }
      }
    }
  }
}`;

/** Injectable IO so `fetchUsage` is testable offline. */
export interface UsageDeps {
  fetchImpl: typeof fetch;
  now: () => number;
}

// `fetch` is bound to the global scope: it is invoked below as `deps.fetchImpl(...)`,
// and an unbound global `fetch` called as a method rebinds `this` to the deps object,
// which workerd rejects with "Illegal invocation: function called with incorrect `this`
// reference". Bind once here so every fetcher sharing these deps is safe. Exported so the
// regression guard can exercise this real default detached from its object (the injected-
// fetchImpl tests cannot catch a `this`-binding regression).
export const defaultDeps: UsageDeps = { fetchImpl: fetch.bind(globalThis), now: () => Date.now() };

/**
 * Fetch the current UTC day's usage — PLUS the trailing `TRENDS_WINDOW_DAYS`-day per-namespace
 * KV history — from the Cloudflare GraphQL Analytics API. Returns `{ configured: false }` (with
 * NO network call) when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` is unset. Maps a transport failure,
 * a non-2xx, or a GraphQL `errors` payload to an `upstream_unavailable` ToolError (the admin
 * route serializes it). Performs no KV operation. The KV rows the widened query returns cover
 * both today (the existing snapshot) and the history window — today's snapshot is the SAME rows
 * re-aggregated without the `date` dimension, not a second query (design.md Decision 4).
 */
export async function fetchUsage(env: Env, deps: UsageDeps = defaultDeps): Promise<UsageResult> {
  const accountTag = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_ANALYTICS_TOKEN?.trim();
  if (!accountTag || !token) return { configured: false };

  const nowMs = deps.now();
  const today = utcDay(nowMs);
  const windowStartDay = utcDayMinus(nowMs, TRENDS_WINDOW_DAYS - 1);
  const idToBinding = parseNamespaceLabels(env.KV_NAMESPACE_LABELS);
  let res: Response;
  try {
    res = await deps.fetchImpl(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: usageQuery(windowStartDay, today), variables: { accountTag } }),
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
  // Today's snapshot is just today's slice of the same widened response (filter the ranged rows
  // to `date === today`), not a separate request — `mapAccountUsage` keeps its existing
  // single-day aggregation, fed only the rows for today.
  const todayRows = (account.kvOperations ?? []).filter((r) => r.dimensions?.date === today || r.dimensions?.date == null);
  const history = mapKvHistory(account.kvOperations ?? [], windowStartDay, today, idToBinding);
  return mapAccountUsage({ ...account, kvOperations: todayRows }, today, nowMs, idToBinding, history);
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage TRENDS (usage-trends): the per-job HISTORY tier, read from the Workers Analytics
// Engine SQL API — complementing the account-level GraphQL snapshot above and the `job_health`
// D1 liveness row. Each background job emits one data point per run to the `grocery_usage` AE
// dataset (src/health.ts `recordUsagePoint`); this reads them back as a per-job/per-day series.
//
// CORRECTION to the snapshot above: built-in datasets (KV ops, AI neurons) use the GraphQL
// Analytics API; a CUSTOM AE dataset uses the AE SQL API instead — `POST /accounts/<id>/
// analytics_engine/sql` with a SQL string body and the same bearer token. So this is a SECOND
// client (SQL, not GraphQL), reusing `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN`. The endpoint + bearer
// auth are confirmed against the live API (a wrongly-scoped token gets a structured HTTP 403
// "Authorization error", not a 404), so the token MUST carry the **Account Analytics: Read** scope
// — the same scope the GraphQL snapshot needs, but it is checked independently here, so verify it
// covers AE SQL on a connected account. The success-path envelope (`{ data: [...] }`, the rows this
// reads) follows Cloudflare's documented AE SQL shape; confirm it against a properly-scoped token
// once data has been written. Performs NO KV or D1 operation (an outbound `fetch` only), and opt-in:
// `{ configured: false }` when unset.

/** The AE SQL endpoint (account-scoped; the dataset is named in the FROM clause). */
const aeSqlEndpoint = (accountTag: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountTag}/analytics_engine/sql`;

/** One job's metrics for a single UTC day. */
export interface TrendDay {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  /** Number of runs that day. */
  runs: number;
  /** Mean run duration (ms) that day. */
  avg_ms: number;
  /** Summed run duration (ms) that day. */
  total_ms: number;
}

/** One job's day-by-day series over the window (ascending by day). */
export interface JobTrend {
  job: string;
  days: TrendDay[];
}

/** The trends payload returned to the admin API. A discriminated union mirroring `UsageResult`,
 *  so "configured but empty" is unrepresentable: an unconfigured deployment is `{ configured: false }`. */
export type TrendsResult =
  | { configured: false }
  | { configured: true; generated_at: number; window_days: number; jobs: JobTrend[] };

/** The AE SQL `data` row shape (loosely typed — external data; numbers may arrive as strings). */
interface TrendRow {
  job?: unknown;
  day?: unknown;
  runs?: unknown;
  avg_ms?: unknown;
  total_ms?: unknown;
}

/** Coerce an AE SQL scalar (number or numeric string) to a finite number, else 0. */
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Normalize an AE SQL day value (e.g. `"2026-06-28 00:00:00"` or an ISO string) to `YYYY-MM-DD`. */
function toDay(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 10) : "";
}

/**
 * Pure mapping of AE SQL `data` rows into per-job series. Groups by `job`, coerces the numeric
 * columns, and orders each job's days ascending (jobs ordered by name) so the panel renders a
 * stable series. Rows with no job name are dropped.
 */
export function mapTrendRows(rows: TrendRow[], nowMs: number, windowDays: number): TrendsResult {
  const byJob = new Map<string, TrendDay[]>();
  for (const row of rows) {
    const job = typeof row.job === "string" ? row.job : "";
    if (!job) continue;
    const days = byJob.get(job) ?? [];
    days.push({ day: toDay(row.day), runs: toNum(row.runs), avg_ms: toNum(row.avg_ms), total_ms: toNum(row.total_ms) });
    byJob.set(job, days);
  }
  const jobs: JobTrend[] = [...byJob.entries()]
    .map(([job, days]) => ({ job, days: days.sort((a, b) => a.day.localeCompare(b.day)) }))
    .sort((a, b) => a.job.localeCompare(b.job));
  return { configured: true, generated_at: nowMs, window_days: windowDays, jobs };
}

/** The AE SQL query: per-job, per-day run count + mean/total duration over the window. `double1`
 *  is the run duration (the documented slot-1 metric); `blob1` is the job name. */
const trendsSql = (windowDays: number) =>
  `SELECT blob1 AS job, toStartOfDay(timestamp) AS day, ` +
  `count() AS runs, avg(double1) AS avg_ms, sum(double1) AS total_ms ` +
  `FROM grocery_usage ` +
  `WHERE timestamp > now() - INTERVAL '${windowDays}' DAY ` +
  `GROUP BY job, day ORDER BY day ASC`;

/**
 * Fetch the per-job usage trends from the Analytics Engine SQL API. Returns `{ configured: false }`
 * (with NO network call) when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` is unset. Maps a transport
 * failure, a non-2xx, or an unparseable body to an `upstream_unavailable` ToolError (the admin
 * route serializes it). Performs no KV or D1 operation.
 */
export async function fetchUsageTrends(env: Env, deps: UsageDeps = defaultDeps): Promise<TrendsResult> {
  const accountTag = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_ANALYTICS_TOKEN?.trim();
  if (!accountTag || !token) return { configured: false };

  const nowMs = deps.now();
  let res: Response;
  try {
    res = await deps.fetchImpl(aeSqlEndpoint(accountTag), {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: `Bearer ${token}` },
      body: trendsSql(TRENDS_WINDOW_DAYS),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("upstream_unavailable", `Analytics Engine SQL request failed: ${message}`);
  }
  if (!res.ok) {
    throw new ToolError("upstream_unavailable", `Analytics Engine SQL returned HTTP ${res.status}`);
  }
  let body: { data?: TrendRow[] };
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("upstream_unavailable", `Analytics Engine SQL returned an unparseable body: ${message}`);
  }
  return mapTrendRows(body.data ?? [], nowMs, TRENDS_WINDOW_DAYS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool usage TRENDS (tool-usage-trends): the per-MCP-tool-call HISTORY tier, read from the
// Workers Analytics Engine SQL API over the `grocery_tool` dataset (the request-path sibling of
// `grocery_usage`). Every tool call emits one tenant-clean point (tool, ok/error, duration) via
// the buildServer registration decorator (`src/tool-instrumentation.ts` → `recordToolPoint`);
// this reads them back as per-tool aggregates — call count, error count, and latency percentiles.
// A SECOND AE SQL client reusing `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN`, performing NO KV or D1.

/** One tool's aggregate metrics over the window. `errors`/`calls` give the error RATE (derived in
 *  the view, never stored); `p50_ms`/`p95_ms` are duration percentiles (p95 catches the tail). */
export interface ToolUsage {
  tool: string;
  /** Number of calls in the window. */
  calls: number;
  /** Number of those calls that returned a structured error (or threw). */
  errors: number;
  /** Median call duration (ms). */
  p50_ms: number;
  /** 95th-percentile call duration (ms) — the request-path tail. */
  p95_ms: number;
}

/** The tool-usage payload returned to the admin API. A discriminated union mirroring `TrendsResult`,
 *  so "configured but empty" is unrepresentable: an unconfigured deployment is `{ configured: false }`. */
export type ToolUsageResult =
  | { configured: false }
  | { configured: true; generated_at: number; window_days: number; tools: ToolUsage[] };

/** The AE SQL `data` row shape for the tool query (loosely typed — numbers may arrive as strings). */
interface ToolUsageRow {
  tool?: unknown;
  calls?: unknown;
  errors?: unknown;
  p50_ms?: unknown;
  p95_ms?: unknown;
}

/**
 * Pure mapping of AE SQL `data` rows into per-tool aggregates, ordered by call count descending
 * (ties broken by name) so the panel renders busiest-first. Rows with no tool name are dropped;
 * numeric columns are coerced (missing → 0).
 */
export function mapToolUsageRows(rows: ToolUsageRow[], nowMs: number, windowDays: number): ToolUsageResult {
  const tools: ToolUsage[] = [];
  for (const row of rows) {
    const tool = typeof row.tool === "string" ? row.tool : "";
    if (!tool) continue;
    tools.push({
      tool,
      calls: toNum(row.calls),
      errors: toNum(row.errors),
      p50_ms: toNum(row.p50_ms),
      p95_ms: toNum(row.p95_ms),
    });
  }
  tools.sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  return { configured: true, generated_at: nowMs, window_days: windowDays, tools };
}

/** The AE SQL query: per-tool call count, error count, and p50/p95 duration over the window.
 *  `double1` is the call duration; `blob1` the tool name; `blob2` the outcome (`ok`|`error`). */
const toolUsageSql = (windowDays: number) =>
  `SELECT blob1 AS tool, count() AS calls, ` +
  `sum(blob2 = 'error') AS errors, ` +
  `quantileWeighted(0.5)(double1, 1) AS p50_ms, ` +
  `quantileWeighted(0.95)(double1, 1) AS p95_ms ` +
  `FROM grocery_tool ` +
  `WHERE timestamp > now() - INTERVAL '${windowDays}' DAY ` +
  `GROUP BY tool ORDER BY calls DESC`;

/**
 * Fetch the per-tool usage aggregates from the Analytics Engine SQL API. Returns
 * `{ configured: false }` (with NO network call) when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` is
 * unset. Maps a transport failure, a non-2xx, or an unparseable body to an `upstream_unavailable`
 * ToolError (the admin route serializes it). Performs no KV or D1 operation.
 */
export async function fetchToolUsage(env: Env, deps: UsageDeps = defaultDeps): Promise<ToolUsageResult> {
  const accountTag = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_ANALYTICS_TOKEN?.trim();
  if (!accountTag || !token) return { configured: false };

  const nowMs = deps.now();
  let res: Response;
  try {
    res = await deps.fetchImpl(aeSqlEndpoint(accountTag), {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: `Bearer ${token}` },
      body: toolUsageSql(TRENDS_WINDOW_DAYS),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("upstream_unavailable", `Analytics Engine SQL request failed: ${message}`);
  }
  if (!res.ok) {
    throw new ToolError("upstream_unavailable", `Analytics Engine SQL returned HTTP ${res.status}`);
  }
  let body: { data?: ToolUsageRow[] };
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("upstream_unavailable", `Analytics Engine SQL returned an unparseable body: ${message}`);
  }
  return mapToolUsageRows(body.data ?? [], nowMs, TRENDS_WINDOW_DAYS);
}
