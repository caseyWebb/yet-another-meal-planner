// runPrefRetirementSeedJob — the D8/D21 VALUE MIGRATION as pipeline convergence
// (profile-reconciliation capability): the retired `lunch_strategy` /
// `ready_to_eat_default_action` preferences converge onto SEEDED MEAL-VIBE SUGGESTIONS
// through the existing pending-proposals channel — suggestions, never silent inserts;
// the palette is member-curated, so the member accepts or dismisses via the shipped
// queue. Never manual surgery: the observed production rows are the acceptance fixture
// (F5), verified read-only against production after deploy.
//
// For each tenant with a profile row where either retired column is non-NULL, ONE D1
// batch (per tenant) both:
//   1. enqueues the seed suggestions (kind `add_vibe`, the existing `(tenant, kind,
//      target)` enqueue idempotency via the stable proposal id, deterministic targets
//      `pref-retire:lunch_strategy` / `pref-retire:rte`), and
//   2. NULLs BOTH retired columns — the columns themselves are the convergence marker
//      (converged ⇔ both NULL), and the columns-NULL predicate is the deprecation-
//      window column-drop gate.
// The pass TERMINATES: converged tenants match nothing on later ticks; a member's
// dismissal is final (nothing re-reads the now-NULL columns, so nothing resurrects —
// no dependence on proposal-disposition retention); the crash window between enqueue
// and NULL is covered by the enqueue idempotency. Safe to NULL because, unlike
// `default_cooking_nights` (which the cadence read-fallback reads and therefore stays
// frozen-not-NULLed until the window-close migration), nothing reads these two columns
// after this deploy except this pass. The `custom` bag is NEVER read or written —
// defined columns only, column wins (the F3 precedence rule); tenants with no profile
// row are skipped structurally by the WHERE clause.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { slugify } from "./discovery.js";
import { enqueueProposalStmt } from "./reconcile-db.js";
import type { ProposalDraft } from "./reconcile-signals.js";
import { writeJobHealth, writeJobRun, recordUsagePoint, notifyFailure } from "./health.js";

/** The producer name this pass stamps on its proposals (a registered signal producer). */
export const PREF_RETIREMENT_PRODUCER = "pref-retirement";

/** The total, decisive value → seed mapping (design §4.2). `opt-in` seeds nothing —
 *  opt-in is the new universal behavior (band 3's always-offer-never-auto-add persona
 *  rule is its successor). No retired preference carries breakfast signal, so no
 *  breakfast seed exists here (fabricating one would violate capture-don't-invent). */
const LUNCH_SEED_PHRASES: Record<string, string> = {
  leftovers: "leftovers remixed into lunch",
  buy: "grab-and-go bought lunch",
  mixed: "leftovers or something quick and easy",
};
const RTE_SEED_PHRASE = "a zero-effort heat-and-eat night";

interface RetiredRow {
  tenant: string;
  lunch_strategy: string | null;
  ready_to_eat_default_action: string | null;
}

/** Draft the seed suggestions for one tenant's retired values (pure; exported for tests). */
export function draftRetirementSeeds(row: RetiredRow): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const lunchPhrase = row.lunch_strategy !== null ? LUNCH_SEED_PHRASES[row.lunch_strategy] : undefined;
  if (lunchPhrase) {
    drafts.push({
      kind: "add_vibe",
      target: "pref-retire:lunch_strategy",
      payload: { id: slugify(lunchPhrase), vibe: lunchPhrase, cadence_days: null, meal: "lunch" },
      rationale: `Your lunch-strategy preference retired — carry “${lunchPhrase}” into your palette as a lunch vibe?`,
      evidence: { retired_key: "lunch_strategy", value: row.lunch_strategy },
    });
  }
  if (row.ready_to_eat_default_action === "auto-add") {
    drafts.push({
      kind: "add_vibe",
      target: "pref-retire:rte",
      payload: { id: slugify(RTE_SEED_PHRASE), vibe: RTE_SEED_PHRASE, cadence_days: null, meal: "dinner" },
      rationale: `Your ready-to-eat default retired — keep “${RTE_SEED_PHRASE}” in your palette so a convenience night still gets planned?`,
      evidence: { retired_key: "ready_to_eat_default_action", value: row.ready_to_eat_default_action },
    });
  }
  return drafts;
}

/**
 * The scheduled pref-retirement seed pass (scheduled() phase 5, beside the other
 * pending_proposals producers). Idempotent and terminating — see the module doc.
 * Records job health like the other background jobs; rethrows a hard failure so the
 * cron surface reflects it.
 */
export async function runPrefRetirementSeedJob(env: Env, now: () => number = () => Date.now()): Promise<void> {
  const startedAt = now();
  try {
    const rows = await db(env).all<RetiredRow>(
      "SELECT tenant, lunch_strategy, ready_to_eat_default_action FROM profile " +
        "WHERE lunch_strategy IS NOT NULL OR ready_to_eat_default_action IS NOT NULL",
    );
    const nowIso = new Date(startedAt).toISOString();
    let seeded = 0;
    for (const row of rows) {
      const drafts = draftRetirementSeeds(row);
      // ONE batch per tenant: the enqueue(s) and the column-NULLing convergence write
      // land atomically, so a crash can never NULL without enqueueing; the reverse
      // (enqueue landed, NULL didn't) is covered by the enqueue idempotency on retry.
      const stmts: D1PreparedStatement[] = drafts.map(
        (d) => enqueueProposalStmt(env, row.tenant, d, PREF_RETIREMENT_PRODUCER, nowIso).stmt,
      );
      stmts.push(
        db(env).prepare(
          "UPDATE profile SET lunch_strategy = NULL, ready_to_eat_default_action = NULL WHERE tenant = ?1",
          row.tenant,
        ),
      );
      await db(env).batch(stmts);
      seeded += drafts.length;
    }
    const summary = { tenants: rows.length, seeded };
    await writeJobHealth(env, "pref-retirement", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "pref-retirement", { ok: true, ran_at: startedAt, duration_ms: now() - startedAt, summary });
    recordUsagePoint(env, "pref-retirement", { ok: true, durationMs: now() - startedAt, counts: [rows.length, seeded] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[pref-retirement] failed:", msg);
    await writeJobHealth(env, "pref-retirement", { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, "pref-retirement", { ok: false, ran_at: startedAt, duration_ms: now() - startedAt, summary: { error: msg } });
    recordUsagePoint(env, "pref-retirement", { ok: false, durationMs: now() - startedAt });
    await notifyFailure(env, "pref-retirement", msg);
    throw e;
  }
}
