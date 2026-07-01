// Reader for the operator admin "Reconcile" surface (grocery/pantry key-reconcile observability).
// Derives the convergence card's model from the `grocery-reconcile` job's per-run history
// (`readJobRuns`) — the SAME per-run series the Status uptime sparkline reads, reinterpreted for a
// self-terminating backfill: instead of ok/fail bars it shows rows-re-keyed-per-tick, and instead
// of an uptime% it tells "converging" from the POSITIVE terminal "converged" (a run of silent
// no-ops). Pure reads over `src/health.ts` (which degrades to [] when D1 is unreachable); the
// derivation is a pure function so it's unit-testable without a D1 fake.

import type { Env } from "./env.js";
import { readJobRuns, type JobRun } from "./health.js";
import { RECONCILE_JOB, RECONCILE_MAX_PER_TICK } from "./grocery-pantry-reconcile.js";

/** How many recent runs the card's sparkline shows (and the reader fetches). */
export const RECONCILE_RUN_WINDOW = 15;

/** Reconcile cron cadence in minutes — the janitor cron fires every 5 min (the every-5-minutes
 *  crontab in `wrangler.jsonc`'s `triggers.crons`), and the reconcile rides that tick. */
export const RECONCILE_CADENCE_MIN = 5;

/** Derived state: converged is the POSITIVE terminal state (nothing left to re-key), converging is
 *  live work and/or a backlog. `neverRun` is distinct — no history yet (a fresh deploy). */
export type ReconcileState = "converging" | "converged" | "neverRun";

/** One tick's re-key counts (oldest→newest in `ticks`) — `{g: grocery, p: pantry}`, the stacked
 *  sparkline's shape (grocery below, pantry above; a zero tick renders as a thin floor). */
export interface ReconcileTick {
  g: number;
  p: number;
}

/** The convergence card's model. Field names match the design component's `s` snapshot. A
 *  `neverRun` model still renders (the card shows a calm "never run" — never "failing"). */
export interface ReconcileObservability {
  state: ReconcileState;
  /** The latest tick's counts (0/0 when converged; both 0 and no history when neverRun). */
  grocery_rekeyed: number;
  pantry_rekeyed: number;
  /** The latest tick hit the per-tick cap → a backlog remains (converging even if counts fell). */
  truncated: boolean;
  /** Recent runs' re-key counts, oldest→newest, for the sparkline. */
  ticks: ReconcileTick[];
  /** Rows re-keyed across the retained run window (grocery + pantry). */
  lifetimeMerged: number;
  /** Epoch ms of the most recent run (the "last tick" age), or null with no history. */
  lastTick: number | null;
  /** Epoch ms of the earliest retained run (the "since" anchor for the converging footer). */
  startedAt: number | null;
  /** Epoch ms of the most recent run that actually re-keyed a row, or null (never merged / no history). */
  lastMerge: number | null;
  /** Epoch ms the reconcile first went idle — the first of the trailing run of zero, no-truncate
   *  ticks. Null unless currently converged. */
  convergedAt: number | null;
  /** Per-tick re-key cap (the "N/tick" the backlog note names). */
  cap: number;
  /** Cron cadence in minutes (the "runs every Nm" footer). */
  cadenceMin: number;
}

/** Total rows re-keyed in a tick (the sparkline bar's height driver). */
function tickTotal(t: ReconcileTick): number {
  return t.g + t.p;
}

/** A run's summary → a tick's `{g, p}`. A failure run (or a malformed summary) contributes 0/0 —
 *  the card is about re-key volume, and a failed tick did no re-keying. */
function tickOf(run: JobRun): ReconcileTick {
  const g = run.summary.grocery_rekeyed;
  const p = run.summary.pantry_rekeyed;
  return {
    g: typeof g === "number" && Number.isFinite(g) ? g : 0,
    p: typeof p === "number" && Number.isFinite(p) ? p : 0,
  };
}

