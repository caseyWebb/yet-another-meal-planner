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
import type { Outcome } from "./discovery-sweep.js";
import type { AcquireReason } from "./recipe-acquire.js";

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
  /** True when the candidate arrived via POST /admin/api/ingest (a scraper push) — its `acquire`
   *  stage was satisfied from attached content, not a fetch. */
  pushed: boolean;
  /** For a pushed row, the batch `source` (provenance) shown in the admin Discovery view. */
  origin: string | null;
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
    pushed?: boolean;
    origin?: string | null;
  },
): Promise<void> {
  await db(env).run(
    "INSERT INTO discovery_log (id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at, pushed, origin) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
    entry.pushed ? 1 : 0,
    entry.origin ?? null,
  );
}

/** Urls that have SETTLED to a non-park outcome (anything but `error`/`failed`) — the dedup
 *  set for pushed candidates at arrival. A url whose only prior outcomes are transient/walled
 *  parks (`error`/`failed`) is NOT settled, so a later push supersedes those parks (the scraper
 *  now supplies content the Worker's own fetch could not reach). */
export async function loadSettledUrls(env: Env): Promise<Set<string>> {
  const rows = await db(env).all<{ url: string | null }>(
    "SELECT DISTINCT url FROM discovery_log WHERE url IS NOT NULL AND outcome NOT IN ('error', 'failed')",
  );
  const set = new Set<string>();
  for (const { url } of rows) if (url) set.add(url);
  return set;
}

/** Count PUSHED-candidate outcomes since `sinceIso`, bucketed for the admin ingest funnel's
 *  downstream (imported / no-match / duplicate / parked). Reads the small pushed subset and
 *  buckets in JS. */
export async function countPushedOutcomesSince(
  env: Env,
  sinceIso: string,
): Promise<{ imported: number; noMatch: number; duplicate: number; parked: number }> {
  const rows = await db(env).all<{ outcome: string }>(
    "SELECT outcome FROM discovery_log WHERE pushed = 1 AND created_at >= ?1",
    sinceIso,
  );
  const out = { imported: 0, noMatch: 0, duplicate: 0, parked: 0 };
  for (const { outcome } of rows) {
    if (outcome === "imported") out.imported++;
    else if (outcome === "no_match" || outcome === "dietary_gated") out.noMatch++;
    else if (outcome === "duplicate") out.duplicate++;
    else if (outcome === "error" || outcome === "failed") out.parked++;
  }
  return out;
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
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at, pushed, origin FROM discovery_log " +
      "ORDER BY created_at DESC LIMIT ?1",
    Math.max(1, Math.min(limit, 1000)),
  );
  return rows.map((r) => ({ ...r, pushed: !!r.pushed, detail: parseDetail(r.detail) }));
}

/** The parked/failed subset of the log (the agent-readable read_discovery_errors surface):
 *  content `error` parks AND infrastructure `failed` rows, so nothing dropped is hidden.
 *  `failed` rows are transient/in-retry until their attempt cap is exhausted; exhausted
 *  infrastructure failures resolve to terminal `error` so /health clears. */
export async function readDiscoveryErrors(env: Env, limit = 100): Promise<DiscoveryLogRow[]> {
  const rows = await db(env).all<DiscoveryLogRow & { detail: string | null }>(
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at, pushed, origin FROM discovery_log " +
      "WHERE outcome IN ('error', 'failed') ORDER BY created_at DESC LIMIT ?1",
    Math.max(1, Math.min(limit, 1000)),
  );
  return rows.map((r) => ({ ...r, pushed: !!r.pushed, detail: parseDetail(r.detail) }));
}

/** One log row by id (for the admin per-row retry / delete operations). Returns null if not found. */
export async function readDiscoveryRowById(env: Env, id: string): Promise<DiscoveryLogRow | null> {
  const row = await db(env).first<DiscoveryLogRow & { detail: string | null }>(
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at, pushed, origin FROM discovery_log WHERE id = ?1",
    id,
  );
  if (!row) return null;
  return { ...row, pushed: !!row.pushed, detail: parseDetail(row.detail) };
}

// ── Candidate-pipeline enrichment (admin-ui-redesign-discovery) ─────────────────────────────
// readDiscoveryCandidates / deriveHalt derive, from the EXISTING discovery_log row shape, what
// the flat log doesn't show: the furthest pipeline stage a candidate reached and the halt point
// (colored by outcome kind) — for the /admin/discovery candidate-pipeline view. No schema
// change, no new write path; this is a read-side interpretation of `outcome`/`detail` only.

