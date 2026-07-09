// The corpus-wide near-duplicate reconcile (recipe-dedup capability). Import-time dedup
// (discovery-sweep.ts `findDuplicate`) only compares an INCOMING candidate against the
// corpus — two recipes already inside coexist forever (issue #217's `fresh-pasta` /
// `homemade-pasta-dough`). This scheduled job closes that gap: each tick it compares a
// bounded batch of un/stale-stamped recipes against the full current vector set and
// surfaces each detected pair as ONE `merge_recipes` proposal in the OPERATOR tenant's
// pending-proposals queue — never an auto-merge (the recipe-import contract). Detection
// is pure arithmetic over already-derived D1 rows (description-embedding cosine +
// `ingredients_key` overlap): no model calls, no external subrequests.
//
// The detector is the TWO-ARM rule calibrated against the full production pair
// distribution (see the change's design.md spike): cosine ≥ DUP_COSINE_HIGH alone (the
// import-dedup analog — paraphrase twins whose ingredient wording drifted), OR cosine ≥
// DUP_COSINE_CORROBORATED AND ingredients-key Jaccard ≥ DUP_JACCARD AND ≥ DUP_SHARED_MIN
// shared ingredients. Derived descriptions are a lossy proxy for dish identity (the
// fixture pair's cosine is 0.767 — below any workable cosine-only cut), so moderate
// cosine only counts when the write-normalized ingredient identity corroborates it; weak
// sets (< 2 shared) never corroborate by accident.
//
// Bounded + watermarked, never O(n²) per tick: each recipe carries a `dup_scan` stamp —
// hashText(description_hash | ingredients_key JSON) — and a tick scans at most
// DUP_SCAN_MAX_PER_TICK recipes whose stamp is missing/stale, each against the FULL
// vector set, then stamps them. Pair coverage holds because whichever member of a pair
// is stamped later is compared against a set containing the other. A converged corpus
// plans zero comparisons; a re-described/re-faceted recipe re-queues itself; orphan
// stamps prune. Logic is split from I/O (injected `DupScanDeps`) so it is unit-testable,
// the reconcile-signals.ts / recipe-embeddings.ts shape.

import { db } from "./db.js";
import { cosineSimilarity } from "./embedding.js";
import type { Env } from "./env.js";
import { hashText } from "./hash.js";
import { notifyFailure, recordUsagePoint, writeJobHealth, writeJobRun } from "./health.js";
import { enqueueProposal } from "./reconcile-db.js";
import type { ProposalDraft } from "./reconcile-signals.js";
import { normalizeTenantId } from "./tenant.js";

/** The background-job name the scan records its health + per-run history under. */
export const DUP_SCAN_JOB = "dup-scan";

// Detection thresholds — module constants, NOT operator-tunable config (design A):
// calibrated against the full production pair distribution (2026-07-08 spike; 205
// recipes, fixture cosine 0.7670 / Jaccard 0.67, 7 pairs at this rule, 0 at ≥ 0.90).
// Re-calibration is a code change with the same evidence trail.
/** Cosine at/above this alone is a candidate (paraphrase twins; the import-dedup analog). */
export const DUP_COSINE_HIGH = 0.9;
/** Cosine at/above this is a candidate WHEN the ingredient overlap corroborates. */
export const DUP_COSINE_CORROBORATED = 0.72;
/** Minimum ingredients-key Jaccard for the corroborated arm. */
export const DUP_JACCARD = 0.5;
/** Minimum SHARED ingredient count for the corroborated arm — small sets never corroborate. */
export const DUP_SHARED_MIN = 2;
/** Recipes scanned (and stamped) per tick; each sweeps the full vector set once. */
export const DUP_SCAN_MAX_PER_TICK = 25;

/** One embedded corpus recipe's scan state (recipe_derived ⋈ recipes ⋈ dup_scan). */
export interface DupScanRow {
  slug: string;
  title: string;
  /** The description embedding (recipe_derived.embedding, parsed). */
  embedding: number[];
  /** The embedded-description gate hash (recipe_derived.description_hash). */
  descriptionHash: string;
  /** The effective ingredients_key (recipes.ingredients_key, parsed). */
  ingredientsKey: string[];
  /** The stored `dup_scan.scanned_hash` stamp, or null when never scanned. */
  stamp: string | null;
}

