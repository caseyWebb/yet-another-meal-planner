// D1 layer for the background discovery sweep (background-discovery-sweep). All access to
// the sweep-owned tables (discovery_log, discovery_matches) + the new-for-me read +
// the per-tenant planning watermark goes through here, over src/db.ts (so a D1 failure
// surfaces as a structured storage_error, never a raw throw — the tools stay throw-free).
//
// discovery_log is one table serving three roles (migration 0016 / design Decision 11):
//   * the operator audit log        — readDiscoveryLog (most-recent-first, bounded)
//   * the dedup "already evaluated"  — loadEvaluatedUrls (don't reprocess a handled url)
//   * the parked/failed surface      — readDiscoveryErrors (outcome 'error' = content park,
//                                      'failed' = infrastructure failure, transient/in-retry)
//
// Migration 0018 adds `attempts` and `next_retry_at` for the retry lifecycle:
// `error/unreachable` and `failed` rows become retryable (bounded backoff + cap);
// `next_retry_at IS NOT NULL` means due-for-retry; NULL means terminal.

import { db } from "./db.js";
import type { Env } from "./env.js";

export interface DiscoveryLogRow {
  id: string;
  url: string | null;
  title: string | null;
  source: string | null;
  outcome: string;
  slug: string | null;
  detail: unknown;
  created_at: string | null;
  /** How many acquisition passes this row has had (0 for legacy/non-retryable; ≥1 for retryable parks). */
  attempts: number;
  /** ISO timestamp when this row next enters the retry stream; null = terminal (not retryable). */
  next_retry_at: string | null;
}

/** Append one per-candidate outcome to the discovery log. */
export async function recordDiscoveryLog(
  env: Env,
  entry: {
    url: string;
    title: string;
    source: string;
    outcome: string;
    slug?: string | null;
    detail?: Record<string, unknown>;
    createdAt: string;
    attempts?: number;
    nextRetryAt?: string | null;
  },
): Promise<void> {
  await db(env).run(
    "INSERT INTO discovery_log (id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    crypto.randomUUID(),
    entry.url,
    entry.title,
    entry.source,
    entry.outcome,
    entry.slug ?? null,
    entry.detail ? JSON.stringify(entry.detail) : null,
    entry.createdAt,
    entry.attempts ?? 0,
    entry.nextRetryAt ?? null,
  );
}

/** Every URL already evaluated by a prior tick (the dedup set — don't reprocess). */
export async function loadEvaluatedUrls(env: Env): Promise<Set<string>> {
  const rows = await db(env).all<{ url: string | null }>(
    "SELECT DISTINCT url FROM discovery_log WHERE url IS NOT NULL",
  );
  const set = new Set<string>();
  for (const { url } of rows) if (url) set.add(url);
  return set;
}

/** Count of standing INFRASTRUCTURE failures (`outcome = 'failed'`) — the signal the
 *  discovery-sweep health record flips `ok` on, so an idle tick after an outage still reads
 *  as degraded until the failures clear. Distinct from content `error` parks (un-importable
 *  pages), which are an expected steady state and do not degrade health. */
export async function countDiscoveryFailures(env: Env): Promise<number> {
  const row = await db(env).first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM discovery_log WHERE outcome = 'failed'",
  );
  return row?.n ?? 0;
}

