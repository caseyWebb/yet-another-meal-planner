// The sale-scan-plan producer (satellite-sale-scan) — a `scheduled()` sibling of the flyer warm,
// NOT folded into the flyer-warm tick. Justification (Decision 3): the flyer warm SCANS in-Worker
// against the Kroger API (a cursor sweep bounded by the free-tier 50-external-subrequest cap); this
// producer only ENQUEUES `sale-scan` tasks (the satellite scans), spending ZERO external
// subrequests. Folding enqueue-only work into the subrequest-bounded sweep would muddy that budget.
//
// On a due cycle it builds the plan — distinct NON-KROGER `(store, locationId)` pairs from the
// union of tenants' primary/preferred stores — and enqueues one operator-scope `sale-scan` task per
// pair (idempotent per `dedup_key`), carrying the shared `flyer_terms`. Kroger stores are excluded
// (the Worker scans those itself). It is refresh-gated by a KV `sale-scan:cursor` (mirroring
// `flyer:cursor`) and prunes terminal rows each cycle so the recurring queue stays bounded. Empty
// plan today (no non-Kroger primary store in prod) → a clean no-op.
//
// `runSaleScanPlan` is the injectable, testable core; `runSaleScanPlanJob` is the health-writing
// `scheduled()` entry (mirrors `runWarmTick`/`runWarmJob`). All D1 goes through `src/db.ts` (the
// injected enqueue/prune), and the job is throw-free except a rethrow so cron status reflects a fail.

import type { Env } from "./env.js";
import type { KvStore } from "./kroger-user.js";
import { SALE_SCAN_KIND } from "@grocery-agent/contract";
import { KROGER_STORE, normalizeTerms } from "./flyer-warm.js";
import { directoryFromEnv } from "./tenant.js";
import { readPreferences } from "./profile-db.js";
import { readFlyerTerms } from "./corpus-db.js";
import { enqueueTask, pruneTerminalTasks, type NewTask } from "./satellite-tasks-db.js";
import { notifyFailure, recordUsagePoint, writeJobHealth, writeJobRun } from "./health.js";

/** The KV refresh marker — mirrors `flyer:cursor`, keyed distinctly so it never collides. */
const CURSOR_KEY = "sale-scan:cursor";

/** Default gap between fresh producer cycles — aligned to the flyer daily cadence (tunable). */
const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Terminal `sale-scan` rows older than this are pruned each cycle (bounds the recurring queue). */
const DEFAULT_PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

/** The KV refresh cursor value. */
interface SaleScanCursor {
  last_refresh_at: number;
}

/** A non-Kroger store a tenant fulfills from — the plan's unit. */
export interface StoreTarget {
  store: string;
  locationId: string;
}

/** Injected dependencies — fakes in tests, real clients via `buildSaleScanPlanDeps`. */
export interface SaleScanPlanDeps {
  kv: KvStore;
  /** Every tenant id (the tenant directory). */
  listTenantIds(): Promise<string[]>;
  /** A tenant's primary store slug + its rollup `locationId`, or null when no store is set. */
  readTenantStore(tenantId: string): Promise<StoreTarget | null>;
  /** The shared D1 `flyer_terms` broad terms (raw; normalization happens here). */
  readBroadTerms(): Promise<string[]>;
  /** Idempotent enqueue (change-2 `enqueueTask`). */
  enqueue(task: NewTask): Promise<{ enqueued: boolean; id: string }>;
  /** Prune terminal `sale-scan` rows older than `olderThan` epoch ms; returns the pruned count. */
  pruneTerminal(olderThan: number): Promise<number>;
  now(): number;
}

export interface SaleScanPlanConfig {
  refreshMs?: number;
  pruneAgeMs?: number;
}

/** What a cycle did — for tests/observability and the `sale-scan-plan` health summary. */
export interface SaleScanPlanResult {
  action: "planned" | "idle";
  /** Distinct non-Kroger (store, locationId) pairs in the plan. */
  pairs: number;
  /** Newly-enqueued tasks (0 on a re-run — idempotent per dedup_key). */
  enqueued: number;
  /** Terminal sale-scan rows pruned this cycle. */
  pruned: number;
  last_refresh_at: number;
}

