// D1 layer for the satellite source-audit (satellite-source-audit): the rejection LEDGER
// (satellite_rejections), the per-source accept-tally (satellite_source_stats), and the per-source
// quarantine flag (satellite_quarantine). All access goes through src/db.ts so a D1 failure surfaces
// as a structured storage_error, never a raw throw (D4). The audit owns its own accounting substrate
// end-to-end — the ledger records rejects, the tally records accepts — and reuses `ingest_pushes`
// only as an OPTIONAL recipe cross-check, never as a load-bearing denominator (Decision B).
//
// The ledger is APPEND-with-rolling-prune (a rejection is a point-in-time EVENT), NOT the DELETE +
// re-insert idiom of reconcile_errors — it is pruned by age on the cron beside pruneStaleOrderLists.

import { db } from "./db.js";
import type { Env } from "./env.js";
import type { LocalReject } from "@grocery-agent/contract";

/** A satellite rejection's origin: caught Worker-side at intake, or reported by the satellite's local validators. */
export type RejectionOrigin = "worker" | "local";

/** One appended ledger row (a Worker-side reject = one row with count 1; a local summary entry = one row with its count). */
export interface RejectionEntry {
  /** The carrying ingest key's tenant binding (NULL = operator-global). */
  tenant: string | null;
  /** The ingest key that carried it (NULL for a synthesized origin). */
  keyId: string | null;
  kind: string;
  source: string;
  origin: RejectionOrigin;
  reason: string;
  /** The offending url / productId / item_id / a local sample (nullable). */
  provenance: string | null;
  /** 1 for a Worker reject; N for a pre-aggregated local-summary entry. */
  count?: number;
}

/** A ledger row as read back (most-recent-first). */
export interface RejectionRow {
  id: string;
  tenant: string | null;
  key_id: string | null;
  kind: string;
  source: string;
  origin: RejectionOrigin;
  reason: string;
  provenance: string | null;
  count: number;
  rejected_at: number;
}

/**
 * Append one rejection to the ledger. A Worker-side reject lands as a single row (`count` defaults
 * to 1); a satellite-reported local-reject summary entry lands pre-aggregated as one row carrying its
 * `count` and the redacted `sample` in `provenance`. Through src/db.ts → a D1 failure is a structured
 * storage_error (so an intake caller surfaces it as its 503, never a raw throw).
 */
export async function appendRejection(env: Env, entry: RejectionEntry, now: number = Date.now()): Promise<void> {
  await db(env).run(
    "INSERT INTO satellite_rejections (id, tenant, key_id, kind, source, origin, reason, provenance, count, rejected_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    crypto.randomUUID(),
    entry.tenant,
    entry.keyId,
    entry.kind,
    entry.source,
    entry.origin,
    entry.reason,
    entry.provenance,
    entry.count ?? 1,
    now,
  );
}

/**
 * Record a satellite-reported local-reject summary (satellite-source-audit, Decision D) into the
 * ledger — ONE row per entry, `origin: "local"`, carrying the pre-aggregated `count` and the redacted
 * `sample` as `provenance`; `reason` is the category. Local rejects do NOT bump the accept-tally
 * (they were never accepted) — they raise the source's fail-rate exactly as a Worker-side reject does,
 * which is the point: a locally-dropped flood (a broken adapter) becomes visible. Reuses
 * `appendRejection` (no duplicated logic); awaited so a D1 failure surfaces as the caller's 503.
 */
export async function recordLocalRejects(
  env: Env,
  ctx: { entries: LocalReject[]; tenant: string | null; keyId: string | null; kind: string; source: string },
  now: number = Date.now(),
): Promise<void> {
  for (const e of ctx.entries) {
    await appendRejection(
      env,
      { tenant: ctx.tenant, keyId: ctx.keyId, kind: ctx.kind, source: ctx.source, origin: "local", reason: e.category, provenance: e.sample ?? null, count: e.count },
      now,
    );
  }
}

