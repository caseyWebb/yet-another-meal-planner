// The background DISCOVERY SWEEP core (background-discovery-sweep) — the fourth scheduled
// capture job. It turns the in-chat, plan-time discovery pull into an autonomous pipeline:
// gather new candidates (feeds + the email inbox) → cheap triage → classify (env.AI) →
// dedup → taste-match → auto-import, recording a per-candidate outcome to the operator log.
//
// Determinism boundary (ADR 0001): this is the `capture` leg, relocated from Claude-in-chat
// to a small model on the cron. The matcher and dedup reuse the SAME cosine machinery the
// search ranker already uses (favoriteAffinity / cosineSimilarity) — the duplicate detector
// is just that cosine aimed at the corpus instead of at favorites.
//
// Logic is split from I/O (injected `DiscoveryDeps`) so the whole pipeline is unit-testable
// with in-memory fakes, exactly as flyer-warm.ts / recipe-embeddings.ts are. Unlike the
// flyer's KV cursor, the sweep needs no persisted plan: every processed candidate is
// recorded (imported → corpus, or a terminal outcome → the dedup log), so the D1 log IS the
// progress state and a re-run never reprocesses a handled candidate.

import { cosineSimilarity, embedText, embedTexts } from "./embedding.js";
import { favoriteAffinity } from "./semantic-search.js";
import type { Env } from "./env.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { directoryFromEnv } from "./tenant.js";
import { readFeeds, readDiscoveryInbox, readDiscoveryRejections } from "./corpus-db.js";
import { readIngestCandidates, deleteIngestCandidate } from "./ingest-db.js";
import { recipeSourceMap, loadRecipeEmbeddings } from "./recipe-index.js";
import { extractRecipeSources, canonicalizeUrl, buildNewRecipe } from "./discovery.js";
import { parseFeed } from "./feeds.js";
import { fetchWithBrowserHeaders, readTextCapped } from "./http.js";
import { acquireRecipeContent, type AcquireReason } from "./recipe-acquire.js";
import { classifyRecipe, DERIVED_FACET_FIELDS } from "./discovery-classify.js";
import { generateDescription, facetsFromFrontmatter } from "./description.js";
import { CLASSIFY_MODEL } from "./discovery-classify.js";
import { validateFile } from "./validate.js";
import { seedRecipeDescription, EMBED_INPUT_BATCH } from "./recipe-embeddings.js";
import { seedClassifiedFacets } from "./recipe-classify.js";
import { readOverlay, readProfile } from "./profile-db.js";
import { readTasteVectors, reconcileTasteVectors, buildTasteDeps } from "./taste-vector.js";
import {
  recordDiscoveryLog,
  loadEvaluatedUrls,
  loadDueRetries,
  resolveDiscoveryRow,
  bumpDiscoveryRetry,
  recordDiscoveryMatches,
  pruneDiscoveryLog,
  countDiscoveryFailures,
} from "./discovery-db.js";
import { notifyFailure, recordUsagePoint, writeJobHealth, writeJobRun } from "./health.js";

/** A new discovery candidate to evaluate (already deduped vs corpus/rejections/log by the deps). */
export interface SweepCandidate {
  /** Canonical source URL (the dedup + log key). */
  url: string;
  title: string;
  /** Blurb for the cheap pre-classification triage embed; may be null. */
  summary: string | null;
  /** Provenance for the log (feed name / sender address). */
  source: string;
  /** For retry candidates: the existing discovery_log row to resolve in place (not a fresh INSERT). */
  existingRowId?: string;
  /** For retry candidates: the current attempt count (used to compute backoff / terminalize). */
  attempts?: number;
  /** For a PUSHED candidate (arrived via POST /admin/api/ingest): its pre-parsed content, so
   *  `acquireContent` returns it instead of fetching (the walled fetch already happened on the
   *  scraper). Present ⇒ `pushed` is true. */
  content?: RecipeContent;
  /** True when this candidate arrived via a scraper push (recorded on its discovery_log row). */
  pushed?: boolean;
  /** For a pushed candidate, the batch `source` name (provenance shown in the admin views). */
  origin?: string | null;
}

/** One member's taste signal for the matcher (vectors resolved by the deps). */
export interface SweepMember {
  tenant: string;
  /** Embedding of the member's authored `profile.taste` text, or null (cold-start on favorites). */
  tasteVector: number[] | null;
  /** Vectors of the member's favorited recipes (taste direction; nearest-liked). */
  favoriteVectors: number[][];
  /** Vectors of the member's rejected recipes (repel: don't re-surface a near-dup of a reject). */
  rejectVectors: number[][];
  /** The member's HARD dietary restrictions, lowercased (a violating recipe can't match them). */
  dietary: string[];
}

/** The parsed recipe content the classifier reads and the body is assembled from. */
export interface RecipeContent {
  title: string;
  ingredients: string[];
  instructions: string[];
}

/** The result of acquiring a candidate's page: the parsed content, or the SPECIFIC reason it
 *  could not be acquired (the same taxonomy parse_recipe surfaces) so the park log can tell a
 *  walled/dead source from a feed entry that simply isn't a parseable recipe. */
export type AcquireOutcome =
  | { ok: true; content: RecipeContent }
  | { ok: false; reason: AcquireReason; status?: number };

/** Tunable thresholds + per-tick caps (calibrated by the spike's task 0.3; injected). */
export interface DiscoveryConfig {
  /** Taste cosine a member must clear for a candidate to (cosine-)match them. */
  tasteThreshold: number;
  /** Looser threshold for the cheap title+summary triage (the blurb vector is lower-fidelity). */
  triageThreshold: number;
  /** Near-duplicate cosine: at/above this vs the corpus (or this tick's imports) → skip. δ ≫ τ. */
  dedupThreshold: number;
  /** Max candidates CLASSIFIED per tick (the env.AI budget bound). */
  classifyMaxPerTick: number;
  /** Max external recipe-page FETCHES per tick (the scarce shared-subrequest bound — a parse
   *  failure spends one without ever reaching classify, so it is capped separately). */
  fetchMaxPerTick: number;
  /** Max candidates CONSIDERED per tick. Bounds the triage-embed + log-write cost so an
   *  unbounded intake backlog can't balloon one invocation; the excess defers to later ticks. */
  maxCandidatesPerTick: number;
  /** Max IMPORTS per tick (the corpus-bloat governor); excess is deferred + logged. */
  rateCap: number;
  /** Exponential backoff schedule for retryable parks: minutes to wait before each re-attempt.
   *  Index 0 = wait after the 1st park, index 1 = after the 2nd attempt fails, etc.
   *  When exhausted, the last value is reused. */
  retryBackoffMinutes: number[];
  /** Max retry attempts before a retryable row becomes terminal. */
  retryMaxAttempts: number;
  /** Max retryable-row fetches per tick — the retry sub-budget that prevents retries from
   *  starving fresh intake of the shared fetchMaxPerTick budget. */
  retryFetchMaxPerTick: number;
  /** Max FEED fetches per tick — the feed-poll's slice of the shared external-subrequest budget.
   *  Feeds are polled in a cursor-rotated bounded batch (`selectFeedBatch`) so the add-only feed
   *  set can grow without the per-tick feed fan-out exceeding the budget shared with the flyer
   *  warm in the same scheduled() tick. A budget guardrail, NOT a taste knob — like
   *  retryFetchMaxPerTick it is a constant, not part of the D1 override / admin calibration UI. */
  feedFetchMaxPerTick: number;
  /** Days to retain discovery_log rows (audit/dedup window). */
  logRetentionDays: number;
}

