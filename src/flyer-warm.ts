// Background flyer warm (flyer-cache-warming capability). The public Kroger API
// has no flyer/circular endpoint, so the flyer is *synthesized* by scanning terms
// — historically on the hot path inside `kroger_flyer`, which fans one search per
// term and blows past the free-tier 50-external-subrequest-per-invocation cap as
// the term set grows. This module moves that fetch to a scheduled cron: a SINGLE
// trigger drives a cursor-based sweep that materializes a per-location rollup into
// KV, and `kroger_flyer` becomes a pure cache read. A synchronous tool call has one
// invocation's subrequest budget; a background sweep has unlimited invocations over
// time, so the cap relocates to where it stops binding.
//
// Determinism boundary (ADR 0001): the sweep is a `capture` step — derive once on a
// cold path, persist; the agent's read is the deterministic `retrieve`.
//
// The core (`runWarmTick`, `buildPlan`, the merge/filter helpers) takes injected
// `WarmDeps`, so it is unit-testable with fake KV / GitHub / Kroger. `buildWarmDeps`
// wires the real clients for the `scheduled()` handler.

import type { Env } from "./env.js";
import type { KrogerCache, KrogerCandidate } from "./kroger.js";
import { createKrogerClient } from "./kroger.js";
import type { KvStore } from "./kroger-user.js";
import { dedupeFlyerHits, isFulfillable, isOnSale, type FlyerItem } from "./matching.js";
import { createGitHubClient, prefixedClient } from "./github.js";
import { createInstallationAuth } from "./github-app.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { dataCoords, directoryFromEnv, userPrefix } from "./tenant.js";
import { notifyFailure, writeJobHealth } from "./health.js";

// KV keys. Rollups are per-location (`flyer:{locationId}`); the cursor and the
// persisted sweep plan are single keys. All live in the existing KROGER_KV namespace.
const CURSOR_KEY = "flyer:cursor";
const PLAN_KEY = "flyer:plan";
export const rollupKey = (locationId: string): string => `flyer:${locationId}`;

// Per-term scan depth — mirrors the original `kroger_flyer` (a bounded, relevance-
// ranked head of each category; explicitly non-exhaustive).
const PAGES = 2;
const LIMIT = 20;

// Units processed per tick. Each unit is one (location, term) and costs ≤ PAGES
// external subrequests, so DEFAULT_BATCH_UNITS × PAGES (+ one token mint) stays well
// under the free-tier 50-external-subrequest cap AND the ~10ms CPU budget (each page
// parses ≤ LIMIT products). 12 × 2 = 24 fetches worst case. Tunable.
const DEFAULT_BATCH_UNITS = 12;

// Minimum gap between sweep *starts*. Kroger promos run a weekly (~Wed) cycle, so a
// daily refresh is more than fresh enough. Tunable; alignment to a specific local
// hour is a future refinement (the frequent cron + this gate is the v1 model).
const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000;

/** One scan unit: a single broad term at a single store. */
export interface ScanUnit {
  locationId: string;
  term: string;
}

/** The persisted sweep plan — built once per sweep, read by every subsequent tick. */
export interface SweepPlan {
  sweep_id: string;
  units: ScanUnit[];
}

/** Tiny per-tick progress record. Written every tick; kept small (no candidate data). */
export interface SweepCursor {
  sweep_id: string;
  /** Index of the next unit to process. */
  index: number;
  /** Total units in the current sweep (lets idle ticks skip the plan read). */
  total: number;
  /** Epoch ms when the current sweep was STARTED (drives the refresh gate). */
  last_refresh_at: number;
  /** True once every unit has been processed. */
  done: boolean;
  /** Epoch ms the most recent FULL sweep completed; monotonic (a new sweep does not
   *  clear it), so it is the freshness signal a monitor asserts on. Null before the
   *  first completion. */
  completed_at: number | null;
}

/** The cached per-location rollup. Stores noise-floor candidates (the 5% deal floor
 *  is applied at READ time, so `min_savings_pct` stays caller-tunable). */
export interface FlyerRollup {
  sweep_id: string;
  /** Epoch ms of the latest contribution to this rollup. Surfaced to readers as `as_of`. */
  as_of: number;
  items: FlyerItem[];
}