/** True when a run hit the per-tick cap (a backlog remains) — its own reported `truncated` flag. */
function isTruncated(run: JobRun): boolean {
  return run.summary.truncated === true;
}

/**
 * Derive the convergence card's model from a job's runs (newest-first, as `readJobRuns` returns).
 * PURE + defensive — no runs yet yields a sane `neverRun` model the card can render; a run's
 * counts come from its tenant-clean summary. Converged iff the latest run did 0 and wasn't
 * truncated (else converging). `convergedAt` is the ran_at of the FIRST of the trailing run of
 * zero/no-truncate ticks (when to say it settled), scanning from the newest backward while the
 * run stays idle. `lifetimeMerged` sums re-keys over the retained window; `lastMerge` is the most
 * recent run that re-keyed anything.
 */
export function deriveReconcile(runs: readonly JobRun[], cadenceMin: number): ReconcileObservability {
  if (runs.length === 0) {
    return {
      state: "neverRun",
      grocery_rekeyed: 0,
      pantry_rekeyed: 0,
      truncated: false,
      ticks: [],
      lifetimeMerged: 0,
      lastTick: null,
      startedAt: null,
      lastMerge: null,
      convergedAt: null,
      cap: RECONCILE_MAX_PER_TICK,
      cadenceMin,
    };
  }

  // Oldest→newest for the sparkline; the newest run is the "latest tick".
  const ordered = [...runs].reverse();
  const ticks = ordered.map(tickOf);
  const latest = runs[0];
  const latestTick = tickOf(latest);
  const latestTruncated = isTruncated(latest);

  // Converged is a POSITIVE terminal state, so a FAILED latest run must NOT read as converged — a
  // failure run carries an `{error}` summary (no counts → 0/0), which would otherwise masquerade as
  // "nothing left to re-key" on the one surface that would flag it (grocery-reconcile is not in
  // HEALTH_JOBS). A non-ok latest run stays `converging`.
  const converged = latest.ok && latestTick.g === 0 && latestTick.p === 0 && !latestTruncated;

  // The trailing idle streak start: walk newest→older while each run is a HEALTHY zero, no-truncate
  // no-op. `convergedAt` is the ran_at of the OLDEST run still in that streak (when it settled) — the
  // streak stops at any failed run, so "converged since T" never spans a run that errored.
  let convergedAt: number | null = null;
  if (converged) {
    convergedAt = latest.ran_at;
    for (const run of runs) {
      const t = tickOf(run);
      if (run.ok && t.g === 0 && t.p === 0 && !isTruncated(run)) convergedAt = run.ran_at;
      else break;
    }
  }

  const lifetimeMerged = ticks.reduce((sum, t) => sum + tickTotal(t), 0);
  const lastMergeRun = runs.find((r) => tickTotal(tickOf(r)) > 0) ?? null;

  return {
    state: converged ? "converged" : "converging",
    grocery_rekeyed: latestTick.g,
    pantry_rekeyed: latestTick.p,
    truncated: latestTruncated,
    ticks,
    lifetimeMerged,
    lastTick: latest.ran_at,
    startedAt: ordered[0].ran_at,
    lastMerge: lastMergeRun ? lastMergeRun.ran_at : null,
    convergedAt,
    cap: RECONCILE_MAX_PER_TICK,
    cadenceMin,
  };
}

/** Read the reconcile observability model for the Normalize › Reconcile card (SSR). Reads the
 *  `grocery-reconcile` per-run history and derives the card model; degrades to a `neverRun` model
 *  when D1 is unreachable (`readJobRuns` returns [] on a storage error). */
export async function readReconcileObservability(env: Env): Promise<ReconcileObservability> {
  const runs = await readJobRuns(env, RECONCILE_JOB, RECONCILE_RUN_WINDOW);
  return deriveReconcile(runs, RECONCILE_CADENCE_MIN);
}