/** One detected candidate pair (members lexicographically sorted: a < b). */
export interface DupCandidatePair {
  a: string;
  b: string;
  titles: [string, string];
  cosine: number;
  /** The shared (lowercased) key ingredients. */
  shared: string[];
  jaccard: number;
  /** Which arm fired: the unconditional high-cosine arm, or the corroborated one. */
  detector: "cosine" | "corroborated";
}

/** A recipe's CURRENT scan-stamp hash: the embedded-description gate + the effective
 *  ingredients_key, so a vector change OR a facet-only re-derivation re-queues it. */
export function scanStampHash(descriptionHash: string, ingredientsKeyJson: string): string {
  return hashText(`${descriptionHash}|${ingredientsKeyJson}`);
}

/** The current stamp hash for one scan row. */
function currentHash(row: DupScanRow): string {
  return scanStampHash(row.descriptionHash, JSON.stringify(row.ingredientsKey));
}

/** The two-arm detection rule (design A). Pure. */
export function isDuplicatePair(cosine: number, sharedCount: number, jaccard: number): boolean {
  if (cosine >= DUP_COSINE_HIGH) return true;
  return cosine >= DUP_COSINE_CORROBORATED && jaccard >= DUP_JACCARD && sharedCount >= DUP_SHARED_MIN;
}

/** The tick's scan queue: ≤ `cap` slugs whose stamp is missing or stale. Pure. */
export function planDupScan(rows: DupScanRow[], cap: number): string[] {
  return rows
    .filter((r) => r.stamp !== currentHash(r))
    .slice(0, cap)
    .map((r) => r.slug);
}

/** Case-insensitive ingredient-set overlap over two write-normalized key lists. */
function overlap(a: string[], b: string[]): { shared: string[]; jaccard: number } {
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  const shared = [...setA].filter((s) => setB.has(s)).sort();
  const union = new Set([...setA, ...setB]);
  return { shared, jaccard: union.size === 0 ? 0 : shared.length / union.size };
}

/**
 * Compare each queued recipe against the FULL row set (skipping self), collecting the
 * pairs that clear the two-arm rule. Pair members are lexicographically sorted and pairs
 * deduped within the tick (two queued members of one pair find it twice). Pure.
 */
export function detectPairs(scanSlugs: string[], allRows: DupScanRow[]): DupCandidatePair[] {
  const bySlug = new Map(allRows.map((r) => [r.slug, r]));
  const seen = new Set<string>();
  const pairs: DupCandidatePair[] = [];
  for (const slug of scanSlugs) {
    const row = bySlug.get(slug);
    if (!row) continue;
    for (const other of allRows) {
      if (other.slug === row.slug) continue;
      const [a, b] = [row, other].sort((x, y) => (x.slug < y.slug ? -1 : 1));
      const key = `${a.slug}+${b.slug}`;
      if (seen.has(key)) continue;
      const cosine = cosineSimilarity(row.embedding, other.embedding);
      const { shared, jaccard } = overlap(row.ingredientsKey, other.ingredientsKey);
      if (!isDuplicatePair(cosine, shared.length, jaccard)) continue;
      seen.add(key);
      pairs.push({
        a: a.slug,
        b: b.slug,
        titles: [a.title, b.title],
        cosine,
        shared,
        jaccard,
        detector: cosine >= DUP_COSINE_HIGH ? "cosine" : "corroborated",
      });
    }
  }
  return pairs;
}

/** Build the `merge_recipes` ProposalDraft for one detected pair (design C): target is
 *  the sorted pair key, payload the slugs/titles + numeric evidence, rationale a human
 *  sentence naming both dishes, evidence the numbers + the thresholds in force. Pure. */
export function draftMergeProposal(pair: DupCandidatePair): ProposalDraft {
  const sharing = pair.shared.length ? `, sharing ${pair.shared.join(" and ")}` : "";
  return {
    kind: "merge_recipes",
    target: `${pair.a}+${pair.b}`,
    payload: {
      slugs: [pair.a, pair.b],
      titles: pair.titles,
      cosine: pair.cosine,
      shared_ingredients: pair.shared,
      jaccard: pair.jaccard,
      detector: pair.detector,
    },
    rationale: `“${pair.titles[0]}” and “${pair.titles[1]}” look like the same dish — description similarity ${pair.cosine.toFixed(2)}${sharing}. Review and merge?`,
    evidence: {
      cosine: pair.cosine,
      jaccard: pair.jaccard,
      shared_ingredients: pair.shared,
      detector: pair.detector,
      thresholds: {
        cosine_high: DUP_COSINE_HIGH,
        cosine_corroborated: DUP_COSINE_CORROBORATED,
        jaccard: DUP_JACCARD,
        shared_min: DUP_SHARED_MIN,
      },
    },
  };
}

