// The LENS RECONCILE (shared-corpus: "an idempotent reconcile attaches every legacy
// corpus row") — a bounded scheduled() phase that attaches every corpus recipe with
// zero `recipe_imports` rows to at least one household through the same grant
// primitive every import path uses, and heals any `discovery_matches` row missing its
// grant (the D13 drift guard). The lens join alone passes NO legacy recipe (zero
// import rows predate migration 0059), so this job is what converges an existing
// deployment to lens-completeness — organically, over ticks, with no manual surgery
// (the AGENTS.md rule). It is PERMANENT: a converged corpus plans zero writes, and the
// job stays as the guard that keeps the unattached-recipe class extinct.
//
// Attachment rule (one predicate, both profiles — no profile-conditioned bypass):
//   * a recipe WITH discovery attribution → one grant per attributed tenant, `via`
//     resolved from the discovery-log origin for that slug (`satellite` for pushed
//     rows, `feed:<source>` when a source is recorded, else `agent`), `member` from
//     the match row, `imported_at` from the match date (else the recipe's
//     `discovered_at`, else the run date);
//   * every other unattached recipe → the OPERATOR's household
//     (`normalizeTenantId(env.OWNER_TENANT_ID)` — the dup-scan idiom), `via 'agent'`,
//     the founding member. With no OWNER_TENANT_ID configured the attribution-derived
//     grants still run and the operator-fallback step records a skipped no-op, so
//     configuring the operator later converges the remainder.
//
// Idempotent by construction: every write is the INSERT OR IGNORE grant primitive on
// the (recipe, tenant) PK. No NULL-owner sentinel exists anywhere. Bounded per tick
// (LENS_RECONCILE_MAX_PER_TICK) like sibling jobs; records job_health/job_runs and a
// usage-trends point under `lens-reconcile`.

import { db } from "./db.js";
import type { Env } from "./env.js";
import { normalizeTenantId } from "./tenant.js";
import { importGrantStmt, type ImportGrant } from "./visibility.js";
import { notifyFailure, recordUsagePoint, writeJobHealth, writeJobRun } from "./health.js";

/** The background-job name the reconcile records its health + per-run history under. */
export const LENS_RECONCILE_JOB = "lens-reconcile";

/** Unattached recipes processed per tick. Sized so a typical corpus (low hundreds)
 *  converges in a few 5-minute ticks; the pre-merge production fixture task may raise
 *  it in the same PR if the captured unattached count demands it. */
export const LENS_RECONCILE_MAX_PER_TICK = 200;

/** D1's hard per-query limit is 100 bound variables; IN-lists stay safely under it. */
const IN_LIST_CHUNK = 90;
/** Grant-write batch size — bounded per db.batch call (see the write-site comment). */
const BATCH_CHUNK = 100;

/** What one reconcile tick did (the job_health summary — tenant-count-free). */
export interface LensReconcileSummary {
  /** Unattached recipes examined this tick (≤ the per-tick cap). */
  scanned: number;
  /** Grants written from discovery attribution (one per attributed tenant). */
  attributed: number;
  /** Grants written to the operator's household (the no-attribution fallback). */
  operator_fallback: number;
  /** Match-row drift healed: grants minted for match rows that were missing theirs. */
  drift_healed: number;
  /** Unattached recipes left for a later run because OWNER_TENANT_ID is unset. */
  skipped_no_operator: number;
}

interface UnattachedRow {
  slug: string;
  discovered_at: string | null;
}

interface MatchRow {
  recipe: string;
  tenant: string;
  member: string | null;
  matched_at: string | null;
}

interface OriginRow {
  slug: string;
  source: string | null;
  pushed: number | null;
}

/** Resolve the `via` for a slug from its imported discovery-log row (if any). */
function viaFromOrigin(origin: OriginRow | undefined): string {
  if (!origin) return "agent";
  if (origin.pushed) return "satellite";
  if (origin.source) return `feed:${origin.source}`;
  return "agent";
}

/**
 * One reconcile pass: attach a bounded batch of zero-grant corpus recipes (attribution
 * first, operator fallback second) and heal match-rows-missing-grants. All grant writes
 * are one INSERT OR IGNORE batch; a converged corpus plans zero writes.
 */