async function readJson<T>(kv: KvStore, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Run one producer cycle. Refresh-gated: a cycle only starts when the KV cursor is due (mirroring
 * the flyer warm's gate); between cycles it is a cheap `idle` no-op. On a due cycle it builds the
 * plan (distinct NON-KROGER `(store, locationId)` from tenants' primary/preferred stores), enqueues
 * one operator-scope `sale-scan` task per pair (idempotent per `dedup_key = "sale-scan:{store}:{loc}"`),
 * prunes terminal rows, and advances the cursor. An EMPTY plan (no non-Kroger store) is a clean
 * no-op that still advances the cursor. Enqueue-only — issues no external store subrequest.
 */
export async function runSaleScanPlan(deps: SaleScanPlanDeps, config: SaleScanPlanConfig = {}): Promise<SaleScanPlanResult> {
  const refreshMs = config.refreshMs ?? DEFAULT_REFRESH_MS;
  const pruneAgeMs = config.pruneAgeMs ?? DEFAULT_PRUNE_AGE_MS;
  const now = deps.now();

  const cursor = await readJson<SaleScanCursor>(deps.kv, CURSOR_KEY);
  if (cursor && now - cursor.last_refresh_at < refreshMs) {
    return { action: "idle", pairs: 0, enqueued: 0, pruned: 0, last_refresh_at: cursor.last_refresh_at };
  }

  // Build the plan: distinct NON-KROGER (store, locationId) pairs from tenants' preferred stores.
  // Kroger stores are excluded — the Worker scans those itself via the flyer warm.
  const tenantIds = await deps.listTenantIds();
  const pairs = new Map<string, StoreTarget>();
  for (const id of tenantIds) {
    const target = await deps.readTenantStore(id);
    if (!target) continue;
    if (target.store === KROGER_STORE) continue;
    // NUL-join the dedup identity: a `locationId` that is a raw `preferred_location` label can
    // contain spaces, so a bare-space join could collide two distinct (store, locationId) pairs.
    pairs.set(`${target.store}\u0000${target.locationId}`, target);
  }

  // The full broad-term set rides in EACH task's payload (one task per store scans every term in
  // one authenticated session — Decision 2). Read once; empty terms → the satellite scans nothing.
  const terms = normalizeTerms(await deps.readBroadTerms());

  let enqueued = 0;
  for (const { store, locationId } of pairs.values()) {
    const r = await deps.enqueue({
      kind: SALE_SCAN_KIND,
      scope: "operator", // public-derived, cross-tenant — never tenant-scope (no per-tenant sale data)
      tenant: null, // the satellite_tasks CHECK requires operator-scope rows to carry no tenant
      dedupKey: `sale-scan:${store}:${locationId}`,
      payload: { store, locationId, terms },
    });
    if (r.enqueued) enqueued++;
  }

  // Prune terminal (done|failed) sale-scan rows so the recurring queue stays bounded.
  const pruned = await deps.pruneTerminal(now - pruneAgeMs);

  await deps.kv.put(CURSOR_KEY, JSON.stringify({ last_refresh_at: now } satisfies SaleScanCursor));
  return { action: "planned", pairs: pairs.size, enqueued, pruned, last_refresh_at: now };
}

/**
 * The `scheduled()` entry (mirrors `runWarmJob`): run one producer cycle, record the
 * `sale-scan-plan` `job_health` + `job_runs` row (ok with a summary, or fail), push an optional
 * ntfy alert on failure, and RETHROW so the platform's native cron status reflects a failure.
 */
export async function runSaleScanPlanJob(env: Env, deps: SaleScanPlanDeps, config: SaleScanPlanConfig = {}): Promise<void> {
  const startedAt = deps.now();
  try {
    const r = await runSaleScanPlan(deps, config);
    const summary = { action: r.action, pairs: r.pairs, enqueued: r.enqueued, pruned: r.pruned };
    await writeJobHealth(env, "sale-scan-plan", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "sale-scan-plan", { ok: true, ran_at: startedAt, duration_ms: deps.now() - startedAt, summary });
    // History point (usage-trends): doubles = [duration_ms, pairs, enqueued, pruned]. Additive, best-effort.
    recordUsagePoint(env, "sale-scan-plan", { ok: true, durationMs: deps.now() - startedAt, counts: [r.pairs, r.enqueued, r.pruned] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sale-scan-plan] cycle failed:", msg);
    await writeJobHealth(env, "sale-scan-plan", { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, "sale-scan-plan", { ok: false, ran_at: startedAt, duration_ms: deps.now() - startedAt, summary: { error: msg } });
    recordUsagePoint(env, "sale-scan-plan", { ok: false, durationMs: deps.now() - startedAt });
    await notifyFailure(env, "sale-scan-plan", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}

/**
 * Wire the real directory / profile / flyer-terms / queue clients for the scheduled handler. Runs
 * without an OAuth session: it enumerates the tenant directory and reads each tenant's primary store
 * + preferred_location from D1 directly (the enqueued sale-scan work is public-derived cross-tenant
 * state, not tenant-private). A NON-KROGER store's `preferred_location` label IS the rollup
 * `locationId` — the Worker has no API to resolve it, and the satellite reports under the same value.
 */
export function buildSaleScanPlanDeps(env: Env): SaleScanPlanDeps {
  const directory = directoryFromEnv(env);
  return {
    kv: env.KROGER_KV as unknown as KvStore,
    listTenantIds: () => directory.list(),
    async readTenantStore(tenantId) {
      const prefs = await readPreferences(env, tenantId);
      const stores = prefs?.stores as Record<string, unknown> | undefined;
      const store =
        typeof stores?.primary === "string" && stores.primary.trim()
          ? stores.primary.trim().toLowerCase()
          : KROGER_STORE;
      const label = typeof stores?.preferred_location === "string" ? stores.preferred_location : null;
      if (!label) return null;
      return { store, locationId: label };
    },
    readBroadTerms: () => readFlyerTerms(env),
    enqueue: (task) => enqueueTask(env, task),
    pruneTerminal: (olderThan) => pruneTerminalTasks(env, SALE_SCAN_KIND, olderThan),
    now: () => Date.now(),
  };
}