/** What one scan tick did, for the `dup-scan` job_health summary (tenant-data-free). */
export interface DupScanSummary {
  /** Recipes scanned (and stamped) this tick. */
  scanned: number;
  /** Candidate pairs the detector produced. */
  pairs_found: number;
  /** Proposals actually inserted (re-detections of live/decided pairs are ignored). */
  enqueued: number;
  /** Orphan stamps pruned (slug no longer in recipe_derived). */
  stamps_pruned: number;
}

/** The I/O the scan needs, injected so the logic is testable without D1. */
export interface DupScanDeps {
  /** Every embedded recipe's scan state — one pass over recipe_derived ⋈ recipes ⋈ dup_scan. */
  loadScanState(): Promise<DupScanRow[]>;
  /** Enqueue one pair's `merge_recipes` proposal to the operator queue (idempotent). */
  enqueuePair(pair: DupCandidatePair, nowIso: string): Promise<{ inserted: boolean }>;
  /** Upsert the scanned slugs' stamps. */
  stamp(stamps: { slug: string; hash: string }[], nowIso: string): Promise<void>;
  /** Delete stamps whose slug left recipe_derived; return the count deleted. */
  pruneStamps(): Promise<number>;
  /** Per-tick cap (injected so tests can shrink it). */
  maxPerTick: number;
  /** Epoch-ms clock (injected so tests can pin it). */
  now(): number;
}

/**
 * One scan tick: load state → plan the ≤ cap stale batch → detect against the full set →
 * enqueue proposals → stamp the scanned slugs → prune orphan stamps. Pure orchestration
 * over the injected deps. A partial run is safe: stamping happens after the batch's
 * enqueues, so a crashed tick loses only unstamped progress and repeats idempotently
 * (re-detection is an INSERT OR IGNORE no-op).
 */
export async function scanForDuplicates(deps: DupScanDeps): Promise<DupScanSummary> {
  const rows = await deps.loadScanState();
  const scanSlugs = planDupScan(rows, deps.maxPerTick);
  const pairs = detectPairs(scanSlugs, rows);
  const nowIso = new Date(deps.now()).toISOString();
  let enqueued = 0;
  for (const pair of pairs) {
    const { inserted } = await deps.enqueuePair(pair, nowIso);
    if (inserted) enqueued++;
  }
  if (scanSlugs.length) {
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    await deps.stamp(
      scanSlugs.map((slug) => ({ slug, hash: currentHash(bySlug.get(slug)!) })),
      nowIso,
    );
  }
  const pruned = await deps.pruneStamps();
  return { scanned: scanSlugs.length, pairs_found: pairs.length, enqueued, stamps_pruned: pruned };
}

// --- the real D1 wiring -----------------------------------------------------------------

// One pass over the three tables: embedded derived rows only (no vector → nothing to
// compare — the recipe queues itself once the embed reconcile lands its vector), joined
// to the projected index (title + effective ingredients_key) and the stamp.
const LOAD_STATE_SQL =
  "SELECT d.slug AS slug, r.title AS title, d.embedding AS embedding, d.description_hash AS description_hash, " +
  "r.ingredients_key AS ingredients_key, s.scanned_hash AS stamp " +
  "FROM recipe_derived d JOIN recipes r ON r.slug = d.slug LEFT JOIN dup_scan s ON s.slug = d.slug " +
  "WHERE d.embedding IS NOT NULL AND d.description_hash IS NOT NULL";
const STAMP_SQL =
  "INSERT INTO dup_scan (slug, scanned_hash, scanned_at) VALUES (?1, ?2, ?3) " +
  "ON CONFLICT(slug) DO UPDATE SET scanned_hash = excluded.scanned_hash, scanned_at = excluded.scanned_at";
const PRUNE_STAMPS_SQL = "DELETE FROM dup_scan WHERE slug NOT IN (SELECT slug FROM recipe_derived)";

