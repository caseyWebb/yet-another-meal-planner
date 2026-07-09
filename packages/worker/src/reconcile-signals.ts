// Deterministic profile-reconciliation SIGNALS + proposal drafting (profile-reconciliation
// capability). The reconcile reconciles STATED preference (the night-vibe palette + cadences)
// against REVEALED behavior (the cooking log). This module is the DETERMINISTIC tier: cheap,
// always-fresh, no large-model call — it turns cadence state into high-confidence proposal
// DRAFTS (prune a stale-ignored vibe; stretch a cadence the member keeps deferring). The
// richer generative tier — detecting a recurring cooking archetype and proposing to ADD a
// vibe — is the pluggable edge-model / operator-frontier producer; it writes to the same queue.
//
// Pure (no I/O) so it is unit-testable off `workerd`; the cron wrapper (runReconcileSignalsJob,
// below) injects the D1/tenant reads.

import type { Env } from "./env.js";
import { directoryFromEnv } from "./tenant.js";
import { readNightVibes, readVibeSatisfactionDates, type NightVibe } from "./night-vibe-db.js";
import { writeJobHealth, writeJobRun, recordUsagePoint, notifyFailure } from "./health.js";
import { enqueueProposal } from "./reconcile-db.js";

/** A vibe the member added but has ignored this long (days) before we suggest pruning it. */
const STALE_NEVER_DAYS = 60;
/** How far past its cadence a vibe must run (× period) before we suggest stretching it. */
const DEFER_FACTOR = 3;
/** How far UNDER its cadence the recent satisfaction intervals must land (× period) before we
 *  suggest tightening — the mirror of DEFER_FACTOR ("well before cadence"). */
const TIGHTEN_FACTOR = 0.5;
/** Tighten needs ≥ this many satisfactions (⇒ ≥ 2 completed consecutive intervals). */
const TIGHTEN_MIN_SATISFACTIONS = 3;
/** How many of the most recent completed intervals the tighten rule inspects. */
const TIGHTEN_RECENT_INTERVALS = 2;
/** The tightest cadence a proposal may suggest (days). */
const TIGHTEN_FLOOR_DAYS = 3;

/** A drafted proposal — producer-agnostic (the queue stamps the producer). The profile
 *  kinds carry a diff applied on accept; `merge_recipes` (the dup-scan's corpus-curation
 *  kind, operator-addressed) carries review evidence and accept records the decision only. */
export interface ProposalDraft {
  kind: "prune_vibe" | "adjust_cadence" | "add_vibe" | "merge_recipes";
  /** What the proposal acts on (part of the stable, dedup-ing proposal id): the vibe id
   *  for the profile kinds, the sorted `"<a>+<b>"` pair key for `merge_recipes`. */
  target: string;
  /** The proposed profile diff (applied verbatim on accept). */
  payload: Record<string, unknown>;
  rationale: string;
  evidence: Record<string, unknown>;
}

