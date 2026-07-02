// D1 layer for satellite ingest (recipe-ingestion): the ingest-key roster
// (ingest_keys) and the pushed-content inbox (ingest_candidates). All access goes
// through src/db.ts so a D1 failure surfaces as a structured storage_error, never a
// raw throw. The plaintext key secret is shown ONCE at mint and never stored — only a
// SHA-256 hash (the lookup key) + a short display prefix are persisted.
//
// NOTE: the DB objects keep their `ingest_*` names and the `ingest_keys.last_scraper_version`
// column is retained (renaming a deployed DB object is out of bounds); only the in-code
// vocabulary reads "satellite". The v2 wire field `satellite_version` maps onto that column.

import { db } from "./db.js";
import type { Env } from "./env.js";
import { CONTRACT_VERSION, type PushResult } from "@grocery-agent/contract";
import { countPushedOutcomesSince } from "./discovery-db.js";

/** A satellite is `fresh` if its most recent push is within this window, else `stale`; `never` = no push. */
export const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** SHA-256 hex of a string (Web Crypto — runs on workerd; the key-secret lookup hash). */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Random hex of `bytes` length (2 hex chars per byte). */
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── ingest_keys ──────────────────────────────────────────────────────────────

export interface IngestKeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  status: string; // active | revoked
  last_scraper_version: string | null;
  last_contract_version: string | null;
}

/**
 * Mint a key for a satellite `label`. Returns the full `secret` ONCE (caller shows it once
 * and discards it); only its hash + prefix are stored. Secret format `ing_live_<hex>`,
 * prefix the first 13 chars (`ing_live_` + 4 hex).
 */
export async function mintIngestKey(
  env: Env,
  label: string,
  now: number = Date.now(),
): Promise<{ id: string; secret: string; prefix: string }> {
  const id = "ik_" + randomHex(4);
  const secret = "ing_live_" + randomHex(24);
  const prefix = secret.slice(0, 13);
  const keyHash = await sha256Hex(secret);
  await db(env).run(
    "INSERT INTO ingest_keys (id, label, key_hash, key_prefix, created_at, last_used_at, status) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    id,
    label,
    keyHash,
    prefix,
    now,
    null,
    "active",
  );
  return { id, secret, prefix };
}

/** Revoke a key by id (immediate — the next push with it is rejected). */
export async function revokeIngestKey(env: Env, id: string): Promise<boolean> {
  const res = await db(env).run("UPDATE ingest_keys SET status = ?2 WHERE id = ?1", id, "revoked");
  return res.changes > 0;
}

/** Roster of keys (most-recent-first) for the admin editor. Never returns a secret/hash. */
export async function listIngestKeys(env: Env): Promise<IngestKeyRow[]> {
  return db(env).all<IngestKeyRow>(
    "SELECT id, label, key_prefix, created_at, last_used_at, status, last_scraper_version, last_contract_version " +
      "FROM ingest_keys ORDER BY created_at DESC",
  );
}

/**
 * Resolve a presented bearer secret to its ACTIVE key, by SHA-256 hash equality (an
 * indexed DB lookup — the hash IS the credential, so there is no per-row secret compare).
 * Returns null for an unknown or revoked key.
 */
export async function lookupIngestKey(env: Env, secret: string): Promise<IngestKeyRow | null> {
  const keyHash = await sha256Hex(secret);
  const row = await db(env).first<IngestKeyRow>(
    "SELECT id, label, key_prefix, created_at, last_used_at, status, last_scraper_version, last_contract_version " +
      "FROM ingest_keys WHERE key_hash = ?1 AND status = 'active'",
    keyHash,
  );
  return row ?? null;
}

/** Stamp last_used + the reported satellite/contract version after a successful auth. Best-effort.
 *  `satelliteVersion` is persisted into the retained `last_scraper_version` column (unchanged). */
export async function touchIngestKey(
  env: Env,
  id: string,
  satelliteVersion: string,
  contractVersion: string,
  now: number = Date.now(),
): Promise<void> {
  await db(env).run(
    "UPDATE ingest_keys SET last_used_at = ?2, last_scraper_version = ?3, last_contract_version = ?4 WHERE id = ?1",
    id,
    now,
    satelliteVersion,
    contractVersion,
  );
}

// ── ingest_candidates (the pushed-content inbox) ──────────────────────────────

/** The pre-parsed content persisted per pushed candidate (rebuilt into a sweep candidate). */
export interface PushedContent {
  ingredients: string[];
  instructions: string[];
  summary?: string | null;
  servings?: number | string | null;
  time_total?: number | null;
  time_active?: number | null;
}

