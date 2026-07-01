// The organic ingredient-normalization capture job (organic-ingredient-normalization).
// A scheduled pass that drains the novel-term queue: embed each term (batched), cosine it
// against the identity registry, and — below a floor — mint a NOVEL node with NO LLM call,
// else run the cheap classifier confirm (SAME / SPECIALIZATION / NOVEL + edges). The chosen
// resolution is written once (alias + optional node + edges) so every later encounter is a
// deterministic hot-path hit. This is capture → retrieve → narrow for ingredient identity,
// the same cron shape as the flyer warm / recipe classify.
//
// Failure handling by kind: a transient env.AI/D1 error leaves the term QUEUED (deferred with
// backoff), writing nothing; a contract-invalid confirm FAILS SAFE to a NOVEL mint (fragment,
// never mis-collapse). Bounded per tick on the internal env.AI/D1 budget (no external subrequests).

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { cosineSimilarity, embedTexts } from "./embedding.js";
import { baseOf } from "./matching.js";
import {
  readNovelTermsBatch,
  readIdentityEmbeddings,
  commitResolution,
  deferNovelTerm,
  readSkuCoResolutionPairs,
  mergeIdentities,
  type Resolution,
  type NormalizationLog,
  type CoResolutionPair,
} from "./corpus-db.js";
import { confirmIdentity, NORMALIZE_MODEL, type IdentityConfirm } from "./ingredient-classify.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** Terms drained per scheduled tick (bounded; the rest defer to later ticks). */
export const NORMALIZE_MAX_PER_TICK = 25;
/** Cosine floor: a nearest candidate below this → mint NOVEL with no confirm call. Low (~0.5)
 *  because the unrelated band (~0.6) overlaps the synonym floor (spike finding). */
export const NORMALIZE_FLOOR = 0.5;
/** Candidates shown to the confirm — large enough to include a true synonym the embedder ranks
 *  poorly (spike: scallions→green-onion at #7). */
export const NORMALIZE_TOP_K = 10;
/** Backoff before a transiently-failed term re-enters the stream. */
export const NORMALIZE_RETRY_BACKOFF_MS = 30 * 60 * 1000;
/** SKU-cache co-resolution candidate pairs confirmed per tick (bounded; the rest wait for a later tick). */
export const NORMALIZE_CORESOLVE_MAX_PER_TICK = 10;

export interface NormalizeDeps {
  loadBatch(limit: number, now: number): Promise<string[]>;
  identityEmbeddings(): Promise<{ id: string; embedding: number[] }[]>;
  embed(texts: string[]): Promise<number[][]>;
  confirm(term: string, candidates: string[]): Promise<IdentityConfirm>;
  commit(r: Resolution): Promise<void>;
  defer(term: string, nextRetryAt: number): Promise<void>;
  /** Candidate cross-lexical merge pairs (distinct survivors sharing a Kroger SKU), bounded. */
  coResolutionPairs(limit: number): Promise<CoResolutionPair[]>;
  /** Set `loser`'s representative pointer to `survivor` (the union-find merge primitive). */
  merge(loser: string, survivor: string): Promise<void>;
  now(): number;
  maxPerTick: number;
  floor: number;
  topK: number;
  coResolveMaxPerTick: number;
}

export interface NormalizeSummary {
  processed: number;
  same: number;
  specialization: number;
  novel: number;
  deferred: number;
  /** Cross-lexical merges applied from the SKU co-resolution signal this tick. */
  merged: number;
  /** Co-resolution candidate pairs the confirm rejected (kept distinct). */
  mergeRejected: number;
  /** Co-resolution pairs skipped this tick (both-human, or a transient confirm error). */
  mergeSkipped: number;
}