/** Injected dependencies — fakes in tests, real clients via `buildWarmDeps`. */
export interface WarmDeps {
  kv: KvStore;
  /** Every tenant id on the allowlist (the tenant directory). */
  listTenantIds(): Promise<string[]>;
  /** This tenant's `preferences.toml` `[stores] preferred_location` label, or null. */
  readPreferredLocationLabel(tenantId: string): Promise<string | null>;
  /** The shared `flyer_terms.toml` broad terms (raw; normalization happens here). */
  readBroadTerms(): Promise<string[]>;
  /** Resolve a `preferred_location` label to a Kroger `locationId`. */
  resolveLocationId(label: string): Promise<string>;
  /** Scan one term at one location, returning raw (unfiltered) candidates across ≤ PAGES pages. */
  scan(locationId: string, term: string): Promise<KrogerCandidate[]>;
  now(): number;
}

export interface WarmConfig {
  batchUnits?: number;
  refreshMs?: number;
}

/** What a tick did — returned for tests/observability and for the warm's health record. */
export interface WarmTickResult {
  action: "built" | "scanned" | "completed" | "idle";
  /** Units processed this tick (scan ticks) or planned (build ticks). */
  units: number;
  errors?: number;
  /** Current sweep state, for the `health:job:flyer-warm` freshness summary. */
  done: boolean;
  sweep_started_at: number;
  sweep_completed_at: number | null;
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

async function putJson(kv: KvStore, key: string, value: unknown): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}

/** Trim + lowercase + dedupe broad terms. Lowercasing collapses case-variant
 *  duplicates ("Olive Oil" vs "olive oil") that Kroger search would resolve to the
 *  same results — so the sweep never scans the same effective term twice. */
export function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  for (const t of terms) {
    if (typeof t !== "string") continue;
    const n = t.trim().toLowerCase();
    if (n) seen.add(n);
  }
  return [...seen];
}

/** Merge two flyer-item lists by `sku`, unioning `matched_terms` (first-wins row
 *  fields, base order preserved then new). Idempotent: re-merging the same incoming
 *  items adds no duplicates — which is what makes a retried batch safe. */
export function mergeFlyerItems(base: FlyerItem[], incoming: FlyerItem[]): FlyerItem[] {
  const out: FlyerItem[] = base.map((it) => ({ ...it, matched_terms: [...it.matched_terms] }));
  const bySku = new Map(out.map((it) => [it.sku, it]));
  for (const item of incoming) {
    const existing = bySku.get(item.sku);
    if (existing) {
      for (const term of item.matched_terms) {
        if (!existing.matched_terms.includes(term)) existing.matched_terms.push(term);
      }
    } else {
      const copy = { ...item, matched_terms: [...item.matched_terms] };
      out.push(copy);
      bySku.set(copy.sku, copy);
    }
  }
  return out;
}

/** Keep only items marked down by at least `fraction` of the regular price. The
 *  rollup is stored at the noise floor (any real sale), so this is where the caller's
 *  `min_savings_pct` deal judgment is applied — at read, not at warm. */
export function filterByMinSavings(items: FlyerItem[], fraction: number): FlyerItem[] {
  return items.filter(
    (it) => it.price.regular > 0 && it.price.regular - it.price.promo >= it.price.regular * fraction,
  );
}

/** Build the sweep plan: distinct locations (union of tenants' preferred stores) ×
 *  normalized broad terms, ordered grouped-by-location for deterministic output and
 *  so a location's rollup is built across consecutive units. */
export async function buildPlan(deps: WarmDeps, sweepId: string): Promise<SweepPlan> {
  const tenantIds = await deps.listTenantIds();
  const labels = new Set<string>();
  for (const id of tenantIds) {
    const label = await deps.readPreferredLocationLabel(id);
    if (label) labels.add(label);
  }

  const terms = normalizeTerms(await deps.readBroadTerms());

  const locationIds = new Set<string>();
  for (const label of labels) {
    try {
      locationIds.add(await deps.resolveLocationId(label));
    } catch {
      // A store whose label can't be resolved is skipped this sweep; the next sweep
      // retries it. One bad store never wedges the whole plan.
    }
  }

  const units: ScanUnit[] = [];
  for (const locationId of [...locationIds].sort()) {
    for (const term of terms) units.push({ locationId, term });
  }
  return { sweep_id: sweepId, units };
}

/** Publish a tick's results into the per-location rollups. Within a sweep the rollup
 *  ACCUMULATES (append/merge); the first touch of a NEW sweep REPLACES the previous
 *  sweep's items — so a store is never momentarily empty during a refresh. */