export interface IngestCandidateRow {
  url: string;
  title: string;
  content: PushedContent;
  origin: string;
  key_id: string;
  received_at: string;
}

/**
 * Insert one accepted pushed candidate, deduped by canonical `url` (INSERT OR IGNORE).
 * Returns whether a row was written (false = a duplicate already in the inbox).
 */
export async function insertIngestCandidate(
  env: Env,
  cand: { url: string; title: string; content: PushedContent; origin: string; keyId: string; receivedAt: string },
): Promise<boolean> {
  const res = await db(env).run(
    "INSERT OR IGNORE INTO ingest_candidates (id, url, title, content, origin, key_id, received_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    crypto.randomUUID(),
    cand.url,
    cand.title,
    JSON.stringify(cand.content),
    cand.origin,
    cand.keyId,
    cand.receivedAt,
  );
  return res.changes > 0;
}

/** Every pushed candidate awaiting the sweep (content parsed back from JSON). */
export async function readIngestCandidates(env: Env): Promise<IngestCandidateRow[]> {
  const rows = await db(env).all<{
    url: string;
    title: string;
    content: string;
    origin: string;
    key_id: string;
    received_at: string;
  }>("SELECT url, title, content, origin, key_id, received_at FROM ingest_candidates ORDER BY received_at");
  const out: IngestCandidateRow[] = [];
  for (const r of rows) {
    let content: PushedContent;
    try {
      content = JSON.parse(r.content) as PushedContent;
    } catch {
      continue; // a corrupt row is skipped rather than crashing the sweep
    }
    out.push({ url: r.url, title: r.title, content, origin: r.origin, key_id: r.key_id, received_at: r.received_at });
  }
  return out;
}

/** The set of urls currently in the inbox (the in-flight arm of arrival dedup). */
export async function ingestCandidateUrls(env: Env): Promise<Set<string>> {
  const rows = await db(env).all<{ url: string }>("SELECT url FROM ingest_candidates");
  return new Set(rows.map((r) => r.url));
}

/** Remove one pushed candidate by url — called once it reaches a terminal outcome. */
export async function deleteIngestCandidate(env: Env, url: string): Promise<void> {
  await db(env).run("DELETE FROM ingest_candidates WHERE url = ?1", url);
}

// ── ingest_pushes (push history → the admin liveness rollup) ───────────────────

export interface IngestPushRow {
  id: string;
  key_id: string;
  source: string;
  received: number;
  accepted: number;
  deduped: number;
  rejected: number;
  result: PushResult;
  created_at: number;
}

/** Record one authenticated POST /admin/api/ingest batch (best-effort observability). */
export async function recordIngestPush(
  env: Env,
  p: { keyId: string; source: string; received: number; accepted: number; deduped: number; rejected: number; result: PushResult },
  now: number = Date.now(),
): Promise<void> {
  await db(env).run(
    "INSERT INTO ingest_pushes (id, key_id, source, received, accepted, deduped, rejected, result, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    crypto.randomUUID(),
    p.keyId,
    p.source,
    p.received,
    p.accepted,
    p.deduped,
    p.rejected,
    p.result,
    now,
  );
}

/** Recent push rows since `sinceMs` (default: all), most-recent-first, bounded. */
export async function readIngestPushes(env: Env, sinceMs = 0, limit = 500): Promise<IngestPushRow[]> {
  return db(env).all<IngestPushRow>(
    "SELECT id, key_id, source, received, accepted, deduped, rejected, result, created_at FROM ingest_pushes " +
      "WHERE created_at >= ?1 ORDER BY created_at DESC LIMIT ?2",
    sinceMs,
    Math.max(1, Math.min(limit, 1000)),
  );
}

/** Prune push rows older than `beforeMs` (retention). Returns rows removed. */
export async function pruneIngestPushes(env: Env, beforeMs: number): Promise<number> {
  const res = await db(env).run("DELETE FROM ingest_pushes WHERE created_at < ?1", beforeMs);
  return res.changes;
}

// ── the liveness rollup (Discovery › Satellites + Status) ─────────────────────

export type Health = "fresh" | "stale" | "never";