export async function reconcileLensAttachment(
  env: Env,
  opts: { cap?: number; today?: string } = {},
): Promise<LensReconcileSummary> {
  const cap = opts.cap ?? LENS_RECONCILE_MAX_PER_TICK;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const operator = env.OWNER_TENANT_ID ? normalizeTenantId(env.OWNER_TENANT_ID) : null;

  // [1] The unattached batch: projected corpus rows with zero grant rows.
  const unattached = await db(env).all<UnattachedRow>(
    "SELECT r.slug AS slug, r.discovered_at AS discovered_at FROM recipes r " +
      "WHERE NOT EXISTS (SELECT 1 FROM recipe_imports i WHERE i.recipe = r.slug) " +
      "ORDER BY r.slug LIMIT ?1",
    Math.max(1, cap),
  );

  // [2] The drift guard: match rows (for still-projected recipes) missing their grant —
  // healed regardless of whether the recipe has other grants, bounded by the same cap.
  const drifted = await db(env).all<MatchRow>(
    "SELECT m.recipe AS recipe, m.tenant AS tenant, m.member AS member, m.matched_at AS matched_at " +
      "FROM discovery_matches m " +
      "WHERE EXISTS (SELECT 1 FROM recipes r WHERE r.slug = m.recipe) " +
      "AND NOT EXISTS (SELECT 1 FROM recipe_imports i WHERE i.recipe = m.recipe AND i.tenant = m.tenant) " +
      "ORDER BY m.recipe, m.tenant LIMIT ?1",
    Math.max(1, cap),
  );

  const summary: LensReconcileSummary = {
    scanned: unattached.length,
    attributed: 0,
    operator_fallback: 0,
    drift_healed: 0,
    skipped_no_operator: 0,
  };
  if (unattached.length === 0 && drifted.length === 0) return summary; // converged: zero writes

  // Resolve `via` origins for every slug this tick touches. The slug set can reach
  // 2×cap, and D1 rejects any query binding more than 100 variables ("variable number
  // must be between ?1 and ?100") — so the IN-lists run in bind-safe chunks.
  const slugs = [...new Set([...unattached.map((r) => r.slug), ...drifted.map((m) => m.recipe)])];
  const inChunks = async <T>(query: (placeholders: string) => string): Promise<T[]> => {
    const out: T[] = [];
    for (let i = 0; i < slugs.length; i += IN_LIST_CHUNK) {
      const part = slugs.slice(i, i + IN_LIST_CHUNK);
      const placeholders = part.map((_, j) => `?${j + 1}`).join(", ");
      out.push(...(await db(env).all<T>(query(placeholders), ...part)));
    }
    return out;
  };
  const originRows = await inChunks<OriginRow>(
    (ph) => `SELECT slug, source, pushed FROM discovery_log WHERE outcome = 'imported' AND slug IN (${ph})`,
  );
  const origins = new Map<string, OriginRow>();
  for (const o of originRows) if (o.slug && !origins.has(o.slug)) origins.set(o.slug, o);

  // Match rows per unattached slug (attribution-derived attachment), same chunking.
  const unattachedSet = new Set(unattached.map((r) => r.slug));
  const matchRows = await inChunks<MatchRow>(
    (ph) => `SELECT recipe, tenant, member, matched_at FROM discovery_matches WHERE recipe IN (${ph})`,
  );
  const matchesBySlug = new Map<string, MatchRow[]>();
  for (const m of matchRows) {
    if (!unattachedSet.has(m.recipe)) continue;
    const list = matchesBySlug.get(m.recipe) ?? [];
    list.push(m);
    matchesBySlug.set(m.recipe, list);
  }

  const grants: ImportGrant[] = [];
  const grantFromMatch = (m: MatchRow, discoveredAt: string | null): ImportGrant => ({
    recipe: m.recipe,
    tenant: m.tenant,
    // The backfilled member column is NOT NULL in practice; coalesce defensively to the
    // founding member (= tenant id) — no NULL-owner sentinel ever reaches the table.
    member: m.member ?? m.tenant,
    via: viaFromOrigin(origins.get(m.recipe)),
    importedAt: m.matched_at ?? discoveredAt ?? today,
  });

  for (const row of unattached) {
    const matches = matchesBySlug.get(row.slug) ?? [];
    if (matches.length > 0) {
      for (const m of matches) grants.push(grantFromMatch(m, row.discovered_at));
      summary.attributed += matches.length;
    } else if (operator) {
      grants.push({
        recipe: row.slug,
        tenant: operator,
        member: operator, // the founding member (= tenant id)
        via: "agent",
        importedAt: row.discovered_at ?? today,
      });
      summary.operator_fallback += 1;
    } else {
      // No operator configured: leave it for a later run (recorded skip, never a
      // NULL-owner row) — setting OWNER_TENANT_ID later converges the remainder.
      summary.skipped_no_operator += 1;
    }
  }
  for (const m of drifted) {
    if (unattachedSet.has(m.recipe)) continue; // already granted via the attribution pass
    grants.push(grantFromMatch(m, null));
    summary.drift_healed += 1;
  }

  if (grants.length > 0) {
    // Chunked defensively too: a tick can mint up to ~2×cap grant statements, and
    // keeping batches small stays well inside D1's per-request bounds. Each chunk is
    // atomic; a mid-run failure leaves earlier chunks committed, which is safe — every
    // statement is an idempotent INSERT OR IGNORE the next tick re-plans from scratch.
    for (let i = 0; i < grants.length; i += BATCH_CHUNK) {
      await db(env).batch(grants.slice(i, i + BATCH_CHUNK).map((g) => importGrantStmt(env, g)));
    }
  }
  return summary;
}

/**
 * One scheduled run of the lens reconcile: do the pass, record the `lens-reconcile`
 * job_health/job_runs/usage point, and rethrow a hard failure so the platform's native
 * cron status reflects it — the sibling-job shape (runDupScanJob / runReconcileJob).
 */
export async function runLensReconcileJob(env: Env, now: () => number = () => Date.now()): Promise<void> {
  const startedAt = now();
  try {
    const s = await reconcileLensAttachment(env, { today: new Date(startedAt).toISOString().slice(0, 10) });
    const summary = { ...s } as Record<string, unknown>;
    await writeJobHealth(env, LENS_RECONCILE_JOB, { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, LENS_RECONCILE_JOB, { ok: true, ran_at: startedAt, duration_ms: now() - startedAt, summary });
    // History point (usage-trends): doubles = [duration_ms, scanned, attributed,
    // operator_fallback, drift_healed, skipped_no_operator].
    recordUsagePoint(env, LENS_RECONCILE_JOB, {
      ok: true,
      durationMs: now() - startedAt,
      counts: [s.scanned, s.attributed, s.operator_fallback, s.drift_healed, s.skipped_no_operator],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[lens-reconcile] failed:", msg);
    await writeJobHealth(env, LENS_RECONCILE_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, LENS_RECONCILE_JOB, { ok: false, ran_at: startedAt, duration_ms: now() - startedAt, summary: { error: msg } });
    recordUsagePoint(env, LENS_RECONCILE_JOB, { ok: false, durationMs: now() - startedAt });
    await notifyFailure(env, LENS_RECONCILE_JOB, msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