/** Top-K nearest identity ids to a vector, by cosine, descending. */
function nearest(
  vec: number[],
  identityVecs: { id: string; embedding: number[] }[],
  topK: number,
): { id: string; score: number }[] {
  return identityVecs
    .map((c) => ({ id: c.id, score: cosineSimilarity(vec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** A NOVEL resolution (below-floor no-LLM mint, or the fail-safe on a bad confirm). */
function novelResolution(
  term: string,
  vec: number[],
  candidates: { id: string; score: number }[],
  model: string | null,
  note?: string,
): Resolution {
  const log: NormalizationLog = { term, outcome: "novel", resolved_id: term, candidates, model };
  if (note) log.detail = { note };
  return {
    term,
    id: term,
    node: { base: term, detail: null, search_term: term, concrete: true, embedding: vec },
    edges: [],
    log,
  };
}

/** Map a confirm's edges (endpoints "NEW" or candidate ids) onto the resolved id. */
function mapEdges(edges: IdentityConfirm["edges"], newId: string): { from: string; to: string; kind: string }[] {
  return edges.map((e) => ({
    from: e.from === "NEW" ? newId : e.from,
    to: e.to === "NEW" ? newId : e.to,
    kind: e.kind,
  }));
}

/** Turn a classifier confirm into a Resolution (deterministic id construction). */
export function buildResolution(
  term: string,
  vec: number[],
  candidates: { id: string; score: number }[],
  confirm: IdentityConfirm,
): Resolution {
  const logBase = { term, candidates, model: NORMALIZE_MODEL };
  if (confirm.outcome === "same" && confirm.match) {
    const id = confirm.match;
    return {
      term,
      id,
      edges: mapEdges(confirm.edges, id),
      log: { ...logBase, outcome: "same", resolved_id: id, detail: { reason: confirm.reason } },
    };
  }
  if (confirm.outcome === "specialization" && confirm.match && confirm.detail) {
    const id = `${confirm.match}::${confirm.detail}`;
    const base = baseOf(id);
    const detail = id.slice(base.length + 2); // everything after "base::"
    const edges = [{ from: id, to: confirm.match, kind: "general" }, ...mapEdges(confirm.edges, id)];
    return {
      term,
      id,
      node: { base, detail, search_term: term, concrete: confirm.concrete, embedding: vec },
      edges,
      log: { ...logBase, outcome: "specialization", resolved_id: id, detail: { reason: confirm.reason } },
    };
  }
  // NOVEL (confirmed): mint a base node from the term.
  return {
    term,
    id: term,
    node: { base: term, detail: null, search_term: term, concrete: confirm.concrete, embedding: vec },
    edges: mapEdges(confirm.edges, term),
    log: { ...logBase, outcome: "novel", resolved_id: term, detail: { reason: confirm.reason } },
  };
}

/** Resolve one term. Returns a Resolution to commit, or throws (transient) for the caller to defer. */
async function resolveOne(
  deps: NormalizeDeps,
  term: string,
  vec: number[],
  identityVecs: { id: string; embedding: number[] }[],
): Promise<Resolution> {
  const ranked = nearest(vec, identityVecs, deps.topK);
  // Below the floor (or nothing to compare) → NOVEL, no confirm call spent.
  if (ranked.length === 0 || ranked[0].score < deps.floor) {
    return novelResolution(term, vec, ranked, null);
  }
  let confirm: IdentityConfirm;
  try {
    confirm = await deps.confirm(term, ranked.map((r) => r.id));
  } catch (e) {
    // Contract-invalid confirm → fail safe to NOVEL. A transient AI error → rethrow (defer).
    if (e instanceof ToolError && e.code === "validation_failed") {
      return novelResolution(term, vec, ranked, NORMALIZE_MODEL, "confirm_failed_safe");
    }
    throw e;
  }
  return buildResolution(term, vec, ranked, confirm);
}

function emptySummary(): NormalizeSummary {
  return { processed: 0, same: 0, specialization: 0, novel: 0, deferred: 0, merged: 0, mergeRejected: 0, mergeSkipped: 0 };
}

/**
 * The SKU-cache co-resolution pass: two distinct surviving ids that repeatedly resolve to the same
 * Kroger SKU are candidate cross-lexical synonyms (the signal embeddings can't retrieve — zucchini
 * ranks far from courgette). Each candidate goes through the SAME conservative classifier confirm
 * before any merge; only a `same`-outcome that points back at the other id merges them. Survivor
 * selection protects human intent: a `human` node is always the survivor (never merged away); two
 * human nodes are left alone (respect operator intent); auto/auto picks a deterministic survivor
 * (the lexicographically smaller id) so a rerun is stable. Bounded per tick; a transient confirm
 * error skips just that pair. Folds its counts into `summary`.
 */
async function reconcileCoResolution(deps: NormalizeDeps, summary: NormalizeSummary): Promise<void> {
  let pairs: CoResolutionPair[];
  try {
    pairs = await deps.coResolutionPairs(deps.coResolveMaxPerTick);
  } catch (e) {
    // A reader failure (D1) must not fail the whole tick — the queue drain already succeeded.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-normalize] co-resolution read failed:", msg);
    return;
  }
  for (const pair of pairs) {
    // Never auto-collapse two operator-pinned nodes — respect the human intent on both sides.
    if (pair.aSource === "human" && pair.bSource === "human") {
      summary.mergeSkipped++;
      continue;
    }
    let confirm: IdentityConfirm;
    try {
      // Conservative gate: confirm A against B alone. Merge only when it's the SAME product as B.
      confirm = await deps.confirm(pair.aTerm, [pair.b]);
    } catch (e) {
      // Transient (or contract-invalid) confirm → skip this pair; try it again on a later tick.
      summary.mergeSkipped++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ingredient-normalize] co-resolution confirm failed for "${pair.a}"~"${pair.b}":`, msg);
      continue;
    }
    if (confirm.outcome !== "same" || confirm.match !== pair.b) {
      // A specialization/novel result means they are distinct products — keep them apart.
      summary.mergeRejected++;
      continue;
    }
    // Survivor selection: a human node wins; else the lexicographically smaller id (deterministic).
    let survivor: string;
    let loser: string;
    if (pair.aSource === "human") {
      survivor = pair.a;
      loser = pair.b;
    } else if (pair.bSource === "human") {
      survivor = pair.b;
      loser = pair.a;
    } else {
      survivor = pair.a < pair.b ? pair.a : pair.b;
      loser = pair.a < pair.b ? pair.b : pair.a;
    }
    try {
      await deps.merge(loser, survivor);
      summary.merged++;
    } catch (e) {
      summary.mergeSkipped++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ingredient-normalize] co-resolution merge failed for "${loser}"→"${survivor}":`, msg);
    }
  }
}

/** The core pass, pure w.r.t. its injected deps (unit-testable without env). */
export async function reconcileNormalization(deps: NormalizeDeps): Promise<NormalizeSummary> {
  const now = deps.now();
  const terms = await deps.loadBatch(deps.maxPerTick, now);
  const summary = emptySummary();

  const identityVecs = terms.length ? await deps.identityEmbeddings() : [];
  const vecs = terms.length ? await deps.embed(terms) : []; // a chunk failure throws → the whole tick fails (terms stay queued)

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const vec = vecs[i];
    try {
      const r = await resolveOne(deps, term, vec, identityVecs);
      await deps.commit(r);
      summary.processed++;
      summary[r.log.outcome as "same" | "specialization" | "novel"]++;
      // Let later terms this tick match a node just minted (append to the retrieval set).
      if (r.node) identityVecs.push({ id: r.id, embedding: r.node.embedding });
    } catch (e) {
      // Transient (env.AI/D1) → leave queued with backoff; never lose the term.
      await deps.defer(term, now + NORMALIZE_RETRY_BACKOFF_MS).catch(() => {});
      summary.deferred++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ingredient-normalize] deferred "${term}":`, msg);
    }
  }

  // After the queue drain, propose cross-lexical merges from the shared SKU cache (a signal the
  // embedding retrieval can't produce). Runs even on an empty queue — a merge candidate can arise
  // purely from new SKU-cache activity between ticks.
  await reconcileCoResolution(deps, summary);
  return summary;
}

/** Wire the real env for the scheduled handler. */
export function buildNormalizeDeps(env: Env): NormalizeDeps {
  return {
    loadBatch: (limit, now) => readNovelTermsBatch(env, limit, now),
    identityEmbeddings: () => readIdentityEmbeddings(env),
    embed: (texts) => embedTexts(env, texts),
    confirm: (term, candidates) => confirmIdentity(env, term, candidates),
    commit: (r) => commitResolution(env, r),
    defer: (term, nextRetryAt) => deferNovelTerm(env, term, nextRetryAt),
    coResolutionPairs: (limit) => readSkuCoResolutionPairs(env, limit),
    merge: (loser, survivor) => mergeIdentities(env, loser, survivor),
    now: () => Date.now(),
    maxPerTick: NORMALIZE_MAX_PER_TICK,
    floor: NORMALIZE_FLOOR,
    topK: NORMALIZE_TOP_K,
    coResolveMaxPerTick: NORMALIZE_CORESOLVE_MAX_PER_TICK,
  };
}

/**
 * One scheduled run: do the pass, record the `ingredient-normalize` job_health + job_run rows,
 * and rethrow so the platform's cron status reflects a hard failure (mirrors runFacetJob).
 */
export async function runNormalizeJob(env: Env, deps: NormalizeDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const s = await reconcileNormalization(deps);
    await writeJobHealth(env, "ingredient-normalize", { ok: true, last_run_at: startedAt, summary: { ...s } });
    await writeJobRun(env, "ingredient-normalize", {
      ok: true,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { ...s },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-normalize] pass failed:", msg);
    await writeJobHealth(env, "ingredient-normalize", { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(
      () => {},
    );
    await writeJobRun(env, "ingredient-normalize", {
      ok: false,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