function daysSince(dayOrIso: string, now: Date): number {
  const t = Date.parse(dayOrIso.length <= 10 ? `${dayOrIso}T00:00:00Z` : dayOrIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** Whole days between two YYYY-MM-DD days (older → newer), floored, never negative. */
function daysBetween(older: string, newer: string): number {
  const a = Date.parse(`${older.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${newer.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/**
 * Draft deterministic reconcile proposals for ONE member's palette. `satisfactionDates`
 * is each vibe's full provenance-stamped history, dates DESC (readVibeSatisfactionDates) —
 * last-satisfied is index 0, so the whole pass costs one query. Only high-confidence,
 * behavior-backed signals become drafts:
 *   - a cadence vibe added ≥ STALE_NEVER_DAYS ago and NEVER satisfied → propose PRUNE.
 *   - a cadence vibe whose real interval (since last satisfied) runs ≥ DEFER_FACTOR× its
 *     cadence → propose ADJUST the cadence up (STRETCH) to the observed interval.
 *   - a cadence vibe with ≥ TIGHTEN_MIN_SATISFACTIONS satisfactions whose
 *     TIGHTEN_RECENT_INTERVALS most recent intervals ALL land ≤ TIGHTEN_FACTOR× its
 *     cadence, while currently ON-TRACK (days since last < cadence — a vibe that later
 *     went overdue must not get a tighten) → propose ADJUST the cadence down (TIGHTEN)
 *     to the observed interval (rounded mean, floored at TIGHTEN_FLOOR_DAYS), only when
 *     that lands strictly below the current cadence. Stretch and tighten are disjoint by
 *     construction: stretch requires the current interval to run long, tighten requires
 *     on-track. Both reuse the `adjust_cadence` kind — direction lives in the rationale,
 *     the observed intervals in the evidence; the queue/confirm/apply path is unchanged.
 * A vibe with no cadence, or a recently-satisfied one matching neither pattern, produces
 * nothing. Pure.
 */
export function draftProposals(palette: NightVibe[], satisfactionDates: Map<string, string[]>, now: Date): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  for (const v of palette) {
    if (!v.cadence_days) continue; // no cadence pressure → nothing to reconcile
    const dates = satisfactionDates.get(v.id) ?? [];
    const last = dates[0] ?? null;
    if (last === null) {
      const age = v.created_at ? daysSince(v.created_at, now) : 0;
      if (age >= STALE_NEVER_DAYS) {
        drafts.push({
          kind: "prune_vibe",
          target: v.id,
          payload: { id: v.id },
          rationale: `You added “${v.vibe}” about ${age} days ago but haven't cooked anything for it — drop it from your rotation?`,
          evidence: { last_satisfied: null, age_days: age, cadence_days: v.cadence_days },
        });
      }
      continue;
    }
    const interval = daysSince(last, now);
    if (interval >= v.cadence_days * DEFER_FACTOR) {
      const suggested = Math.round(interval);
      drafts.push({
        kind: "adjust_cadence",
        target: v.id,
        payload: { id: v.id, cadence_days: suggested },
        rationale: `You cook “${v.vibe}” about every ${interval} days, not every ${v.cadence_days} — stretch its cadence to ~${suggested} days?`,
        evidence: { last_satisfied: last, interval_days: interval, cadence_days: v.cadence_days },
      });
      continue;
    }
    // TIGHTEN (member-app-propose D6): repeated early satisfaction, and still on-track.
    const cadence = v.cadence_days;
    if (dates.length < TIGHTEN_MIN_SATISFACTIONS) continue;
    if (interval >= cadence) continue; // went overdue since — never tighten
    const recent: number[] = [];
    for (let i = 0; i < TIGHTEN_RECENT_INTERVALS; i++) {
      recent.push(daysBetween(dates[i + 1], dates[i])); // dates are DESC: newer − older
    }
    if (!recent.every((d) => d <= cadence * TIGHTEN_FACTOR)) continue;
    const suggested = Math.max(TIGHTEN_FLOOR_DAYS, Math.round(recent.reduce((s, d) => s + d, 0) / recent.length));
    if (suggested >= cadence) continue; // not actually tighter — nothing to propose
    drafts.push({
      kind: "adjust_cadence",
      target: v.id,
      payload: { id: v.id, cadence_days: suggested },
      rationale: `You keep cooking “${v.vibe}” well before its ${v.cadence_days}-day cadence comes due — tighten it to ~${suggested} days?`,
      evidence: { intervals_days: recent, cadence_days: v.cadence_days, last_satisfied: last },
    });
  }
  return drafts;
}

// --- the scheduled deterministic-signal job -----------------------------------

/**
 * The `reconcile-signals` cron job: for every member, draft deterministic proposals from their
 * cadence state and enqueue them (idempotently) into `pending_proposals` as the `signal-cron`
 * producer. No large model. Records health like the other background jobs.
 */
export async function runReconcileSignalsJob(env: Env, now: () => number = () => Date.now()): Promise<void> {
  const startedAt = now();
  try {
    const directory = directoryFromEnv(env);
    const tenants = await directory.list();
    const nowDate = new Date(startedAt);
    const nowIso = nowDate.toISOString();
    let drafted = 0;
    let enqueued = 0;
    for (const tenant of tenants) {
      // ONE vibe_satisfaction query per member: the full dates map carries last-satisfied
      // (index 0, for prune/stretch) AND the tighten rule's recent intervals.
      const [palette, satisfactionDates] = await Promise.all([readNightVibes(env, tenant), readVibeSatisfactionDates(env, tenant)]);
      const drafts = draftProposals(palette, satisfactionDates, nowDate);
      drafted += drafts.length;
      for (const d of drafts) {
        const { inserted } = await enqueueProposal(env, tenant, d, "signal-cron", nowIso);
        if (inserted) enqueued++;
      }
    }
    const summary = { members: tenants.length, drafted, enqueued };
    await writeJobHealth(env, "reconcile-signals", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "reconcile-signals", { ok: true, ran_at: startedAt, duration_ms: now() - startedAt, summary });
    recordUsagePoint(env, "reconcile-signals", { ok: true, durationMs: now() - startedAt, counts: [tenants.length, drafted, enqueued] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reconcile-signals] failed:", msg);
    await writeJobHealth(env, "reconcile-signals", { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, "reconcile-signals", { ok: false, ran_at: startedAt, duration_ms: now() - startedAt, summary: { error: msg } });
    recordUsagePoint(env, "reconcile-signals", { ok: false, durationMs: now() - startedAt });
    await notifyFailure(env, "reconcile-signals", msg);
    throw e;
  }
}