interface RawStateRow {
  slug: string;
  title: string;
  embedding: string;
  description_hash: string;
  ingredients_key: string | null;
  stamp: string | null;
}

/** Parse a JSON-array column (tolerating null/garbage as []). */
function parseArray<T>(value: string | null, guard: (x: unknown) => x is T): T[] {
  if (typeof value !== "string" || value === "") return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter(guard) : [];
  } catch {
    return [];
  }
}

/** Wire the real D1 client for the scheduled handler. Enqueues address the OPERATOR
 *  tenant (corpus curation is operator-trusted — design C); `runDupScanJob` gates on the
 *  tenant existing before any dep runs. */
export function buildDupScanDeps(env: Env): DupScanDeps {
  return {
    async loadScanState() {
      const rows = await db(env).all<RawStateRow>(LOAD_STATE_SQL);
      return rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        embedding: parseArray(r.embedding, (x): x is number => typeof x === "number"),
        descriptionHash: r.description_hash,
        ingredientsKey: parseArray(r.ingredients_key, (x): x is string => typeof x === "string"),
        stamp: r.stamp,
      }));
    },
    async enqueuePair(pair, nowIso) {
      // OWNER_TENANT_ID is set whenever this runs (the job returns early otherwise).
      const operator = normalizeTenantId(env.OWNER_TENANT_ID as string);
      const { inserted } = await enqueueProposal(env, operator, draftMergeProposal(pair), DUP_SCAN_JOB, nowIso);
      return { inserted };
    },
    async stamp(stamps, nowIso) {
      if (stamps.length === 0) return;
      const d = db(env);
      await d.batch(stamps.map((s) => d.prepare(STAMP_SQL, s.slug, s.hash, nowIso)));
    },
    async pruneStamps() {
      const r = await db(env).run(PRUNE_STAMPS_SQL);
      return r.changes;
    },
    maxPerTick: DUP_SCAN_MAX_PER_TICK,
    now: () => Date.now(),
  };
}

/**
 * One scheduled run of the scan: gate on the operator tenant, do the pass, record the
 * `dup-scan` job_health/job_runs/usage point, and rethrow a hard failure so the
 * platform's native cron status reflects it — the `runReconcileSignalsJob` shape.
 * With NO operator tenant configured there is no queue to address, so the run is a
 * recorded no-op WITHOUT scanning or stamping (design C: stamping would permanently
 * swallow the backlog; configuring the operator later gets the full first sweep).
 */
export async function runDupScanJob(env: Env, deps: DupScanDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    if (!env.OWNER_TENANT_ID) {
      const summary = { skipped: "no_operator" };
      await writeJobHealth(env, DUP_SCAN_JOB, { ok: true, last_run_at: startedAt, summary });
      await writeJobRun(env, DUP_SCAN_JOB, { ok: true, ran_at: startedAt, duration_ms: deps.now() - startedAt, summary });
      recordUsagePoint(env, DUP_SCAN_JOB, { ok: true, durationMs: deps.now() - startedAt, counts: [0, 0, 0, 0] });
      return;
    }
    const s = await scanForDuplicates(deps);
    const summary = { scanned: s.scanned, pairs_found: s.pairs_found, enqueued: s.enqueued, stamps_pruned: s.stamps_pruned };
    await writeJobHealth(env, DUP_SCAN_JOB, { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, DUP_SCAN_JOB, { ok: true, ran_at: startedAt, duration_ms: deps.now() - startedAt, summary });
    // History point (usage-trends): doubles = [duration_ms, scanned, pairs_found, enqueued, stamps_pruned].
    recordUsagePoint(env, DUP_SCAN_JOB, {
      ok: true,
      durationMs: deps.now() - startedAt,
      counts: [s.scanned, s.pairs_found, s.enqueued, s.stamps_pruned],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dup-scan] failed:", msg);
    await writeJobHealth(env, DUP_SCAN_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, DUP_SCAN_JOB, { ok: false, ran_at: startedAt, duration_ms: deps.now() - startedAt, summary: { error: msg } });
    recordUsagePoint(env, DUP_SCAN_JOB, { ok: false, durationMs: deps.now() - startedAt });
    await notifyFailure(env, DUP_SCAN_JOB, msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