export const DEFAULT_CONFIG: DiscoveryConfig = {
  // Placeholders until task 0.3 calibrates them against the live corpus. fetchMaxPerTick
  // bounds the EXTERNAL recipe-page fetches — the scarce resource, since a parse failure
  // spends one without reaching classify — which share the flyer's 50-subrequest
  // per-invocation budget (both run in one scheduled() tick). classifyMaxPerTick bounds the
  // env.AI classify calls. Keep both conservative; fetchMaxPerTick ≥ classifyMaxPerTick since
  // some fetches park before classify.
  //
  // External-fetch budget (one scheduled() tick): flyer(~25) + recipe-page(fetchMaxPerTick) +
  // feed(feedFetchMaxPerTick) ≤ ~50. With 25 + 16 + 6 = 47 this stays under the cap; a future
  // bump to fetchMaxPerTick or the flyer batch must keep the sum ≤ 50 or it reopens the feed
  // fan-out exhaustion (#54). A dozen feeds drain in ceil(12/6)=2 ticks at feedFetchMaxPerTick=6.
  tasteThreshold: 0.55,
  triageThreshold: 0.45,
  dedupThreshold: 0.9,
  classifyMaxPerTick: 12,
  fetchMaxPerTick: 16,
  maxCandidatesPerTick: 150,
  rateCap: 10,
  // Retry backoff: 1h, 6h, 1d, 3d — placeholders, tunable like the existing thresholds.
  retryBackoffMinutes: [60, 360, 1440, 4320],
  retryMaxAttempts: 5,
  // Retry sub-budget: < fetchMaxPerTick so retries cannot consume the entire fetch budget.
  retryFetchMaxPerTick: 4,
  // Feed-poll sub-budget: a const (not a D1/UI knob), sized into the residual budget above.
  feedFetchMaxPerTick: 6,
  logRetentionDays: 60,
};

export type Outcome =
  | "imported"
  | "duplicate"
  | "no_match"
  | "rejected_source"
  | "dietary_gated"
  | "error"
  | "failed"
  | "deferred";

/** One per-candidate outcome row for the operator log (and the dedup/error views). */
export interface LogEntry {
  url: string;
  title: string;
  source: string;
  outcome: Outcome;
  slug?: string;
  detail?: Record<string, unknown>;
  /** True when the candidate arrived via a scraper push (badged in the admin Discovery view). */
  pushed?: boolean;
  /** For a pushed candidate, the batch `source` (provenance). */
  origin?: string | null;
}

/** Per-member attribution to persist on an import. */
export interface Attribution {
  tenant: string;
  score: number;
}

/** What one sweep tick did — the health summary + test assertions. */
export interface SweepResult {
  processed: number;
  imported: number;
  duplicate: number;
  noMatch: number;
  dietaryGated: number;
  /** CONTENT parks — a candidate the sweep can't use (unreachable/walled/invalid). Expected
   *  steady state; surfaced for an author to eyeball, but NOT a system-health failure. */
  parked: number;
  /** INFRASTRUCTURE failures — a candidate dropped by a transient env.AI/D1 error (a
   *  subrequest-limit hit, an AI outage). A real failure: it flips the job's health `ok`. */
  failed: number;
  deferred: number;
}

/** The I/O the sweep needs, injected so the pipeline is testable without feeds/AI/D1/R2. */
export interface DiscoveryDeps {
  /** New candidates this tick (deps poll feeds + read the inbox + dedup vs corpus/rejections/log). */
  loadCandidates(): Promise<SweepCandidate[]>;
  /** Due retryable rows (outcome error/failed, next_retry_at <= now, not rejected) as candidates. */
  loadRetries(nowIso: string, limit: number): Promise<SweepCandidate[]>;
  /** Every member's resolved taste signal. */
  loadMembers(): Promise<SweepMember[]>;
  /** Every corpus recipe's description vector (for L2 dedup), as [slug, vector] pairs. */
  loadCorpusVectors(): Promise<Array<{ slug: string; vector: number[] }>>;
  /** Embed one text (the description post-classify — one call per surviving candidate). */
  embed(text: string): Promise<number[]>;
  /** Embed MANY texts in ONE call — the batched triage primitive, so the whole candidate
   *  pool's title+summary embeds cost a single subrequest instead of one apiece. */
  embedMany(texts: string[]): Promise<number[][]>;
  /** Fetch + parse a candidate to structured content; null when unreachable/walled (→ parked). */
  acquireContent(candidate: SweepCandidate): Promise<AcquireOutcome>;
  /** Classify content → contract-valid frontmatter; throws (validation_failed) when it can't (→ park). */
  classify(content: RecipeContent, source: string): Promise<Record<string, unknown>>;
  /** Generate the description from the classified facets (the embed source + "why this dish"). */
  describe(frontmatter: Record<string, unknown>): Promise<string>;
  /** The small-LLM negation-aware confirm: which of these members genuinely fit? Returns the tenants. */
  confirmMatches(title: string, description: string, members: SweepMember[]): Promise<string[]>;
  /** Import: assemble body + frontmatter, validate, write to the corpus, return the slug. */
  importRecipe(frontmatter: Record<string, unknown>, content: RecipeContent, descVector: number[]): Promise<string>;
  /** Persist per-member attribution for an imported recipe. */
  recordMatches(slug: string, attributions: Attribution[]): Promise<void>;
  /** Append one outcome row to the discovery log (INSERT). Opts carry retry state for retryable parks. */
  recordLog(entry: LogEntry, opts?: { attempts?: number; nextRetryAt?: string | null }): Promise<void>;
  /** Update an existing row in place when a retry resolves (success or exhaustion terminalize). */
  resolveRow(id: string, entry: LogEntry): Promise<void>;
  /** Bump the retry clock on an existing row when a retry re-fails but hasn't hit the cap. */
  bumpRetry(id: string, attempts: number, nextRetryAt: string): Promise<void>;
  /** Delete a PUSHED candidate's inbox row once it reaches a terminal outcome (optional — only
   *  the real deps provide it; a transient `failed` keeps the row so the next tick retries from
   *  the stored content). */
  deletePushed?(url: string): Promise<void>;
}