/** Read options for the ledger: an optional recency floor + optional exact source/kind filters, bounded. */
export interface ReadRejectionsOpts {
  sinceMs?: number;
  /** Exact `source` match (a store slug or feed/site source). */
  source?: string;
  /**
   * Exact `kind` match (recipe | sale | order). Pairs with `source` so a same-NAMED source of a
   * different kind (a store slug that is also a recipe feed name) does not merge into one drill-down —
   * the admin Satellites detail fetches a source's ledger by `{kind, source}`.
   */
  kind?: string;
  /**
   * When set, restrict to rows VISIBLE to this tenant: operator-global (`tenant IS NULL`) OR this
   * exact tenant. `read_satellite_rejections` passes it so an `order`-kind row (tenant-private,
   * provenance = product url/id) stays scoped to its owner while recipe/sale (operator-global) stay
   * household-wide. Applied in SQL (not post-LIMIT) so a flood of another tenant's rows can't crowd
   * the caller's out of the bounded window. Unset ⇒ no tenant restriction (the admin household view).
   */
  tenantScope?: string;
  limit?: number;
}

/**
 * Recent ledger rows, MOST-RECENT-FIRST, bounded. Optionally floored at `sinceMs` and/or filtered to
 * one `source`. Reflects ONLY rejected observations — an accepted one never appears here. Shared
 * across the household (not tenant-filtered), like read_reconcile_errors.
 */
export async function readRejections(env: Env, opts: ReadRejectionsOpts = {}): Promise<RejectionRow[]> {
  const since = opts.sinceMs ?? 0;
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
  // Build the binds/placeholders in order so the optional source filter never desyncs its `?N`.
  const binds: unknown[] = [since];
  let where = "rejected_at >= ?1";
  if (opts.source !== undefined) {
    binds.push(opts.source);
    where += ` AND source = ?${binds.length}`;
  }
  if (opts.kind !== undefined) {
    binds.push(opts.kind);
    where += ` AND kind = ?${binds.length}`;
  }
  if (opts.tenantScope !== undefined) {
    binds.push(opts.tenantScope);
    where += ` AND (tenant IS NULL OR tenant = ?${binds.length})`;
  }
  binds.push(limit);
  const limitP = `?${binds.length}`;
  return db(env).all<RejectionRow>(
    "SELECT id, tenant, key_id, kind, source, origin, reason, provenance, count, rejected_at " +
      `FROM satellite_rejections WHERE ${where} ORDER BY rejected_at DESC LIMIT ${limitP}`,
    ...binds,
  );
}

/** Prune ledger rows older than `beforeMs` (retention). Returns rows removed — the analog of pruneIngestPushes. */
export async function pruneSatelliteRejections(env: Env, beforeMs: number): Promise<number> {
  const res = await db(env).run("DELETE FROM satellite_rejections WHERE rejected_at < ?1", beforeMs);
  return res.changes;
}

// ── satellite_source_stats (the accept-tally = the uniform rate denominator) ──────────────────────

/** One epoch-day (86_400_000 ms). The accept-tally's `day` bucket + the reliability window floor. */
const DAY_MS = 86_400_000;
/** The epoch-day bucket a timestamp falls in — the accept-tally key + the windowing/prune boundary. */
const epochDay = (ms: number): number => Math.floor(ms / DAY_MS);

/** A raw accept-tally row (one per `{tenant, kind, source, day}` bucket). */
export interface SourceStatsRow {
  tenant: string | null;
  kind: string;
  source: string;
  /** The epoch-day bucket this counter accumulates into (the windowing/prune key). */
  day: number;
  accepted: number;
  deduped: number;
  last_accepted_at: number | null;
}

/** One accept-tally bump for a `{tenant, kind, source}` — the accepted/deduped deltas for a batch's arm. */
export interface AcceptTally {
  tenant: string | null;
  kind: string;
  source: string;
  accepted: number;
  deduped: number;
}

