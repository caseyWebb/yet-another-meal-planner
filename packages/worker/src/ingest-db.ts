// D1 layer for walled-source ingest (recipe-ingestion): the ingest-key roster
// (ingest_keys) and the pushed-content inbox (ingest_candidates). All access goes
// through src/db.ts so a D1 failure surfaces as a structured storage_error, never a
// raw throw. The plaintext key secret is shown ONCE at mint and never stored — only a
// SHA-256 hash (the lookup key) + a short display prefix are persisted.

import { db } from "./db.js";
import type { Env } from "./env.js";

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
 * Mint a key for a scraper `label`. Returns the full `secret` ONCE (caller shows it once
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
  const res = await db(env).run("UPDATE ingest_keys SET status = 'revoked' WHERE id = ?1", id);
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

/** Stamp last_used + the reported scraper/contract version after a successful auth. Best-effort. */
export async function touchIngestKey(
  env: Env,
  id: string,
  scraperVersion: string,
  contractVersion: string,
  now: number = Date.now(),
): Promise<void> {
  await db(env).run(
    "UPDATE ingest_keys SET last_used_at = ?2, last_scraper_version = ?3, last_contract_version = ?4 WHERE id = ?1",
    id,
    now,
    scraperVersion,
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