// --- pure matcher / dedup helpers (the same cosine the search ranker uses) ---

/** Best taste cosine of a candidate to one member: max over their favorites and their taste vector. */
export function bestTasteCosine(vec: number[], member: SweepMember): number {
  const fav = favoriteAffinity(vec, member.favoriteVectors);
  const taste = member.tasteVector ? cosineSimilarity(vec, member.tasteVector) : 0;
  return Math.max(fav, taste);
}

/** True if the candidate is near ANY member at the (looser) triage threshold — the cheap gate. */
export function nearAnyMember(vec: number[], members: SweepMember[], threshold: number): boolean {
  return members.some((m) => bestTasteCosine(vec, m) >= threshold);
}

/** The corpus recipe a candidate duplicates (max cosine ≥ δ), or null. Also used intra-sweep. */
export function findDuplicate(
  vec: number[],
  corpus: Array<{ slug: string; vector: number[] }>,
  delta: number,
): string | null {
  let bestSlug: string | null = null;
  let best = delta;
  for (const { slug, vector } of corpus) {
    const c = cosineSimilarity(vec, vector);
    if (c >= best) {
      best = c;
      bestSlug = slug;
    }
  }
  return bestSlug;
}

/** Does the candidate satisfy every one of a member's hard dietary restrictions? */
export function dietaryOk(candidateDietary: string[], restrictions: string[]): boolean {
  if (restrictions.length === 0) return true;
  const have = new Set(candidateDietary.map((d) => d.toLowerCase()));
  return restrictions.every((r) => have.has(r.toLowerCase()));
}

/** Cosine-match a candidate against members: clears τ, not repelled by a reject, passes diet.
 *  `scores` carries EVERY member's computed cosine (not only those that cleared the threshold),
 *  so a halted candidate's log entry can show how close each member came, not only pass/fail
 *  (the `discovery-sweep` spec's "match-stage skip or gate carries the computed member scores"). */
export function matchMembers(
  vec: number[],
  candidateDietary: string[],
  members: SweepMember[],
  config: DiscoveryConfig,
): { matches: Attribution[]; gatedByDiet: boolean; scores: Attribution[] } {
  const matches: Attribution[] = [];
  const scores: Attribution[] = [];
  let gatedByDiet = false;
  for (const m of members) {
    const score = bestTasteCosine(vec, m);
    const rounded = Math.round(score * 1e4) / 1e4;
    scores.push({ tenant: m.tenant, score: rounded });
    if (score < config.tasteThreshold) continue;
    // Repel: a near-duplicate of something this member rejected is not for them.
    if (favoriteAffinity(vec, m.rejectVectors) >= config.dedupThreshold) continue;
    if (!dietaryOk(candidateDietary, m.dietary)) {
      gatedByDiet = true;
      continue;
    }
    matches.push({ tenant: m.tenant, score: rounded });
  }
  return { matches, gatedByDiet: gatedByDiet && matches.length === 0, scores };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The cheap-triage embed text for a candidate: its title joined with its blurb (if any). */
export function triageText(c: SweepCandidate): string {
  return [c.title, c.summary ?? ""].join(" — ").trim();
}

/**
 * Run one discovery sweep tick: process the gathered candidates through triage → classify →
 * dedup → match → confirm → import, bounded by the classify cap and the import rate cap, and
 * record a log entry for every terminal outcome. Also processes the due-retry stream (parked
 * rows whose next_retry_at has passed) under a dedicated sub-budget so retries can't starve
 * fresh intake. Pure orchestration over injected deps; all writes are idempotent (the recorded
 * outcome keeps a candidate from reprocessing), so a thrown/retried tick is safe.
 */
export async function runDiscoverySweep(
  deps: DiscoveryDeps,
  config: DiscoveryConfig = DEFAULT_CONFIG,
): Promise<SweepResult> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const [candidates, members, corpus] = await Promise.all([
    deps.loadCandidates(),
    deps.loadMembers(),
    deps.loadCorpusVectors(),
  ]);
  const res: SweepResult = {
    processed: 0,
    imported: 0,
    duplicate: 0,
    noMatch: 0,
    dietaryGated: 0,
    parked: 0,
    failed: 0,
    deferred: 0,
  };
  const importedVectors: Array<{ slug: string; vector: number[] }> = [];
  let classified = 0;
  let fetched = 0;

  // Clamp the per-tick pool so an unbounded intake backlog (many feeds, an un-pruned inbox)
  // can't balloon one invocation's subrequest/CPU cost — each candidate costs a triage-embed
  // slot and a log write. The excess defers to later ticks (the frequent cron drains it),
  // exactly like the rate/fetch caps below.
  const pool = candidates.slice(0, config.maxCandidatesPerTick);
  res.deferred += candidates.length - pool.length;

  // Triage embeds, batched in env.AI-input-sized CHUNKS (EMBED_INPUT_BATCH — the same bge input
  // ceiling the recipe-embedding reconcile chunks on), so the whole pool costs ceil(N/BATCH)
  // calls — not one per candidate, and not one oversized call that would exceed the model's
  // input limit and wedge the tick. The match itself stays the pure `nearAnyMember` cosine
  // check below. A chunk failure (a transient env.AI outage) propagates and fails the tick: no
  // candidate is logged, so the whole pool re-gathers next run — far safer than embedding each
  // one (re-spending the budget we are saving) or mislabeling them all `no_match`.
  const triageVecs: number[][] = [];
  for (let i = 0; i < pool.length; i += EMBED_INPUT_BATCH) {
    triageVecs.push(...(await deps.embedMany(pool.slice(i, i + EMBED_INPUT_BATCH).map(triageText))));
  }

  // --- Fresh intake ---
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    // Governor / budget: once the rate cap or the classify cap is hit, defer the rest (no
    // wasted classify) — they re-gather next tick (still un-evaluated, so no dedup needed).
    if (res.imported >= config.rateCap || classified >= config.classifyMaxPerTick) {
      res.deferred++;
      continue;
    }
    // Fetch budget guard: a triage survivor we cannot afford to fetch this tick is deferred.
    // Triage non-matches (above) are still cheaply finalized even when the fetch budget is full.
    // A PUSHED candidate arrives with its content, so it spends NO fetch — the fetch cap does
    // not gate it (only the classify + rate caps above do).
    if (!candidate.pushed && fetched >= config.fetchMaxPerTick) {
      res.deferred++;
      continue;
    }

    const r = await processCandidate(deps, config, candidate, {
      triageVec: triageVecs[i] ?? [],
      members,
      corpus,
      importedVectors,
      nowMs,
    });
    if (r.didFetch) fetched++;
    if (r.didClassify) classified++;

    // A pushed candidate's inbox row is the retry state: delete it on a TERMINAL outcome
    // (imported / rejected / contract-park); keep it on a transient `failed` so the next tick
    // retries from the stored content (no re-fetch — its content persists in ingest_candidates).
    if (candidate.pushed && r.outcome !== "failed") {
      await deps.deletePushed?.(candidate.url);
    }

    if (r.outcome === "no_match") res.noMatch++;
    else if (r.outcome === "duplicate") res.duplicate++;
    else if (r.outcome === "dietary_gated") res.dietaryGated++;
    else if (r.outcome === "imported") res.imported++;
    else if (r.outcome === "error") res.parked++;
    else if (r.outcome === "failed") res.failed++;
    res.processed++;
  }

  // --- Retry stream ---
  // Due retryable rows, processed AFTER fresh intake so retries don't starve fresh fetches.
  // Bounded by both retryFetchMaxPerTick (the retry sub-budget) and the shared fetchMaxPerTick.
  const retries = await deps.loadRetries(nowIso, config.retryFetchMaxPerTick);
  let retryFetched = 0;
  for (const candidate of retries) {
    if (retryFetched >= config.retryFetchMaxPerTick || fetched >= config.fetchMaxPerTick) break;
    if (res.imported >= config.rateCap || classified >= config.classifyMaxPerTick) break;

    const r = await processCandidate(deps, config, candidate, {
      triageVec: null, // retry candidates skip triage — already evaluated before
      members,
      corpus,
      importedVectors,
      nowMs,
    });
    // All retries attempt a fetch (the pipeline starts at acquire); count against shared budget.
    fetched++;
    retryFetched++;
    if (r.didClassify) classified++;

    if (r.outcome === "no_match") res.noMatch++;
    else if (r.outcome === "duplicate") res.duplicate++;
    else if (r.outcome === "dietary_gated") res.dietaryGated++;
    else if (r.outcome === "imported") res.imported++;
    else if (r.outcome === "error") res.parked++;
    else if (r.outcome === "failed") res.failed++;
    res.processed++;
  }

  return res;
}