/**
 * Upsert the per-source accept-tally into TODAY's day bucket, advancing `last_accepted_at` ONLY on an
 * accept (a dedup bumps the deduped counter without touching recency — a dedup is a benign re-report).
 * Targets the COALESCE(tenant,'') unique index (now including `day`) so operator-global (NULL-tenant)
 * sources keep a single row per day rather than accumulating one per batch. Called once per batch per
 * source from the intake choke point. Bucketing by day is what lets the reliability rollup sum accepts
 * over a RECENT window comparable to its windowed reject count (Decision B / the windowed-rate fix).
 */
export async function bumpAcceptTally(env: Env, t: AcceptTally, now: number = Date.now()): Promise<void> {
  const firstAccept = t.accepted > 0 ? now : null;
  const day = epochDay(now);
  await db(env).run(
    "INSERT INTO satellite_source_stats (tenant, kind, source, day, accepted, deduped, last_accepted_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
      "ON CONFLICT (COALESCE(tenant, ''), kind, source, day) DO UPDATE SET " +
      "accepted = accepted + ?8, deduped = deduped + ?9, " +
      "last_accepted_at = CASE WHEN ?10 > 0 THEN ?11 ELSE last_accepted_at END",
    t.tenant, // ?1
    t.kind, // ?2
    t.source, // ?3
    day, // ?4
    t.accepted, // ?5
    t.deduped, // ?6
    firstAccept, // ?7
    t.accepted, // ?8 — bound separately (no reused placeholder)
    t.deduped, // ?9
    t.accepted, // ?10
    now, // ?11
  );
}

/** Every accept-tally bucket (bounded by a household's satellites × the retention window; the
 *  reliability rollup windows these by `day` on read). */
export async function readSourceStats(env: Env): Promise<SourceStatsRow[]> {
  return db(env).all<SourceStatsRow>(
    "SELECT tenant, kind, source, day, accepted, deduped, last_accepted_at FROM satellite_source_stats",
  );
}

/**
 * Prune accept-tally buckets whose `day` is older than the day containing `beforeMs` (the SAME
 * retention window as the ledger prune — `logRetentionDays`). Day-granular: keeps the bucket that
 * straddles the window edge, matching `readSourceQuality`'s `day >= floor((now − W) / DAY)` floor, so
 * the prune never drops a bucket the rollup would still count. Returns rows removed — the accept-tally's
 * analog of `pruneSatelliteRejections`; wired into `scheduled()`'s phase-1 reap beside it.
 */
export async function pruneSourceStats(env: Env, beforeMs: number): Promise<number> {
  const res = await db(env).run("DELETE FROM satellite_source_stats WHERE day < ?1", epochDay(beforeMs));
  return res.changes;
}

// ── satellite_quarantine (the per-source reversible Worker-side reject flag) ───────────────────────

/** A quarantine flag row. */
export interface QuarantineRow {
  tenant: string | null;
  kind: string;
  source: string;
  quarantined_at: number;
  note: string | null;
}

/** The `{tenant, kind, source}` a quarantine setter/checker keys on. */
export interface QuarantineKey {
  tenant: string | null;
  kind: string;
  source: string;
}

/**
 * Mark a source quarantined (idempotent — re-toggling refreshes the timestamp/note). Its future
 * observations are rejected at intake before acceptance. Targets the COALESCE(tenant,'') unique index.
 */
export async function setQuarantine(env: Env, key: QuarantineKey, note: string | null = null, now: number = Date.now()): Promise<void> {
  await db(env).run(
    "INSERT INTO satellite_quarantine (tenant, kind, source, quarantined_at, note) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT (COALESCE(tenant, ''), kind, source) DO UPDATE SET quarantined_at = ?6, note = ?7",
    key.tenant,
    key.kind,
    key.source,
    now,
    note,
    now, // ?6 — bound separately
    note, // ?7
  );
}

/** Clear a source's quarantine (the next observation flows again). Returns whether a flag was removed. */
export async function clearQuarantine(env: Env, key: QuarantineKey): Promise<boolean> {
  const res = await db(env).run(
    "DELETE FROM satellite_quarantine WHERE tenant IS ?1 AND kind = ?2 AND source = ?3",
    key.tenant,
    key.kind,
    key.source,
  );
  return res.changes > 0;
}