export interface SourceLiveness {
  name: string;
  lastPush: number | null;
  health: Health;
  pushes24h: number;
  pushes7d: number;
}
export interface SatelliteLiveness {
  id: string;
  label: string;
  prefix: string;
  created: number;
  status: string;
  /** The machine's last reported build (persisted in the retained `last_scraper_version` column). */
  satelliteVersion: string | null;
  contractVersion: string | null;
  skew: boolean;
  lastPush: number | null;
  health: Health;
  pushes24h: number;
  pushes7d: number;
  sourceCount: number;
  sources: SourceLiveness[];
}
export interface RecentPush {
  id: string;
  at: number;
  satellite: string;
  source: string;
  count: number;
  deduped: number;
  rejected: number;
  result: PushResult;
}
export interface SatelliteRollup {
  contractVersion: string;
  satellites: SatelliteLiveness[];
  activeSatellites: SatelliteLiveness[];
  funnel: { arrival: { received: number; accepted: number; deduped: number; swept: number }; downstream: { imported: number; noMatch: number; duplicate: number; parked: number } };
  pushes: RecentPush[];
  stats: { activeSatellites: number; fresh: number; stale: number; sources: number; pushes24h: number };
}

function healthFor(lastPush: number | null, now: number): Health {
  if (lastPush == null) return "never";
  return now - lastPush <= FRESH_WINDOW_MS ? "fresh" : "stale";
}

/**
 * The admin liveness rollup — per-satellite + per-source health/skew/counts, the 24h throughput
 * funnel (arrival from ingest_pushes; downstream from pushed discovery_log outcomes), and the
 * recent-pushes log. Computed in JS from the key roster + a bounded push read (the fake-D1 has
 * no GROUP BY, and the row counts are small).
 */
export async function readSatelliteLiveness(env: Env, now: number = Date.now()): Promise<SatelliteRollup> {
  const since7d = now - 7 * DAY_MS;
  const since24h = now - DAY_MS;
  const [keys, pushes7d, downstream] = await Promise.all([
    listIngestKeys(env),
    readIngestPushes(env, since7d),
    countPushedOutcomesSince(env, new Date(since24h).toISOString()),
  ]);
  const labelOf = new Map(keys.map((k) => [k.id, k.label]));

  const satellites: SatelliteLiveness[] = keys.map((k) => {
    const mine = pushes7d.filter((p) => p.key_id === k.id);
    // Per-source rollup (accepted-bearing pushes count toward last-push/counts).
    const bySource = new Map<string, IngestPushRow[]>();
    for (const p of mine) (bySource.get(p.source) ?? bySource.set(p.source, []).get(p.source)!).push(p);
    const sources: SourceLiveness[] = [...bySource.entries()]
      .map(([name, rows]) => {
        const times = rows.map((r) => r.created_at);
        return {
          name,
          lastPush: times.length ? Math.max(...times) : null,
          health: healthFor(times.length ? Math.max(...times) : null, now),
          pushes24h: rows.filter((r) => r.created_at >= since24h).length,
          pushes7d: rows.length,
        };
      })
      .sort((a, b) => (b.lastPush ?? 0) - (a.lastPush ?? 0));
    const lastPush = k.last_used_at ?? (mine.length ? Math.max(...mine.map((p) => p.created_at)) : null);
    return {
      id: k.id,
      label: k.label,
      prefix: k.key_prefix,
      created: k.created_at,
      status: k.status,
      satelliteVersion: k.last_scraper_version,
      contractVersion: k.last_contract_version,
      skew: k.last_contract_version != null && k.last_contract_version !== CONTRACT_VERSION,
      lastPush,
      health: healthFor(lastPush, now),
      pushes24h: mine.filter((p) => p.created_at >= since24h).length,
      pushes7d: mine.length,
      sourceCount: sources.length,
      sources,
    };
  });
  const activeSatellites = satellites.filter((s) => s.status === "active");

  const in24h = pushes7d.filter((p) => p.created_at >= since24h);
  const arrival = {
    received: in24h.reduce((n, p) => n + p.received, 0),
    accepted: in24h.reduce((n, p) => n + p.accepted, 0),
    deduped: in24h.reduce((n, p) => n + p.deduped, 0),
    swept: in24h.reduce((n, p) => n + p.accepted, 0),
  };
  const pushes: RecentPush[] = pushes7d.slice(0, 40).map((p) => ({
    id: p.id,
    at: p.created_at,
    satellite: labelOf.get(p.key_id) ?? p.key_id,
    source: p.source,
    count: p.accepted,
    deduped: p.deduped,
    rejected: p.rejected,
    result: p.result,
  }));

  return {
    contractVersion: CONTRACT_VERSION,
    satellites,
    activeSatellites,
    funnel: { arrival, downstream },
    pushes,
    stats: {
      activeSatellites: activeSatellites.length,
      fresh: activeSatellites.filter((s) => s.health === "fresh").length,
      stale: activeSatellites.filter((s) => s.health === "stale").length,
      sources: activeSatellites.reduce((n, s) => n + s.sourceCount, 0),
      pushes24h: activeSatellites.reduce((n, s) => n + s.pushes24h, 0),
    },
  };
}