function logBase(c: SweepCandidate): Pick<LogEntry, "url" | "title" | "source" | "pushed" | "origin"> {
  return { url: c.url, title: c.title, source: c.source, pushed: c.pushed, origin: c.origin ?? null };
}

/** ISO timestamp for the next retry attempt, based on how many have been made so far. */
function nextRetryAt(config: DiscoveryConfig, nowMs: number, currentAttempts: number): string {
  const idx = Math.min(currentAttempts - 1, config.retryBackoffMinutes.length - 1);
  const delayMs = (config.retryBackoffMinutes[idx] ?? 60) * 60 * 1000;
  return new Date(nowMs + delayMs).toISOString();
}

/** Whether this acquisition reason is retryable (transient) vs structural (terminal). */
function isRetryableReason(reason: string): boolean {
  return reason === "unreachable";
}

/**
 * The per-candidate pipeline: acquire → classify → dedup → match → confirm → import.
 * Shared by the cron fresh-intake loop, the cron retry stream, and the admin manual-retry
 * endpoint — so the retry and manual-retry paths get identical pipeline behavior.
 *
 * `candidate.existingRowId` selects resolve-in-place vs INSERT. When set, on success
 * `deps.resolveRow` is called; on re-failure `deps.bumpRetry` or `deps.resolveRow`
 * (terminalize) is called. `bypassCap` forces resolve-in-place even on a repeated failure
 * (the manual-retry operator override — always one pass, never a bump).
 *
 * Returns the outcome and whether a fetch/classify was performed (for caller counter tracking).
 */