function parseDetail(v: unknown): unknown {
  if (typeof v !== "string" || v === "") return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** The operator Discovery log — most-recent-first, bounded (admin Logs view / API). */
export async function readDiscoveryLog(env: Env, limit = 200): Promise<DiscoveryLogRow[]> {
  const rows = await db(env).all<DiscoveryLogRow & { detail: string | null }>(
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at FROM discovery_log " +
      "ORDER BY created_at DESC LIMIT ?1",
    Math.max(1, Math.min(limit, 1000)),
  );
  return rows.map((r) => ({ ...r, detail: parseDetail(r.detail) }));
}

/** The parked/failed subset of the log (the agent-readable read_discovery_errors surface):
 *  content `error` parks AND infrastructure `failed` rows, so nothing dropped is hidden.
 *  `failed` rows are transient/in-retry until their attempt cap is exhausted; exhausted
 *  infrastructure failures resolve to terminal `error` so /health clears. */
export async function readDiscoveryErrors(env: Env, limit = 100): Promise<DiscoveryLogRow[]> {
  const rows = await db(env).all<DiscoveryLogRow & { detail: string | null }>(
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at FROM discovery_log " +
      "WHERE outcome IN ('error', 'failed') ORDER BY created_at DESC LIMIT ?1",
    Math.max(1, Math.min(limit, 1000)),
  );
  return rows.map((r) => ({ ...r, detail: parseDetail(r.detail) }));
}

/** One log row by id (for the admin per-row retry / delete operations). Returns null if not found. */
export async function readDiscoveryRowById(env: Env, id: string): Promise<DiscoveryLogRow | null> {
  const row = await db(env).first<DiscoveryLogRow & { detail: string | null }>(
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at FROM discovery_log WHERE id = ?1",
    id,
  );
  if (!row) return null;
  return { ...row, detail: parseDetail(row.detail) };
}

/** Due retryable rows — outcome IN ('error','failed'), next_retry_at <= now, not rejected.
 *  Returns up to `limit` rows for the retry stream each sweep tick. */
export async function loadDueRetries(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<DiscoveryLogRow[]> {
  const rows = await db(env).all<DiscoveryLogRow & { detail: string | null }>(
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at " +
      "FROM discovery_log " +
      "WHERE outcome IN ('error', 'failed') AND next_retry_at IS NOT NULL AND next_retry_at <= ?1 " +
      "AND (url IS NULL OR url NOT IN (SELECT url FROM discovery_rejections)) " +
      "ORDER BY next_retry_at ASC LIMIT ?2",
    nowIso,
    Math.max(1, Math.min(limit, 500)),
  );
  return rows.map((r) => ({ ...r, detail: parseDetail(r.detail) }));
}

/** Update an existing log row in place after a retry resolves: set outcome/detail/slug and clear
 *  next_retry_at (the row is now terminal — either successfully resolved or exhausted). */
export async function resolveDiscoveryRow(
  env: Env,
  id: string,
  entry: { outcome: string; detail?: Record<string, unknown>; slug?: string | null },
): Promise<void> {
  await db(env).run(
    "UPDATE discovery_log SET outcome = ?2, detail = ?3, slug = ?4, next_retry_at = NULL WHERE id = ?1",
    id,
    entry.outcome,
    entry.detail ? JSON.stringify(entry.detail) : null,
    entry.slug ?? null,
  );
}

/** Bump the retry clock for an existing row after a re-failure that hasn't exhausted the cap. */
export async function bumpDiscoveryRetry(
  env: Env,
  id: string,
  attempts: number,
  nextRetryAt: string,
): Promise<void> {
  await db(env).run(
    "UPDATE discovery_log SET attempts = ?2, next_retry_at = ?3 WHERE id = ?1",
    id,
    attempts,
    nextRetryAt,
  );
}

/** Remove one log row (the delete endpoint's second half — the rejection is already written). */
export async function deleteDiscoveryRow(env: Env, id: string): Promise<void> {
  await db(env).run("DELETE FROM discovery_log WHERE id = ?1", id);
}

/** Prune log rows older than `beforeIso` (the retention window). Returns rows deleted. */
export async function pruneDiscoveryLog(env: Env, beforeIso: string): Promise<number> {
  const r = await db(env).run("DELETE FROM discovery_log WHERE created_at < ?1", beforeIso);
  return r.changes;
}

/** Persist per-member attribution for an imported recipe (one batch). */
export async function recordDiscoveryMatches(
  env: Env,
  slug: string,
  attributions: Array<{ tenant: string; score: number }>,
  matchedAt: string,
): Promise<void> {
  if (attributions.length === 0) return;
  const d = db(env);
  await d.batch(
    attributions.map((a) =>
      d.prepare(
        "INSERT INTO discovery_matches (recipe, tenant, score, matched_at) VALUES (?1, ?2, ?3, ?4) " +
          "ON CONFLICT(recipe, tenant) DO UPDATE SET score = excluded.score, matched_at = excluded.matched_at",
        slug,
        a.tenant,
        a.score,
        matchedAt,
      ),
    ),
  );
}

/** A compact new-for-me row (already classified + embedded — immediately retrievable). */
export interface NewForMeRow {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
  discovered_at: string | null;
}

/** The caller's per-tenant planning watermark (profile.last_planned_at), or null. */
export async function readLastPlanned(env: Env, tenant: string): Promise<string | null> {
  const row = await db(env).first<{ last_planned_at: string | null }>(
    "SELECT last_planned_at FROM profile WHERE tenant = ?1",
    tenant,
  );
  return row?.last_planned_at ?? null;
}

/** Stamp the caller's planning watermark (called when meal-plan saves a plan). */
export async function stampLastPlanned(env: Env, tenant: string, day: string): Promise<void> {
  await db(env).run(
    "INSERT INTO profile (tenant, last_planned_at) VALUES (?1, ?2) " +
      "ON CONFLICT(tenant) DO UPDATE SET last_planned_at = excluded.last_planned_at",
    tenant,
    day,
  );
}

/**
 * The caller's NEW-FOR-ME recipes: imported after their watermark, attributed to them by the
 * sweep, with no overlay disposition and not yet cooked. The watermark is the LATER of the
 * caller's `last_planned_at` and a fixed-window floor (`floorDay`), so a never-planned member
 * gets at most the window, not the whole backlog. Most-recent-first, bounded.
 */
export async function readNewForMe(
  env: Env,
  tenant: string,
  floorDay: string,
  limit = 20,
): Promise<NewForMeRow[]> {
  const lastPlanned = await readLastPlanned(env, tenant);
  // String compare is valid for YYYY-MM-DD; the watermark caps the lookback at the floor.
  const watermark = lastPlanned && lastPlanned > floorDay ? lastPlanned : floorDay;
  return db(env).all<NewForMeRow>(
    "SELECT r.slug, r.title, d.description, r.protein, r.cuisine, r.time_total, r.discovered_at " +
      "FROM recipes r " +
      "JOIN discovery_matches m ON m.recipe = r.slug AND m.tenant = ?1 " +
      "LEFT JOIN recipe_derived d ON d.slug = r.slug " +
      "LEFT JOIN overlay o ON o.recipe = r.slug AND o.tenant = ?1 " +
      "WHERE r.discovered_at IS NOT NULL AND r.discovered_at > ?2 " +
      "AND o.recipe IS NULL " +
      "AND r.slug NOT IN (SELECT recipe FROM cooking_log WHERE tenant = ?1 AND recipe IS NOT NULL) " +
      "ORDER BY r.discovered_at DESC LIMIT ?3",
    tenant,
    watermark,
    Math.max(1, Math.min(limit, 100)),
  );
}