async function publish(
  deps: WarmDeps,
  sweepId: string,
  now: number,
  byLoc: Map<string, { term: string; candidates: KrogerCandidate[] }[]>,
): Promise<void> {
  for (const [locationId, perTerm] of byLoc) {
    const incoming = dedupeFlyerHits(perTerm);
    const existing = await readJson<FlyerRollup>(deps.kv, rollupKey(locationId));
    const base = existing && existing.sweep_id === sweepId ? existing.items : [];
    const items = mergeFlyerItems(base, incoming);
    await putJson(deps.kv, rollupKey(locationId), { sweep_id: sweepId, as_of: now, items });
  }
}

/**
 * Run one warm tick. States:
 *  - **build**: no sweep, or the last one finished ≥ refreshMs ago → build + persist
 *    the plan and the cursor, then return (scanning begins next tick, so plan-build's
 *    own GitHub/location subrequests never share a tick with scans).
 *  - **scan**: a sweep is in progress → process the next batch, publish, advance the
 *    cursor; mark done (and log a summary) when the last unit is processed.
 *  - **idle**: the sweep is complete and not yet due to refresh → a single cursor read.
 *
 * A failed unit scan is caught and treated as empty (so one poison term can't wedge
 * the sweep); the cursor advances only after a successful publish, so a thrown tick
 * re-runs the same batch, which is safe because publish/merge is idempotent.
 */
export async function runWarmTick(deps: WarmDeps, config: WarmConfig = {}): Promise<WarmTickResult> {
  const batchUnits = config.batchUnits ?? DEFAULT_BATCH_UNITS;
  const refreshMs = config.refreshMs ?? DEFAULT_REFRESH_MS;
  const now = deps.now();
  const result = (
    action: WarmTickResult["action"],
    units: number,
    c: SweepCursor,
    errors: number,
  ): WarmTickResult => ({
    action,
    units,
    errors,
    done: c.done,
    sweep_started_at: c.last_refresh_at,
    sweep_completed_at: c.completed_at ?? null,
  });

  const cursor = await readJson<SweepCursor>(deps.kv, CURSOR_KEY);

  // --- build: start a new sweep ---
  if (!cursor || (cursor.done && now - cursor.last_refresh_at >= refreshMs)) {
    const plan = await buildPlan(deps, String(now));
    await putJson(deps.kv, PLAN_KEY, plan);
    const done = plan.units.length === 0;
    const next: SweepCursor = {
      sweep_id: plan.sweep_id,
      index: 0,
      total: plan.units.length,
      last_refresh_at: now,
      done,
      // Preserve the prior completion (monotonic freshness); stamp now iff this empty
      // plan completes immediately.
      completed_at: done ? now : (cursor?.completed_at ?? null),
    };
    await putJson(deps.kv, CURSOR_KEY, next);
    if (done) logSweep(plan, 0); // empty plan (no stores/terms) — complete immediately
    return result("built", plan.units.length, next, 0);
  }

  // --- idle: complete and not due ---
  if (cursor.done) return result("idle", 0, cursor, 0);

  // --- scan: a sweep is in progress ---
  const plan = await readJson<SweepPlan>(deps.kv, PLAN_KEY);
  if (!plan || plan.sweep_id !== cursor.sweep_id) {
    // Cursor/plan disagree (e.g. a partial write). Force a rebuild next tick.
    const reset: SweepCursor = { ...cursor, done: true, last_refresh_at: 0 };
    await putJson(deps.kv, CURSOR_KEY, reset);
    return result("idle", 0, reset, 0);
  }

  const batch = plan.units.slice(cursor.index, cursor.index + batchUnits);
  let errors = 0;
  const scanned = await Promise.all(
    batch.map(async (u) => {
      try {
        const raw = await deps.scan(u.locationId, u.term);
        return { u, candidates: raw.filter((c) => isOnSale(c) && isFulfillable(c)) };
      } catch {
        errors++;
        return { u, candidates: [] as KrogerCandidate[] };
      }
    }),
  );

  // Group by location, preserving input order so the rollup is deterministic.
  const byLoc = new Map<string, { term: string; candidates: KrogerCandidate[] }[]>();
  for (const { u, candidates } of scanned) {
    const list = byLoc.get(u.locationId) ?? [];
    list.push({ term: u.term, candidates });
    byLoc.set(u.locationId, list);
  }
  await publish(deps, cursor.sweep_id, now, byLoc);

  const index = cursor.index + batch.length;
  const done = index >= plan.units.length;
  // Stamp completion on the tick that finishes the sweep; otherwise keep the prior
  // completion time (monotonic freshness signal).
  const updated: SweepCursor = {
    ...cursor,
    index,
    done,
    completed_at: done ? now : (cursor.completed_at ?? null),
  };
  await putJson(deps.kv, CURSOR_KEY, updated);
  if (done) logSweep(plan, errors);
  return result(done ? "completed" : "scanned", batch.length, updated, errors);
}