export async function processCandidate(
  deps: DiscoveryDeps,
  config: DiscoveryConfig,
  candidate: SweepCandidate,
  ctx: {
    /** Precomputed triage vector; null = skip triage (retry + manual-retry paths). */
    triageVec: number[] | null;
    members: SweepMember[];
    corpus: Array<{ slug: string; vector: number[] }>;
    importedVectors: Array<{ slug: string; vector: number[] }>;
    nowMs: number;
  },
  opts: { bypassCap?: boolean } = {},
): Promise<{ outcome: Outcome; didFetch: boolean; didClassify: boolean }> {
  const { triageVec, members, corpus, importedVectors, nowMs } = ctx;
  const existingRowId = candidate.existingRowId;
  const currentAttempts = candidate.attempts ?? 0;

  // Helpers that pick INSERT vs resolve-in-place depending on whether this is a retry.
  const logSuccess = async (entry: LogEntry) => {
    if (existingRowId) {
      await deps.resolveRow(existingRowId, entry);
    } else {
      await deps.recordLog(entry);
    }
  };

  const logPark = async (entry: LogEntry, retryable: boolean) => {
    if (existingRowId) {
      // Retry path: bump or terminalize.
      const newAttempts = currentAttempts + 1;
      const exhausted = opts.bypassCap || newAttempts >= config.retryMaxAttempts;
      if (exhausted) {
        // Terminalize: resolve to a terminal error park (clears next_retry_at).
        await deps.resolveRow(existingRowId, { ...entry, outcome: "error" });
      } else {
        await deps.bumpRetry(existingRowId, newAttempts, nextRetryAt(config, nowMs, newAttempts));
      }
    } else if (retryable) {
      // Fresh park with a retryable reason: schedule the first retry.
      await deps.recordLog(entry, { attempts: 1, nextRetryAt: nextRetryAt(config, nowMs, 1) });
    } else {
      await deps.recordLog(entry);
    }
  };

  try {
    // [1] cheap triage — skip for retry candidates (already evaluated before).
    if (triageVec !== null) {
      if (!nearAnyMember(triageVec, members, config.triageThreshold)) {
        await logSuccess({ ...logBase(candidate), outcome: "no_match", detail: { stage: "triage" } });
        return { outcome: "no_match", didFetch: false, didClassify: false };
      }
    }

    // [2] acquire content — park with the SPECIFIC reason so the operator can tell failure types.
    const acquired = await deps.acquireContent(candidate);
    if (!acquired.ok) {
      const detail: Record<string, unknown> = { reason: acquired.reason };
      if (acquired.status !== undefined) detail.status = acquired.status;
      await logPark({ ...logBase(candidate), outcome: "error", detail }, isRetryableReason(acquired.reason));
      return { outcome: "error", didFetch: true, didClassify: false };
    }
    const content = acquired.content;

    // [3] classify — the expensive leg; a persistently-invalid classification parks (terminal).
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = await deps.classify(content, candidate.url);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await logSuccess({ ...logBase(candidate), outcome: "error", detail: { reason: message } });
      return { outcome: "error", didFetch: true, didClassify: true };
    }

    // [4] describe + embed the description — the authoritative vector for dedup + match.
    const description = await deps.describe(frontmatter);
    const descVec = await deps.embed(description);

    // [5] dedup — same dish already in the corpus (L2) or imported earlier this tick (L3).
    const dupSlug =
      findDuplicate(descVec, corpus, config.dedupThreshold) ??
      findDuplicate(descVec, importedVectors, config.dedupThreshold);
    if (dupSlug) {
      await logSuccess({ ...logBase(candidate), outcome: "duplicate", detail: { duplicate_of: dupSlug } });
      return { outcome: "duplicate", didFetch: true, didClassify: true };
    }

    // [6] match (cosine + repel + dietary gate), then the negation-aware LLM confirm.
    const { matches, gatedByDiet, scores } = matchMembers(
      descVec,
      asStringArray(frontmatter.dietary),
      members,
      config,
    );
    if (matches.length === 0) {
      const outcome: Outcome = gatedByDiet ? "dietary_gated" : "no_match";
      // Carry the per-member cosine scores computed at this stage so a halted candidate is
      // auditable — how close each member came, not only pass/fail (discovery-sweep spec).
      await logSuccess({ ...logBase(candidate), outcome, detail: { stage: "match", match_scores: scores } });
      return { outcome, didFetch: true, didClassify: true };
    }
    const matchMembersList = members.filter((m) => matches.some((a) => a.tenant === m.tenant));
    const confirmed = new Set(await deps.confirmMatches(candidate.title, description, matchMembersList));
    const attributions = matches.filter((a) => confirmed.has(a.tenant));
    if (attributions.length === 0) {
      await logSuccess({
        ...logBase(candidate),
        outcome: "no_match",
        detail: { stage: "confirm", match_scores: scores },
      });
      return { outcome: "no_match", didFetch: true, didClassify: true };
    }

    // [7] import — assemble + validate + write; attribute; log; seed the L3 vector.
    let slug: string;
    try {
      slug = await deps.importRecipe(frontmatter, content, descVec);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await logSuccess({ ...logBase(candidate), outcome: "error", detail: { reason: `import: ${message}` } });
      return { outcome: "error", didFetch: true, didClassify: true };
    }
    await deps.recordMatches(slug, attributions);
    await logSuccess({ ...logBase(candidate), outcome: "imported", slug, detail: { attribution: attributions } });
    importedVectors.push({ slug, vector: descVec });
    return { outcome: "imported", didFetch: true, didClassify: true };
  } catch (e) {
    // An unexpected transient AI/D1 failure — record as `failed` (infra failure, not content error).
    const message = e instanceof Error ? e.message : String(e);
    // A PUSHED candidate's persisted inbox row IS its retry state: don't write a `failed`
    // discovery_log row (no spam, no retry-stream entry). The caller keeps the inbox row and
    // the next tick retries from the stored content.
    if (candidate.pushed) {
      return { outcome: "failed", didFetch: false, didClassify: false };
    }
    try {
      await logPark(
        { ...logBase(candidate), outcome: "failed", detail: { reason: `unexpected: ${message}` } },
        true, // infra failures are always retryable
      );
    } catch {
      /* logging itself failed — skip; next tick re-evaluates this candidate */
    }
    return { outcome: "failed", didFetch: false, didClassify: false };
  }
}

// --- real-client wiring (buildDiscoveryDeps), mirroring flyer-warm's buildWarmDeps -------

const MAX_PER_FEED = 8;
/** Max links promoted from a single email body — a newsletter can carry a long junk tail. */
const MAX_PER_EMAIL = 8;
const URL_RE = /https?:\/\/[^\s)"'<>]+/g;

/** KV key (KROGER_KV — the namespace the flyer cursor already uses) for the feed-poll rotation
 *  cursor: an integer offset into the url-sorted feed set. Ephemeral/best-effort — losing it
 *  restarts the rotation, which dedup makes harmless. */
const FEED_CURSOR_KEY = "discovery:feed-cursor";

/** Hosts that are never a recipe page — social/sharing and chat. Matched on the host with a
 *  leading `www.` stripped. Conservative on purpose: over-filtering hides recipes, and the
 *  per-tick fetch budget already backstops whatever junk slips through. */
const NON_RECIPE_HOSTS = new Set([
  "facebook.com", "twitter.com", "x.com", "instagram.com", "pinterest.com",
  "youtube.com", "youtu.be", "tiktok.com", "linkedin.com", "reddit.com", "threads.net",
  "whatsapp.com", "t.me",
]);
/** Path shapes that are transactional/navigational, never a recipe (unsubscribe, account, …). */
const NON_RECIPE_PATH_RE =
  /(?:^|\/)(?:unsubscribe|subscribe|preferences|manage|account|login|signup|sign-up|privacy|terms|contact|about)(?:\/|$)/i;

/** True for a link that is obviously NOT a recipe page (a social share, an unsubscribe link),
 *  so an email body's junk tail never becomes a fetched-then-parked candidate. Unparseable →
 *  true (drop). High-precision: it rejects only clear non-recipes; a click-tracking wrapper
 *  that redirects to a recipe is left for the fetch (bounded by fetchMaxPerTick) to resolve. */
