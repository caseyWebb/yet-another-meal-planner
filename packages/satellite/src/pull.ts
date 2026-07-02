// The pull-channel client (satellite-sale-scan) — the FIRST capability to consume the change-2
// pull channel from the satellite side. Strictly OUTBOUND-ONLY: the satellite CLAIMS work
// (`POST /satellite/tasks/claim`), runs the mapped adapter behind the operator's session, and
// REPORTS the result (`POST /satellite/results` with `sale` observations, or a `failed` reason).
// The Worker never dials in. Reuses the push transport/backoff idioms from ./push.ts.
//
// Correctness rests on RESULT-side arrival dedup in the Worker (a double-run of the same scan
// replaces the store rollup to the same rows), NOT on the lease — so a re-run is always safe.

import {
  parseSaleScanPayload,
  SALE_SCAN_KIND,
  type ClaimResponse,
  type SaleObservation,
  type TaskEnvelope,
} from "@grocery-agent/contract";
import type { SatelliteConfig, ScanStoreConfig } from "./config.js";
import type { FetchTier } from "./fetch.js";
import type { StorageState } from "./session.js";
import type { Logger } from "./adapter.js";
import type { FetchImpl, PushOptions } from "./push.js";
import { loadSaleAdapters, runScanAdapter, type SaleAdapterFactory, type ScanSdk } from "./sale-adapter.js";

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Everything runPullTick needs, injected so it's testable without real I/O (mirrors TickDeps). */
export interface PullDeps {
  /** Load a store's session (real: from the volume; fake: in-memory). Null when uncaptured. */
  loadSession(storeId: string): StorageState | null;
  /** The fetch tier for a store (real: selectTier over a shared browser; fake: canned). */
  tierFor(store: ScanStoreConfig): FetchTier;
  /** Sale-scan adapter factories by name (from loadSaleAdapters). */
  saleAdapters: Record<string, SaleAdapterFactory>;
  /** The transport (real: global fetch; fake: canned responses) — shared with the push layer. */
  fetchImpl: FetchImpl;
  connectorUrl: string;
  ingestKey: string;
  log: Logger;
  /** Max tasks to claim per tick (defaults to the channel's DEFAULT_CLAIM_MAX server-side). */
  claimMax?: number;
  /** Retry/backoff knobs (tests set a tiny/zero backoff). */
  options?: PushOptions;
}

/** The coarse outcome of a claim request. */
export type ClaimOutcome =
  | { result: "ok"; tasks: TaskEnvelope[] }
  | { result: "bad_key" }
  | { result: "rate_limited" }
  | { result: "error"; error: string };

/** The coarse outcome of a results report. */
export type ReportOutcome =
  | { result: "ok" }
  | { result: "not_found" }
  | { result: "bad_key" }
  | { result: "error"; error: string };

/** What a pull tick did — for the operator liveness view. */
export interface PullTickResult {
  claimed: number;
  /** Tasks reported `done` (a scan ran and its observations, if any, were reported). */
  reported: number;
  /** Tasks reported `failed` (adapter error, unknown store, bad payload). */
  failed: number;
  /** Observations rejected locally across all tasks (non-contract shape / smuggled saving). */
  rejectedObservations: number;
}

/** POST /satellite/tasks/claim with backoff. 401→bad_key, 429→rate_limited, 5xx/network→retry. */
export async function claimTasks(
  connectorUrl: string,
  key: string,
  capabilities: string[],
  fetchImpl: FetchImpl,
  options: PushOptions & { max?: number } = {},
): Promise<ClaimOutcome> {
  const url = `${connectorUrl.replace(/\/+$/, "")}/satellite/tasks/claim`;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const body = JSON.stringify(options.max ? { capabilities, max: options.max } : { capabilities });

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status: number;
    let read: () => Promise<unknown>;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
      });
      status = res.status;
      read = res.json;
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    if (status === 200) {
      const parsed = (await read().catch(() => null)) as ClaimResponse | null;
      return { result: "ok", tasks: parsed?.tasks ?? [] };
    }
    if (status === 401) return { result: "bad_key" };
    lastError = `http ${status}`;
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    return status === 429 ? { result: "rate_limited" } : { result: "error", error: lastError };
  }
  return { result: "error", error: lastError };
}

/** POST /satellite/results with backoff. 404→not_found (no retry), 401→bad_key, 5xx/network→retry. */
export async function reportResult(
  connectorUrl: string,
  key: string,
  report: { task_id: string; status: "done" | "failed"; reason?: string; observations?: SaleObservation[] },
  fetchImpl: FetchImpl,
  options: PushOptions = {},
): Promise<ReportOutcome> {
  const url = `${connectorUrl.replace(/\/+$/, "")}/satellite/results`;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const body = JSON.stringify(report);

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status: number;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
      });
      status = res.status;
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    if (status === 200) return { result: "ok" };
    if (status === 404) return { result: "not_found" }; // the task is gone — no retry
    if (status === 401) return { result: "bad_key" };
    lastError = `http ${status}`;
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    return { result: "error", error: lastError };
  }
  return { result: "error", error: lastError };
}

