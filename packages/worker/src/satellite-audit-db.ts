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

/** Read options for the ledger: an optional recency floor + an optional exact-source filter, bounded. */
export interface ReadRejectionsOpts {
  sinceMs?: number;
  /** Exact `source` match (a store slug or feed/site source). */
  source?: string;
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

/** A raw accept-tally row. */
export interface SourceStatsRow {
  tenant: string | null;
  kind: string;
  source: string;
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
 * Upsert the per-source accept-tally, advancing `last_accepted_at` ONLY on an accept (a dedup bumps
 * the deduped counter without touching recency — a dedup is a benign re-report). Targets the
 * COALESCE(tenant,'') unique index so operator-global (NULL-tenant) sources keep a single row rather
 * than accumulating one per batch. Called once per batch per source from the intake choke point.
 */
export async function bumpAcceptTally(env: Env, t: AcceptTally, now: number = Date.now()): Promise<void> {
  const firstAccept = t.accepted > 0 ? now : null;
  await db(env).run(
    "INSERT INTO satellite_source_stats (tenant, kind, source, accepted, deduped, last_accepted_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
      "ON CONFLICT (COALESCE(tenant, ''), kind, source) DO UPDATE SET " +
      "accepted = accepted + ?7, deduped = deduped + ?8, " +
      "last_accepted_at = CASE WHEN ?9 > 0 THEN ?10 ELSE last_accepted_at END",
    t.tenant,
    t.kind,
    t.source,
    t.accepted,
    t.deduped,
    firstAccept,
    t.accepted, // ?7 — bound separately (no reused placeholder)
    t.deduped, // ?8
    t.accepted, // ?9
    now, // ?10
  );
}

/** Every accept-tally row (bounded by a household's satellites; read for the reliability rollup). */
export async function readSourceStats(env: Env): Promise<SourceStatsRow[]> {
  return db(env).all<SourceStatsRow>(
    "SELECT tenant, kind, source, accepted, deduped, last_accepted_at FROM satellite_source_stats",
  );
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

/** The per-`{kind, source}` reliability signal (acceptance/fail rate + staleness + the quarantine hints). */
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
  /** now − lastAcceptedAt, or null when the source has never accepted. */
  staleMs: number | null;
  quarantined: boolean;
  /** A fixed numeric rule: over the fail-rate threshold with a minimum sample. */
  recommendQuarantine: boolean;
}

/** A composite `{kind, source}` map key (NUL-delimited, as elsewhere). */
const qKey = (kind: string, source: string): string => `${kind}\u0000${source}`;

/**
 * The compute-on-read per-`{kind, source}` reliability rollup (Decision B). Folds the accept-tally
 * (the uniform denominator) with the ledger's per-source reject counts and the quarantine flags into
 * one health signal per source: acceptance/fail rate (dedups excluded from the denominator, and
 * quarantine rejects excluded from the fail numerator — they are a block, not a validation failure),
 * staleness, and the numeric quarantine recommendation. Volume is a household's satellites, so it
 * reads the (retention-bounded) ledger + tally + flags whole and aggregates in JS — no GROUP BY, so
 * it stays robust to the fake-D1 idiom the rest of the readers use.
 */
export async function readSourceQuality(env: Env, now: number = Date.now()): Promise<SourceQuality[]> {
  const [stats, rejections, quarantine] = await Promise.all([
    readSourceStats(env),
    readRejections(env, { limit: 1000 }),
    getQuarantine(env),
  ]);

  const quarantinedSet = new Set(quarantine.map((q) => qKey(q.kind, q.source)));

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
  const get = (kind: string, source: string, tenant: string | null): Agg => {
    const k = qKey(kind, source);
    let e = agg.get(k);
    if (!e) {
      e = { tenant, kind, source, accepted: 0, deduped: 0, rejected: 0, lastAcceptedAt: null };
      agg.set(k, e);
    }
    return e;
  };

  for (const s of stats) {
    const e = get(s.kind, s.source, s.tenant);
    e.accepted += s.accepted;
    e.deduped += s.deduped;
    if (s.last_accepted_at != null) e.lastAcceptedAt = Math.max(e.lastAcceptedAt ?? 0, s.last_accepted_at);
  }
  for (const r of rejections) {
    // A quarantine reject is a block, not a validation/plausibility failure — exclude it from the
    // fail numerator so an already-quarantined source's rate reflects its pre-quarantine health.
    if (r.reason === "quarantined") continue;
    const e = get(r.kind, r.source, r.tenant);
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
        quarantined: quarantinedSet.has(qKey(e.kind, e.source)),
        recommendQuarantine: sample >= QUARANTINE_MIN_SAMPLE && failRate >= QUARANTINE_FAIL_RATE_THRESHOLD,
      };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source));
}