export function isLikelyNonRecipeLink(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (NON_RECIPE_HOSTS.has(host)) return true;
  return NON_RECIPE_PATH_RE.test(u.pathname);
}

/** Deterministically select up to `k` items starting at `cursor` (wrapping), returning the batch
 *  and the next cursor. Pure — the feed I/O + KV cursor read/write stay in the deps (mirrors
 *  flyer-warm's testable `buildPlan` over its glue). This is what bounds the feed fan-out (#54):
 *  feeds are polled in a per-tick bounded batch advanced by a persisted cursor, so the add-only
 *  feed set can grow without the feed fetches exceeding the shared subrequest budget; feeds not in
 *  this tick's batch are polled on a later tick. Callers pass feeds in a stable order (sorted by
 *  url) so the rotation is reproducible and every feed is reached. A lost/garbage cursor is
 *  normalized, so losing the persisted cursor merely restarts the rotation (dedup makes a re-poll
 *  a no-op). */
export function selectFeedBatch<T>(feeds: T[], cursor: number, k: number): { batch: T[]; nextCursor: number } {
  const n = feeds.length;
  if (n === 0 || k <= 0) return { batch: [], nextCursor: 0 };
  const c = Number.isFinite(cursor) ? Math.trunc(cursor) : 0; // lost/garbage cursor → start at 0
  const start = ((c % n) + n) % n; // normalize negative / out-of-range
  const take = Math.min(k, n);
  const batch: T[] = [];
  for (let i = 0; i < take; i++) batch.push(feeds[(start + i) % n]);
  return { batch, nextCursor: (start + take) % n };
}

function renderContent(c: RecipeContent): string {
  return (
    `Ingredients:\n${c.ingredients.map((i) => `- ${i}`).join("\n")}\n\n` +
    `Instructions:\n${c.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
  );
}

function assembleBody(c: RecipeContent): string {
  return (
    `## Ingredients\n\n${c.ingredients.map((i) => `- ${i}`).join("\n")}\n\n` +
    `## Instructions\n\n${c.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`
  );
}

/** Conservatively derive a member's HARD dietary restrictions from their preferences. Returns
 *  [] (no gate) when the shape is unclear — over-gating wrongly hides recipes, and opt-out
 *  (toggle_reject) is the backstop. */