/** The `discovery-sweep` pipeline's 7 stages, in their real execution order. */
export const STAGE_KEYS = ["triage", "acquire", "classify", "describe", "dedup", "match", "import"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

/** The outcome-kind coloring the progression track + filter pills key off. */
export type CandidateKind = "accepted" | "dup" | "reject" | "park" | "fail" | "defer";

const ACQUIRE_REASONS = new Set<AcquireReason>(["unreachable", "no_jsonld", "not_a_recipe", "incomplete"]);

/** Compile-time exhaustiveness — mirrors src/admin/lib/remote.ts's assertNever, without the
 *  layering of a core reader importing from the admin panel. */
function assertNeverOutcome(x: never): never {
  throw new Error(`Unhandled discovery outcome: ${JSON.stringify(x)}`);
}

/** Derive an `error`-outcome row's halt stage from its `detail.reason` shape (Decision 1): the
 *  acquisition-park taxonomy → acquire; an `"import: "`-prefixed reason → import; anything else
 *  (a classify-stage validation park, or a legacy/unshaped reason) → classify. */
function haltStageForError(detail: unknown): StageKey {
  const reason = detail && typeof detail === "object" ? (detail as Record<string, unknown>).reason : undefined;
  if (typeof reason === "string") {
    if (ACQUIRE_REASONS.has(reason as AcquireReason)) return "acquire";
    if (reason.startsWith("import: ")) return "import";
  }
  return "classify";
}

/** Derive a `no_match` row's halt stage from its `detail.stage` (Decision 1): a triage-stage
 *  reject halts at `triage`; a `confirm`/`match`/absent (legacy) stage halts at `match`. */
function haltStageForNoMatch(detail: unknown): StageKey {
  const stage = detail && typeof detail === "object" ? (detail as Record<string, unknown>).stage : undefined;
  return stage === "triage" ? "triage" : "match";
}

/**
 * Derive a row's furthest-stage/halt-point presentation from its stored `outcome` + `detail`
 * (Decision 1 of admin-ui-redesign-discovery's design.md) — a pure function, unit-testable
 * without D1. Switches EXHAUSTIVELY over the real `Outcome` union imported from
 * discovery-sweep.ts, so a future outcome addition is a compile error here, not a silent gap.
 *
 * `failed` rows are a documented approximation: `processCandidate`'s outer catch wraps the
 * whole pipeline and does not record which stage was active, so a `failed` row renders at
 * `acquire` — "at least this far," not an exact stage attribution.
 */
export function deriveHalt(row: DiscoveryLogRow): { haltStage: StageKey; kind: CandidateKind; retryable: boolean } {
  const retryable = row.next_retry_at !== null;
  const outcome = row.outcome as Outcome;
  switch (outcome) {
    case "imported":
      return { haltStage: "import", kind: "accepted", retryable };
    case "duplicate":
      return { haltStage: "dedup", kind: "dup", retryable };
    case "no_match":
      return { haltStage: haltStageForNoMatch(row.detail), kind: "reject", retryable };
    case "dietary_gated":
      return { haltStage: "match", kind: "reject", retryable };
    case "rejected_source":
      return { haltStage: "triage", kind: "reject", retryable };
    case "deferred":
      return { haltStage: "import", kind: "defer", retryable };
    case "error":
      return { haltStage: haltStageForError(row.detail), kind: "park", retryable };
    case "failed":
      // Approximation (design.md Risk: "failed-outcome halt stage is not stored") — the
      // catch-all handler doesn't tag the active stage; acquire is the labeled best guess.
      return { haltStage: "acquire", kind: "fail", retryable };
    default:
      return assertNeverOutcome(outcome);
  }
}

/** One member's cosine match score as persisted in a `discovery_log` row's `detail.match_scores`
 *  (the discovery-sweep spec's "match-stage skip or gate carries the computed member scores"). */
export interface MatchScore {
  tenant: string;
  score: number;
}

/** Extract the per-member match scores from a row's `detail.match_scores`, if present (only
 *  populated for a `no_match` row halted at `match`/`confirm`, or a `dietary_gated` row — a
 *  candidate halted earlier, e.g. at `triage`, or resolved to `imported`, never computed them). */
export function matchScoresFromDetail(detail: unknown): MatchScore[] | null {
  if (!detail || typeof detail !== "object") return null;
  const raw = (detail as Record<string, unknown>).match_scores;
  if (!Array.isArray(raw)) return null;
  const scores = raw
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
    .filter((s): s is Record<string, unknown> => s !== null && typeof s.tenant === "string" && typeof s.score === "number")
    .map((s) => ({ tenant: s.tenant as string, score: s.score as number }));
  return scores.length > 0 ? scores : null;
}

/** One enriched candidate row for the /admin/discovery pipeline view: the raw log row plus its
 *  derived furthest-stage/halt-point presentation and, when the row halted at the match stage,
 *  the per-member cosine scores computed there. */
export interface DiscoveryCandidate extends DiscoveryLogRow {
  haltStage: StageKey;
  kind: CandidateKind;
  retryable: boolean;
  /** Per-member match scores from `detail.match_scores`, or null when not applicable/absent
   *  (e.g. imported, duplicate, or halted before the match stage). */
  matchScores: MatchScore[] | null;
}

/** The candidate-pipeline view's read: readDiscoveryLog, enriched per-row with deriveHalt and
 *  the extracted match scores. Same bounded/degrade-on-storage-error contract as the other
 *  readers (no separate query). */
export async function readDiscoveryCandidates(env: Env, limit = 200): Promise<DiscoveryCandidate[]> {
  const rows = await readDiscoveryLog(env, limit);
  return rows.map((row) => ({ ...row, ...deriveHalt(row), matchScores: matchScoresFromDetail(row.detail) }));
}

/** Due retryable rows — outcome IN ('error','failed'), next_retry_at <= now, not rejected.
 *  Returns up to `limit` rows for the retry stream each sweep tick. */
export async function loadDueRetries(
  env: Env,
  nowIso: string,
  limit: number,
): Promise<DiscoveryLogRow[]> {
  const rows = await db(env).all<DiscoveryLogRow & { detail: string | null }>(
    "SELECT id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at, pushed, origin " +
      "FROM discovery_log " +
      "WHERE outcome IN ('error', 'failed') AND next_retry_at IS NOT NULL AND next_retry_at <= ?1 " +
      "AND (url IS NULL OR url NOT IN (SELECT url FROM discovery_rejections)) " +
      "ORDER BY next_retry_at ASC LIMIT ?2",
    nowIso,
    Math.max(1, Math.min(limit, 500)),
  );
  return rows.map((r) => ({ ...r, pushed: !!r.pushed, detail: parseDetail(r.detail) }));
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