/** Every quarantine flag (most-recent-first) — for the read tool + the admin surface. */
export async function getQuarantine(env: Env): Promise<QuarantineRow[]> {
  return db(env).all<QuarantineRow>(
    "SELECT tenant, kind, source, quarantined_at, note FROM satellite_quarantine ORDER BY quarantined_at DESC",
  );
}

/**
 * Whether a specific `{tenant, kind, source}` is quarantined. `tenant IS ?1` matches a NULL
 * (operator-global) binding correctly. The intake loads the whole set once per batch rather than
 * calling this per item, but it exists for a direct single check.
 */
export async function isQuarantined(env: Env, key: QuarantineKey): Promise<boolean> {
  const row = await db(env).first<{ one: number }>(
    "SELECT 1 AS one FROM satellite_quarantine WHERE tenant IS ?1 AND kind = ?2 AND source = ?3 LIMIT 1",
    key.tenant,
    key.kind,
    key.source,
  );
  return row != null;
}

// ── the reliability rollup (compute-on-read; Decision B) ──────────────────────────────────────────

/**
 * A source over this fail-rate, with at least QUARANTINE_MIN_SAMPLE observations, surfaces a
 * quarantine RECOMMENDATION (never an auto-quarantine — the operator confirms). A fixed numeric rule;
 * no model.
 */
export const QUARANTINE_FAIL_RATE_THRESHOLD = 0.3;
export const QUARANTINE_MIN_SAMPLE = 20;

/**
 * The reliability WINDOW W — the recent span the rollup sums accepts over AND counts rejects over, so
 * the two are comparable (a windowed fail-rate, not windowed-rejects / all-time-accepts). Defaults to
 * the operator log-retention default (`discovery-sweep`'s `DEFAULT_CONFIG.logRetentionDays`), the same
 * knob the reject/tally prune uses; a caller MAY pass a tighter/wider window. Kept as a local constant
 * (not imported from discovery-sweep) so this D1 layer stays free of the sweep's config surface.
 */
export const SOURCE_QUALITY_WINDOW_DAYS = 60;
export const DEFAULT_SOURCE_QUALITY_WINDOW_MS = SOURCE_QUALITY_WINDOW_DAYS * DAY_MS;

/** The per-`{tenant, kind, source}` reliability signal (acceptance/fail rate + staleness + the quarantine hints). */
export interface SourceQuality {
  /** The tenant binding this source's accounting carries (NULL = operator-global). */
  tenant: string | null;
  kind: string;
  source: string;
  accepted: number;
  /** Sum of the ledger's reject `count`s for this source, EXCLUDING quarantine rejects (not validation fails). */
  rejected: number;
  deduped: number;
  /** accepted + rejected — the rate denominator (dedups excluded). */
  sample: number;
  acceptanceRate: number;
  failRate: number;
  lastAcceptedAt: number | null;
  /** now − lastAcceptedAt, or null when the source has no accept within the reliability window. */
  staleMs: number | null;
  quarantined: boolean;
  /** A fixed numeric rule: over the fail-rate threshold with a minimum sample. */
  recommendQuarantine: boolean;
}

/** A composite `{tenant, kind, source}` map key (NUL-delimited, as elsewhere). Includes `tenant` so
 *  two tenant-distinct rows sharing a `{kind, source}` (order/sale store slugs are shared across a
 *  friend group) never collapse into one aggregate mislabeled with whichever tenant sorted first. */
const qKey = (tenant: string | null, kind: string, source: string): string =>
  `${tenant ?? ""}\u0000${kind}\u0000${source}`;