/**
 * Run one pull tick: claim `sale-scan` tasks, run each one's operator adapter behind the store's
 * session, VALIDATE every emitted observation locally, and report the validated `sale` observations
 * (or a `failed` reason). Pure orchestration over injected deps, so it is testable with in-memory
 * fakes — no network, no browser, no filesystem. Never throws: a per-task failure is caught and
 * reported as a task failure, so one bad store never sinks the tick.
 */
export async function runPullTick(config: SatelliteConfig, deps: PullDeps): Promise<PullTickResult> {
  const result: PullTickResult = { claimed: 0, reported: 0, failed: 0, rejectedObservations: 0 };

  // No scan stores ⇒ the machine does not run sale-scan ⇒ nothing to claim.
  const scanStores = config.scan_stores ?? [];
  if (scanStores.length === 0) return result;
  const storeBySlug = new Map(scanStores.map((s) => [s.store, s]));

  const claim = await claimTasks(config.connector_url, deps.ingestKey, [SALE_SCAN_KIND], deps.fetchImpl, {
    ...deps.options,
    max: deps.claimMax,
  });
  if (claim.result !== "ok") {
    deps.log.warn("claim failed", { result: claim.result });
    return result;
  }
  result.claimed = claim.tasks.length;

  for (const task of claim.tasks) {
    // Defensive: the channel hands back only declared kinds, but never trust that — a non-sale-scan
    // task is reported failed rather than silently dropped (its lease would otherwise expire).
    if (task.kind !== SALE_SCAN_KIND) {
      await report(deps, task.id, { status: "failed", reason: `unsupported task kind "${task.kind}"` }, result);
      continue;
    }
    const payload = parseSaleScanPayload(task.payload);
    if (!payload.ok) {
      await report(deps, task.id, { status: "failed", reason: `invalid sale-scan payload: ${payload.error}` }, result);
      continue;
    }
    const store = storeBySlug.get(payload.value.store);
    if (!store) {
      await report(deps, task.id, { status: "failed", reason: `no scan adapter configured for store "${payload.value.store}"` }, result);
      continue;
    }
    const factory = deps.saleAdapters[store.adapter];
    if (!factory) {
      await report(deps, task.id, { status: "failed", reason: `sale adapter "${store.adapter}" not loaded` }, result);
      continue;
    }

    const session = deps.loadSession(store.store);
    const tier = deps.tierFor(store);
    const sdk: ScanSdk = {
      store,
      config,
      session,
      fetch: (url: string) => tier.fetch(url, session),
      log: deps.log,
    };
    const adapter = factory(sdk);
    const outcome = await runScanAdapter(sdk, adapter, payload.value);
    if ("error" in outcome) {
      deps.log.warn("scan failed", { store: store.store, reason: outcome.error });
      await report(deps, task.id, { status: "failed", reason: outcome.error }, result);
      continue;
    }
    result.rejectedObservations += outcome.rejected.length;
    for (const r of outcome.rejected) deps.log.warn("rejected observation (not reported)", { store: store.store, reason: r.reason });
    await report(deps, task.id, { status: "done", observations: outcome.observations }, result);
  }

  return result;
}

/** Report one task's result and tally the tick counters (a not_found is a benign late report). */
async function report(
  deps: PullDeps,
  taskId: string,
  r: { status: "done" | "failed"; reason?: string; observations?: SaleObservation[] },
  tick: PullTickResult,
): Promise<void> {
  const outcome = await reportResult(deps.connectorUrl, deps.ingestKey, { task_id: taskId, ...r }, deps.fetchImpl, deps.options);
  if (outcome.result !== "ok") deps.log.warn("report failed", { task: taskId, status: r.status, result: outcome.result });
  if (r.status === "done") tick.reported++;
  else tick.failed++;
}

/** Build the real deps for the pull loop, sharing one browser tier across browser-tier stores. */
export async function buildPullDeps(
  config: SatelliteConfig,
  ingestKey: string,
  configDir: string,
  browserTier: FetchTier,
  loadSession: (dir: string, id: string) => StorageState | null,
  selectTier: (store: ScanStoreConfig, browser: FetchTier) => FetchTier,
  log: Logger,
  overrides: Partial<PullDeps> = {},
): Promise<PullDeps> {
  const saleAdapters = await loadSaleAdapters(config);
  return {
    loadSession: (storeId: string) => loadSession(configDir, storeId),
    tierFor: (store: ScanStoreConfig) => selectTier(store, browserTier),
    saleAdapters,
    fetchImpl: fetch as unknown as FetchImpl,
    connectorUrl: config.connector_url,
    ingestKey,
    log,
    ...overrides,
  };
}