function deriveDietaryRestrictions(preferences: Record<string, unknown> | null): string[] {
  const d = preferences?.dietary as unknown;
  if (Array.isArray(d)) return d.filter((x): x is string => typeof x === "string");
  if (d && typeof d === "object") {
    const r = (d as Record<string, unknown>).restrictions ?? (d as Record<string, unknown>).avoid;
    if (Array.isArray(r)) return r.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function parseJsonObject(response: unknown): Record<string, unknown> | null {
  if (response && typeof response === "object") return response as Record<string, unknown>;
  if (typeof response !== "string") return null;
  const t = response.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try {
    const v = JSON.parse(t.slice(s, e + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The negation-aware confirm: ask the model which members genuinely fit, respecting their
 *  stated dislikes. Members with no taste text can't be negation-checked → kept (cosine
 *  already gated them). Fails OPEN to the cosine matches on an AI error (a missed negation is
 *  a toggle_reject away; the pipeline stays resilient). */
async function confirmMatchesAI(
  env: Env,
  title: string,
  description: string,
  members: SweepMember[],
  tasteTexts: Map<string, string>,
): Promise<string[]> {
  const withText = members.filter((m) => (tasteTexts.get(m.tenant) ?? "").trim());
  const noText = members.filter((m) => !(tasteTexts.get(m.tenant) ?? "").trim()).map((m) => m.tenant);
  if (withText.length === 0) return members.map((m) => m.tenant);
  const roster = withText.map((m) => `- ${m.tenant}: ${tasteTexts.get(m.tenant)}`).join("\n");
  const prompt =
    `Recipe: "${title}" — ${description}\n\n` +
    "For each member below, decide if this recipe is a genuine fit for their taste, RESPECTING any dislikes or avoidances they state (a stated dislike of a defining ingredient means NOT a fit). " +
    'Output ONLY JSON: {"fits": ["<member>", ...]} listing the members it fits.\n\nMembers:\n' +
    roster;
  try {
    const res = (await env.AI.run(CLASSIFY_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0,
    })) as { response?: unknown };
    const parsed = parseJsonObject(res?.response);
    const fits = Array.isArray(parsed?.fits)
      ? (parsed!.fits as unknown[]).filter((x): x is string => typeof x === "string")
      : withText.map((m) => m.tenant);
    return [...new Set([...fits, ...noText])];
  } catch {
    return members.map((m) => m.tenant);
  }
}

/**
 * Wire the real feed/HTTP/AI/D1/R2 clients for the scheduled handler. Integration glue
 * (not unit-tested — the testable core is `runDiscoverySweep`), mirroring flyer-warm's
 * `buildWarmDeps` / recipe-embeddings' `buildEmbedDeps`. Runs without an OAuth session: it
 * enumerates the tenant directory and reads shared + per-tenant D1 directly.
 */
export function buildDiscoveryDeps(env: Env, now: () => number = () => Date.now()): DiscoveryDeps {
  const store = createR2CorpusStore(env.CORPUS);
  const directory = directoryFromEnv(env);
  const tasteTexts = new Map<string, string>(); // tenant → taste text, populated by loadMembers
  const today = () => new Date(now()).toISOString().slice(0, 10);

  return {
    async loadCandidates() {
      const feeds = await readFeeds(env);
      const [sourceMap, rejected, evaluated, inbox] = await Promise.all([
        recipeSourceMap(env),
        readDiscoveryRejections(env),
        loadEvaluatedUrls(env),
        readDiscoveryInbox(env),
      ]);
      const seen = extractRecipeSources(sourceMap);
      for (const u of rejected) seen.add(u);
      for (const u of evaluated) seen.add(canonicalizeUrl(u));

      const out: SweepCandidate[] = [];
      const local = new Set<string>();
      const push = (rawUrl: string, title: string, summary: string | null, source: string): boolean => {
        const url = canonicalizeUrl(rawUrl);
        if (!url || seen.has(url) || local.has(url)) return false;
        local.add(url);
        out.push({ url, title, summary, source });
        return true;
      };

      // RSS/Atom feeds (title + summary give the triage a real signal). Polled in a per-tick
      // bounded batch advanced by a persisted rotation cursor (selectFeedBatch + KROGER_KV), so the
      // add-only feed set can grow without the feed fan-out exceeding the shared external-subrequest
      // budget (#54). feedFetchMaxPerTick is a const guardrail (not operator-tunable), so it is read
      // from DEFAULT_CONFIG directly rather than threaded through the deps.
      const sortedFeeds = feeds.filter((f) => f.url).sort((a, b) => a.url.localeCompare(b.url));
      const cursor = Number.parseInt((await env.KROGER_KV.get(FEED_CURSOR_KEY)) ?? "", 10);
      const { batch, nextCursor } = selectFeedBatch(
        sortedFeeds,
        Number.isNaN(cursor) ? 0 : cursor,
        DEFAULT_CONFIG.feedFetchMaxPerTick,
      );
      await Promise.all(
        batch.map(async (f) => {
          try {
            const res = await fetchWithBrowserHeaders(f.url);
            if (!res.ok) return;
            for (const item of parseFeed(await readTextCapped(res)).slice(0, MAX_PER_FEED)) {
              push(item.link, item.title, item.summary ?? null, f.name ?? f.url);
            }
          } catch {
            // a dead/blocked/over-cap feed is skipped this sweep (re-polled on a later rotation)
          }
        }),
      );
      // Advance the rotation cursor after the batch is dispatched. Best-effort: a lost write just
      // re-polls the same feeds next tick, which dedup makes a no-op.
      await env.KROGER_KV.put(FEED_CURSOR_KEY, String(nextCursor));

      // Email inbox — promote the body's recipe links (the page fetch yields the real title).
      // Drop obvious non-recipe links and cap per email so one newsletter's junk tail cannot
      // flood the pool: every promoted link costs a triage embed and, if it survives, a fetch.
      for (const email of inbox) {
        const body = typeof email.body === "string" ? email.body : "";
        const subject = typeof email.subject === "string" ? email.subject : "newsletter";
        const sender = String(email.from ?? "email");
        let promoted = 0;
        for (const m of body.match(URL_RE) ?? []) {
          if (promoted >= MAX_PER_EMAIL) break;
          if (isLikelyNonRecipeLink(m)) continue;
          if (push(m, subject, null, sender)) promoted++;
        }
      }

      // Pushed inbox (POST /admin/api/ingest): pre-parsed candidates. They BYPASS the feed
      // `seen` set — a push SUPERSEDES a prior walled `unreachable`/`no_jsonld` park for the
      // same url (the scraper now supplies content the Worker's own fetch could not reach) —
      // but are still skipped when the url is already a corpus recipe (a race between arrival
      // and this tick), and that stale inbox row is cleaned up. Their content rides along so
      // acquireContent returns it without a fetch.
      const corpusUrls = extractRecipeSources(sourceMap);
      for (const c of await readIngestCandidates(env)) {
        if (local.has(c.url)) continue;
        if (corpusUrls.has(c.url)) {
          await deleteIngestCandidate(env, c.url).catch(() => {});
          continue;
        }
        local.add(c.url);
        out.push({
          url: c.url,
          title: c.title,
          summary: c.content.summary ?? null,
          source: c.origin,
          pushed: true,
          origin: c.origin,
          content: { title: c.title, ingredients: c.content.ingredients, instructions: c.content.instructions },
        });
      }
      return out;
    },

    async loadMembers() {
      const tenants = await directory.list();
      const [corpusEmb, tasteVecs] = await Promise.all([loadRecipeEmbeddings(env), readTasteVectors(env)]);
      const members: SweepMember[] = [];
      for (const tenant of tenants) {
        const [overlay, profile] = await Promise.all([readOverlay(env, tenant), readProfile(env, tenant)]);
        const favoriteVectors: number[][] = [];
        const rejectVectors: number[][] = [];
        for (const [slug, o] of Object.entries(overlay)) {
          const v = corpusEmb.get(slug);
          if (!v) continue;
          if (o.favorite) favoriteVectors.push(v);
          if (o.reject) rejectVectors.push(v);
        }
        if (typeof profile.taste === "string" && profile.taste.trim()) tasteTexts.set(tenant, profile.taste.trim());
        members.push({
          tenant,
          tasteVector: tasteVecs.get(tenant) ?? null,
          favoriteVectors,
          rejectVectors,
          dietary: deriveDietaryRestrictions(profile.preferences),
        });
      }
      return members;
    },

    async loadCorpusVectors() {
      const emb = await loadRecipeEmbeddings(env);
      return [...emb.entries()].map(([slug, vector]) => ({ slug, vector }));
    },

    embed: (text) => embedText(env, text),

    embedMany: (texts) => embedTexts(env, texts),

    async acquireContent(candidate) {
      // A pushed candidate arrives with its pre-parsed content — the walled fetch already
      // happened on the scraper, so acquire is a no-op return (no external subrequest).
      if (candidate.content) return { ok: true, content: candidate.content };
      const result = await acquireRecipeContent(candidate.url);
      if (!result.ok) return result;
      return {
        ok: true,
        content: {
          title: result.recipe.title || candidate.title,
          ingredients: result.recipe.ingredients,
          instructions: result.recipe.instructions,
        },
      };
    },

    async classify(content, source) {
      const { frontmatter } = await classifyRecipe(env, { title: content.title, content: renderContent(content) }, source);
      return frontmatter;
    },

    describe: (frontmatter) => generateDescription(env, facetsFromFrontmatter(frontmatter)),

    confirmMatches: (title, description, members) => confirmMatchesAI(env, title, description, members, tasteTexts),

    async importRecipe(frontmatter, content) {
      const body = assembleBody(content);
      // Read the description facets from the FULL classified output, before stripping it from the file.
      const descFacets = facetsFromFrontmatter(frontmatter);
      // The descriptive facets are DERIVED (recipe-facet-derivation) — do NOT freeze the classifier's
      // output as authored frontmatter (that would make it a permanent override the whole-corpus
      // classify pass can't update, re-freezing the corpus). Strip them and seed recipe_facets from
      // the classification instead, mirroring create_recipe. The authored file keeps only the gates +
      // identity the classifier produced (dietary/requires_equipment/time_total/title/source/pairs_with).
      const fm: Record<string, unknown> = { ...frontmatter, discovered_at: today(), discovery_source: "discovery-sweep" };
      for (const k of DERIVED_FACET_FIELDS) delete fm[k];
      const { slug, file } = await buildNewRecipe(store, env, fm, body);
      validateFile(file.path, file.content);
      await store.put(file.path, file.content);
      // Seed the description + the derived facets so the recipe reads well + is faceted before the
      // reconcile (embeddings left to the reconcile, as create_recipe does). Both best-effort.
      try {
        await seedRecipeDescription(env, slug, descFacets);
      } catch (e) {
        console.error(`[discovery-sweep] description seed failed for ${slug}:`, e);
      }
      try {
        await seedClassifiedFacets(env, slug, frontmatter, body);
      } catch (e) {
        console.error(`[discovery-sweep] facet seed failed for ${slug}:`, e);
      }
      return slug;
    },

    async recordMatches(slug, attributions) {
      await recordDiscoveryMatches(env, slug, attributions, today());
    },

    async deletePushed(url) {
      await deleteIngestCandidate(env, url);
    },

    async loadRetries(nowIso, limit) {
      const rows = await loadDueRetries(env, nowIso, limit);
      return rows.map((r) => ({
        url: r.url ?? "",
        title: r.title ?? "",
        summary: null,
        source: r.source ?? "",
        existingRowId: r.id,
        attempts: r.attempts,
      }));
    },

    async recordLog(entry, opts) {
      await recordDiscoveryLog(env, {
        ...entry,
        createdAt: new Date(now()).toISOString(),
        attempts: opts?.attempts,
        nextRetryAt: opts?.nextRetryAt,
      });
    },

    async resolveRow(id, entry) {
      await resolveDiscoveryRow(env, id, entry);
    },

    async bumpRetry(id, attempts, nextRetryAt) {
      await bumpDiscoveryRetry(env, id, attempts, nextRetryAt);
    },
  };
}

/** Log rows older than this are pruned each run (the audit/dedup retention window). */
export const LOG_RETENTION_DAYS = 60;

/**
 * One scheduled run of the discovery sweep: refresh the per-member taste vectors (so the
 * matcher has current taste), run the sweep, prune old log rows, record
 * the `discovery-sweep` job_health row — a counts summary with `ok: false` while any standing
 * INFRASTRUCTURE failure (`outcome = 'failed'`) sits unresolved, so `/health` shows the
 * degradation even on a later idle tick (a content park does NOT degrade it). On a HARD
 * (thrown) tick it records `ok: false` and **rethrows** so the platform's native cron status
 * reflects it too — the same shape as runWarmJob / runEmbedJob / runProjectionJob. Runs AFTER
 * the index projection + recipe-derived reconcile in the tick, so dedup/match see a fresh
 * corpus + fresh embeddings.
 */
export async function runDiscoverySweepJob(
  env: Env,
  deps: DiscoveryDeps,
  config: DiscoveryConfig = DEFAULT_CONFIG,
  now: () => number = () => Date.now(),
): Promise<void> {
  const startedAt = now();
  try {
    const directory = directoryFromEnv(env);
    const taste = await reconcileTasteVectors(
      buildTasteDeps(env, async () => {
        const tenants = await directory.list();
        return Promise.all(
          tenants.map(async (tenant) => ({ tenant, taste: (await readProfile(env, tenant)).taste })),
        );
      }, now),
    );
    const r = await runDiscoverySweep(deps, config);
    const cutoff = new Date(startedAt - config.logRetentionDays * 86_400_000).toISOString();
    const pruned = await pruneDiscoveryLog(env, cutoff);
    // Standing infrastructure-failure count (not just this tick's): an idle tick after an
    // outage must still read as degraded until the `failed` rows clear, so the health record
    // reflects the system's actual state, not just the latest run's activity. THAT is what a
    // health check is for. `ok: false` flips `/health` to 503; the cron itself is NOT failed
    // (the tick completed) — only a thrown tick rethrows below.
    const failedOutstanding = await countDiscoveryFailures(env);
    const ok = failedOutstanding === 0;
    const summary = {
      processed: r.processed,
      imported: r.imported,
      duplicate: r.duplicate,
      no_match: r.noMatch,
      dietary_gated: r.dietaryGated,
      parked: r.parked,
      failed: r.failed,
      failed_outstanding: failedOutstanding,
      deferred: r.deferred,
      taste_updated: taste.updated,
      log_pruned: pruned,
    };
    await writeJobHealth(env, "discovery-sweep", { ok, last_run_at: startedAt, summary });
    await writeJobRun(env, "discovery-sweep", {
      ok,
      ran_at: startedAt,
      duration_ms: now() - startedAt,
      summary,
    });
    // History point (usage-trends): doubles = [duration_ms, processed, imported, duplicate, no_match,
    // dietary_gated, parked, failed, failed_outstanding, deferred, taste_updated, log_pruned].
    recordUsagePoint(env, "discovery-sweep", {
      ok,
      durationMs: now() - startedAt,
      counts: [
        r.processed,
        r.imported,
        r.duplicate,
        r.noMatch,
        r.dietaryGated,
        r.parked,
        r.failed,
        failedOutstanding,
        r.deferred,
        taste.updated,
        pruned,
      ],
    });
    if (r.failed > 0) {
      // Push only on FRESH infra failures (this tick), not on every tick a failure stands —
      // the standing state is already visible at `/health` (ok:false). Avoids per-tick ntfy
      // spam on the short cron cadence.
      await notifyFailure(
        env,
        "discovery-sweep",
        `${r.failed} discovery candidate(s) failed on infrastructure errors this tick (${failedOutstanding} standing; see /health, read_discovery_errors)`,
      ).catch(() => {});
    } else if (r.parked > 0) {
      // Content parks aren't a job failure, but they need eyes (read_discovery_errors / the
      // admin log). A best-effort heads-up; never let it fail the run.
      await notifyFailure(env, "discovery-sweep", `${r.parked} discovery candidate(s) parked (see read_discovery_errors)`).catch(
        () => {},
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[discovery-sweep] tick failed:", msg);
    await writeJobHealth(env, "discovery-sweep", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: msg },
    }).catch(() => {});
    await writeJobRun(env, "discovery-sweep", {
      ok: false,
      ran_at: startedAt,
      duration_ms: now() - startedAt,
      summary: { error: msg },
    });
    recordUsagePoint(env, "discovery-sweep", { ok: false, durationMs: now() - startedAt });
    await notifyFailure(env, "discovery-sweep", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