/**
 * The compute-on-read per-`{tenant, kind, source}` reliability rollup (Decision B). Folds the
 * accept-tally (the uniform denominator) with the ledger's per-source reject counts and the quarantine
 * flags into one health signal per source: acceptance/fail rate (dedups excluded from the denominator,
 * and quarantine rejects excluded from the fail numerator — they are a block, not a validation
 * failure), staleness, and the numeric quarantine recommendation. Both sides of the rate are WINDOWED
 * to the same recent span `windowMs` — accepts summed over the day buckets on/after the floor day, and
 * rejects counted with `rejected_at >= now − windowMs` — so a huge STALE accept history no longer
 * dilutes the fail-rate below the quarantine threshold (windowed-rejects / all-time-accepts was biased
 * DOWN, and the recommendation never fired when a long-healthy source finally broke). Keyed by
 * `{tenant, kind, source}` (consistent with the accept-tally + quarantine keying), so per-tenant rows
 * of a shared store slug stay separate and correctly attributed. Volume is a household's satellites, so
 * it reads the (retention-bounded) tally + windowed ledger + flags whole and aggregates in JS — no
 * GROUP BY, so it stays robust to the fake-D1 idiom the rest of the readers use.
 */
export async function readSourceQuality(
  env: Env,
  now: number = Date.now(),
  windowMs: number = DEFAULT_SOURCE_QUALITY_WINDOW_MS,
): Promise<SourceQuality[]> {
  const sinceMs = now - windowMs;
  const sinceDay = epochDay(sinceMs);
  const [stats, rejections, quarantine] = await Promise.all([
    readSourceStats(env),
    // Window the reject numerator by TIME (not a bare row cap) so it matches the windowed accepts; the
    // 1000-row cap remains a safety bound (rejects land pre-aggregated per local-summary entry).
    readRejections(env, { sinceMs, limit: 1000 }),
    getQuarantine(env),
  ]);

  const quarantinedSet = new Set(quarantine.map((q) => qKey(q.tenant, q.kind, q.source)));

  interface Agg {
    tenant: string | null;
    kind: string;
    source: string;
    accepted: number;
    deduped: number;
    rejected: number;
    lastAcceptedAt: number | null;
  }
  const agg = new Map<string, Agg>();
  const get = (tenant: string | null, kind: string, source: string): Agg => {
    const k = qKey(tenant, kind, source);
    let e = agg.get(k);
    if (!e) {
      e = { tenant, kind, source, accepted: 0, deduped: 0, rejected: 0, lastAcceptedAt: null };
      agg.set(k, e);
    }
    return e;
  };

  for (const s of stats) {
    // Only day buckets within W count toward the (windowed) accept denominator — a stale accept
    // history outside the window is excluded so the rate reflects RECENT health. A source whose
    // accepts all age out but whose recent rejects flood still appears (via the reject loop below),
    // rate ≈ 1.0.
    if (s.day < sinceDay) continue;
    const e = get(s.tenant, s.kind, s.source);
    e.accepted += s.accepted;
    e.deduped += s.deduped;
    if (s.last_accepted_at != null) e.lastAcceptedAt = Math.max(e.lastAcceptedAt ?? 0, s.last_accepted_at);
  }
  for (const r of rejections) {
    // A quarantine reject is a block, not a validation/plausibility failure — exclude it from the
    // fail numerator so an already-quarantined source's rate reflects its pre-quarantine health.
    if (r.reason === "quarantined") continue;
    const e = get(r.tenant, r.kind, r.source);
    e.rejected += r.count;
  }

  return [...agg.values()]
    .map((e): SourceQuality => {
      const sample = e.accepted + e.rejected;
      const failRate = sample > 0 ? e.rejected / sample : 0;
      const acceptanceRate = sample > 0 ? e.accepted / sample : 0;
      return {
        tenant: e.tenant,
        kind: e.kind,
        source: e.source,
        accepted: e.accepted,
        rejected: e.rejected,
        deduped: e.deduped,
        sample,
        acceptanceRate,
        failRate,
        lastAcceptedAt: e.lastAcceptedAt,
        staleMs: e.lastAcceptedAt != null ? now - e.lastAcceptedAt : null,
        quarantined: quarantinedSet.has(qKey(e.tenant, e.kind, e.source)),
        recommendQuarantine: sample >= QUARANTINE_MIN_SAMPLE && failRate >= QUARANTINE_FAIL_RATE_THRESHOLD,
      };
    })
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.source.localeCompare(b.source) ||
        (a.tenant ?? "").localeCompare(b.tenant ?? ""),
    );
}