/** One structured log line per completed sweep (mirrors the email() handler). */
function logSweep(plan: SweepPlan, errors: number): void {
  const locations = new Set(plan.units.map((u) => u.locationId)).size;
  console.log(
    "[flyer-warm] " +
      JSON.stringify({ event: "sweep_complete", sweep_id: plan.sweep_id, locations, units: plan.units.length, errors }),
  );
}

/** Read a location's warmed rollup for `kroger_flyer`. Returns null when no rollup
 *  exists yet (cold cache / a store not yet swept) — the tool degrades to empty. */
export async function readFlyerRollup(
  kv: KvStore,
  locationId: string,
): Promise<{ items: FlyerItem[]; as_of: string } | null> {
  const rollup = await readJson<FlyerRollup>(kv, rollupKey(locationId));
  if (!rollup) return null;
  return { items: rollup.items, as_of: new Date(rollup.as_of).toISOString() };
}

/**
 * One scheduled run: advance the sweep, record `health:job:flyer-warm` (ok with a
 * freshness summary, or fail), push an optional ntfy alert on failure, and **rethrow**
 * so the platform's native cron status reflects a failure. Thin glue over `runWarmTick`,
 * kept here (not in the handler) so it is unit-testable with injected deps + env.
 */
export async function runWarmJob(env: Env, deps: WarmDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const r = await runWarmTick(deps);
    await writeJobHealth(deps.kv, "flyer-warm", {
      ok: true,
      last_run_at: startedAt,
      summary: {
        action: r.action,
        done: r.done,
        sweep_started_at: r.sweep_started_at,
        sweep_completed_at: r.sweep_completed_at,
        errors: r.errors ?? 0,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[flyer-warm] tick failed:", msg);
    await writeJobHealth(deps.kv, "flyer-warm", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: msg },
    }).catch(() => {});
    await notifyFailure(env, "flyer-warm", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}

/** Wire the real GitHub/Kroger/KV clients for the scheduled handler. Runs without an
 *  OAuth session: it enumerates the tenant directory and reads any `users/<id>/`
 *  subtree directly (one shared data repo), since the warmed data is public-derived
 *  store-wide sale data, not tenant-private state. */
export function buildWarmDeps(env: Env): WarmDeps {
  const coords = dataCoords(env);
  const installationAuth = createInstallationAuth(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, {
    id: env.GITHUB_INSTALLATION_ID,
    owner: coords.owner,
    repo: coords.repo,
  });
  const dataGh = createGitHubClient(coords, installationAuth);
  const directory = directoryFromEnv(env);

  // A private cache so the client's single-slot `locationId` cache is ours to reset.
  // `resolveLocationId` returns the cached id when set, so to resolve MANY stores we
  // null the slot before each call; the token stays cached across them.
  const krogerCache: KrogerCache = { token: null, locationId: null };
  const kroger = createKrogerClient(env, { cache: krogerCache });

  return {
    kv: env.KROGER_KV as unknown as KvStore,
    listTenantIds: () => directory.list(),
    async readPreferredLocationLabel(tenantId) {
      const text = await readOptional(prefixedClient(dataGh, userPrefix(tenantId)), "preferences.toml");
      if (!text) return null;
      const prefs = parseToml(text, "preferences.toml");
      const stores = prefs.stores as Record<string, unknown> | undefined;
      return typeof stores?.preferred_location === "string" ? stores.preferred_location : null;
    },
    async readBroadTerms() {
      const text = await readOptional(dataGh, "flyer_terms.toml");
      if (!text) return [];
      const parsed = parseToml(text, "flyer_terms.toml");
      return Array.isArray(parsed.terms) ? (parsed.terms.filter((t) => typeof t === "string") as string[]) : [];
    },
    async resolveLocationId(label) {
      krogerCache.locationId = null;
      return kroger.resolveLocationId(label);
    },
    async scan(locationId, term) {
      const found: KrogerCandidate[] = [];
      for (let page = 0; page < PAGES; page++) {
        const candidates = await kroger.search(term, { locationId, limit: LIMIT, start: page * LIMIT });
        if (candidates.length === 0) break;
        found.push(...candidates);
      }
      return found;
    },
    now: () => Date.now(),
  };
}
