// The organic ingredient-normalization capture job (organic-ingredient-normalization).
// A scheduled pass that drains the novel-term queue: embed each term (batched), cosine it
// against the identity registry, and — below a floor — mint a NOVEL node with NO LLM call,
// else run the cheap classifier confirm (SAME / SPECIALIZATION / NOVEL + edges). A confirm
// pick below the distance guard (NORMALIZE_CONFIRM_MIN) rejects to a NOVEL fallback; a
// confirmed NOVEL mints under the classifier's validated canonical id (else the verbatim
// term). The chosen resolution is written once (alias + optional node + edges) so every
// later encounter is a deterministic hot-path hit. Each tick first backfills embeddings for
// embedding-less survivor nodes (human mints) so they join the retrieval set. This is
// capture → retrieve → narrow for ingredient identity, the same cron shape as the flyer
// warm / recipe classify.
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
  readIdentityIds,
  readEmbeddinglessIds,
  writeIdentityEmbedding,
  commitResolution,
  deferNovelTerm,
  readSkuCoResolutionPairs,
  mergeIdentities,
  type Resolution,
  type NormalizationLog,
  type CoResolutionPair,
} from "./corpus-db.js";
import { confirmIdentity, NORMALIZE_MODEL, type IdentityConfirm, type ScoredCandidate } from "./ingredient-classify.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** Terms drained per scheduled tick (bounded; the rest defer to later ticks). */
export const NORMALIZE_MAX_PER_TICK = 25;
/** Cosine floor: a nearest candidate below this → mint NOVEL with no confirm call. Low (~0.5)
 *  because the unrelated band (~0.6) overlaps the synonym floor (spike finding). */
export const NORMALIZE_FLOOR = 0.5;
/** Confirm minimum: a same/specialization pick whose CHOSEN candidate's own cosine is below this
 *  is rejected → NOVEL fallback. The floor gates the confirm CALL on the nearest candidate; this
 *  gates the confirm's PICK, which may be any of the top-K. Calibrated on the first production
 *  hours: every correct pick ≥ 0.736, the wrong collapses at 0.598/0.705 — 0.72 splits the bands. */
export const NORMALIZE_CONFIRM_MIN = 0.72;
/** Candidates shown to the confirm — large enough to include a true synonym the embedder ranks
 *  poorly (spike: scallions→green-onion at #7). */
export const NORMALIZE_TOP_K = 10;
/** Backoff before a transiently-failed term re-enters the stream. */
export const NORMALIZE_RETRY_BACKOFF_MS = 30 * 60 * 1000;
/** SKU-cache co-resolution candidate pairs confirmed per tick (bounded; the rest wait for a later tick). */
export const NORMALIZE_CORESOLVE_MAX_PER_TICK = 10;
/** Embedding-less survivor nodes (human mints) backfilled per tick, ahead of the drain. */
export const NORMALIZE_EMBED_BACKFILL_MAX_PER_TICK = 25;

export interface NormalizeDeps {
  loadBatch(limit: number, now: number): Promise<string[]>;
  identityEmbeddings(): Promise<{ id: string; embedding: number[] }[]>;
  /** EVERY existing node id and alias variant (merged + unembedded included) — the canonical-collision set. */
  knownIds(): Promise<Set<string>>;
  /** Surviving node ids with no stored embedding — the backfill batch, bounded. */
  embeddingless(limit: number): Promise<string[]>;
  /** Store a backfilled embedding on an existing node. */
  storeEmbedding(id: string, embedding: number[]): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
  confirm(term: string, candidates: ScoredCandidate[]): Promise<IdentityConfirm>;
  commit(r: Resolution): Promise<void>;
  defer(term: string, nextRetryAt: number): Promise<void>;
  /** Candidate cross-lexical merge pairs (distinct survivors sharing a Kroger SKU), bounded. */
  coResolutionPairs(limit: number): Promise<CoResolutionPair[]>;
  /** Set `loser`'s representative pointer to `survivor` (the union-find merge primitive). */
  merge(loser: string, survivor: string): Promise<void>;
  now(): number;
  maxPerTick: number;
  floor: number;
  confirmMin: number;
  topK: number;
  coResolveMaxPerTick: number;
  embedBackfillMaxPerTick: number;
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
  /** Embedding-less nodes (human mints) backfilled into the retrieval set this tick. */
  embedded: number;
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

/** A NOVEL resolution (below-floor no-LLM mint, the fail-safe on a bad confirm, or the
 *  distance-guard fallback) — always the VERBATIM term (no classifier canonical to trust). */
function novelResolution(
  term: string,
  vec: number[],
  candidates: { id: string; score: number }[],
  model: string | null,
  detail?: Record<string, unknown>,
): Resolution {
  const log: NormalizationLog = { term, outcome: "novel", resolved_id: term, candidates, model };
  if (detail) log.detail = detail;
  return {
    term,
    id: term,
    node: { base: term, detail: null, search_term: term, concrete: true, embedding: vec },
    edges: [],
    log,
  };
}

/** Max length for a classifier-proposed canonical id (a store product name, not prose). */
const CANONICAL_MAX_LENGTH = 64;

/**
 * Validate a classifier-proposed canonical id for a NOVEL mint: non-empty after trimming,
 * all-lowercase, no parentheses/commas/newlines, bounded length, and detail segments only via
 * "::" (each segment non-empty with no stray ":"). Returns the id, or null — the caller falls
 * back to the verbatim term, so a bad proposal can never fail a mint.
 */
export function validateCanonicalId(raw: string | null): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > CANONICAL_MAX_LENGTH) return null;
  if (id !== id.toLowerCase()) return null;
  if (/[(),\n\r]/.test(id)) return null;
  const segments = id.split("::");
  if (segments.length > 2) return null; // base or base::detail only — the prompt teaches no deeper shape
  if (segments.some((s) => !s.trim() || s !== s.trim() || s.includes(":"))) return null;
  return id;
}

/** Map a confirm's edges (endpoints "NEW" or candidate ids) onto the resolved id. */
function mapEdges(edges: IdentityConfirm["edges"], newId: string): { from: string; to: string; kind: string }[] {
  return edges.map((e) => ({
    from: e.from === "NEW" ? newId : e.from,
    to: e.to === "NEW" ? newId : e.to,
    kind: e.kind,
  }));
}

/** Turn a classifier confirm into a Resolution (deterministic id construction). `knownIds` is
 *  the full existing-node id set — the collision check for a NOVEL canonical proposal. */
export function buildResolution(
  term: string,
  vec: number[],
  candidates: { id: string; score: number }[],
  confirm: IdentityConfirm,
  knownIds: Set<string>,
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
  // NOVEL (confirmed): mint a node — under the classifier's cleaned canonical id when it
  // validates and doesn't collide with ANY existing node id (a collision would silently alias
  // the term through the node upsert + representative chain; merging belongs to the re-confirm/
  // co-resolution passes), else the verbatim term. The alias variant is always the surface term.
  const canonical = validateCanonicalId(confirm.canonical);
  let id = term;
  let detail: Record<string, unknown> = { reason: confirm.reason };
  if (canonical && canonical !== term) {
    if (knownIds.has(canonical)) {
      detail = { ...detail, canonical_rejected: canonical, canonical_reason: "collision" };
    } else {
      id = canonical;
    }
  } else if (confirm.canonical && !canonical) {
    detail = { ...detail, canonical_rejected: confirm.canonical, canonical_reason: "invalid" };
  }
  const base = baseOf(id);
  return {
    term,
    id,
    node: {
      base,
      detail: id.includes("::") ? id.slice(base.length + 2) : null,
      search_term: id === term ? term : id.split("::").join(" "),
      concrete: confirm.concrete,
      embedding: vec,
    },
    edges: mapEdges(confirm.edges, id),
    log: { ...logBase, outcome: "novel", resolved_id: id, detail },
  };
}

/** Resolve one term. Returns a Resolution to commit, or throws (transient) for the caller to defer. */
async function resolveOne(
  deps: NormalizeDeps,
  term: string,
  vec: number[],
  identityVecs: { id: string; embedding: number[] }[],
  knownIds: Set<string>,
): Promise<Resolution> {
  const ranked = nearest(vec, identityVecs, deps.topK);
  // Below the floor (or nothing to compare) → NOVEL, no confirm call spent.
  if (ranked.length === 0 || ranked[0].score < deps.floor) {
    return novelResolution(term, vec, ranked, null);
  }
  let confirm: IdentityConfirm;
  try {
    confirm = await deps.confirm(term, ranked);
  } catch (e) {
    // Contract-invalid confirm → fail safe to NOVEL. A transient AI error → rethrow (defer).
    if (e instanceof ToolError && e.code === "validation_failed") {
      return novelResolution(term, vec, ranked, NORMALIZE_MODEL, { note: "confirm_failed_safe" });
    }
    throw e;
  }
  // Distance guard: the floor gated the CALL on the nearest candidate, but the pick may be any of
  // the top-K — reject a collapse onto a candidate the embedder itself ranks distant (the
  // flaky-sea-salt→fish-sauce class) and fall back to a verbatim NOVEL mint, logging the rejection.
  if ((confirm.outcome === "same" || confirm.outcome === "specialization") && confirm.match) {
    const chosen = ranked.find((r) => r.id === confirm.match);
    if (!chosen || chosen.score < deps.confirmMin) {
      return novelResolution(term, vec, ranked, NORMALIZE_MODEL, {
        note: "confirm_below_min",
        rejected: { outcome: confirm.outcome, match: confirm.match, score: chosen ? chosen.score : null },
      });
    }
  }
  return buildResolution(term, vec, ranked, confirm, knownIds);
}

function emptySummary(): NormalizeSummary {
  return {
    processed: 0,
    same: 0,
    specialization: 0,
    novel: 0,
    deferred: 0,
    merged: 0,
    mergeRejected: 0,
    mergeSkipped: 0,
    embedded: 0,
  };
}

/**
 * The embedding backfill: embed a bounded batch of surviving nodes that have no stored vector —
 * human mints (`update_aliases` writes embedding NULL) are otherwise invisible to the cosine
 * retrieval, guaranteeing duplicate mints of the same concept. Runs BEFORE the drain (and before
 * the identity read) so a backfilled node is retrievable for this tick's own terms. Best-effort:
 * a failure logs and skips (rows stay NULL → retried next tick), never failing the tick.
 */
async function backfillEmbeddings(deps: NormalizeDeps, summary: NormalizeSummary): Promise<void> {
  try {
    const ids = await deps.embeddingless(deps.embedBackfillMaxPerTick);
    if (ids.length === 0) return;
    // Embed the readable form (base + detail flattened), the re-confirm pass's convention.
    const vecs = await deps.embed(ids.map((id) => id.split("::").join(" ")));
    for (let i = 0; i < ids.length; i++) {
      await deps.storeEmbedding(ids[i], vecs[i]);
      summary.embedded++;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-normalize] embedding backfill failed:", msg);
  }
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
      // No cosine is attached — the pairing signal is a shared SKU, deliberately non-embedding
      // evidence, so the capture pass's distance guard does not apply here.
      confirm = await deps.confirm(pair.aTerm, [{ id: pair.b }]);
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
  const summary = emptySummary();
  // Backfill first — before the identity read — so a human-minted (embedding-less) node joins
  // the retrieval set for this tick's own terms. Runs even on an empty queue.
  await backfillEmbeddings(deps, summary);
  const terms = await deps.loadBatch(deps.maxPerTick, now);

  const identityVecs = terms.length ? await deps.identityEmbeddings() : [];
  const knownIds = terms.length ? await deps.knownIds() : new Set<string>();
  const vecs = terms.length ? await deps.embed(terms) : []; // a chunk failure throws → the whole tick fails (terms stay queued)

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const vec = vecs[i];
    try {
      const r = await resolveOne(deps, term, vec, identityVecs, knownIds);
      await deps.commit(r);
      summary.processed++;
      summary[r.log.outcome as "same" | "specialization" | "novel"]++;
      // Let later terms this tick match a node just minted (append to the retrieval +
      // canonical-collision sets).
      if (r.node) {
        identityVecs.push({ id: r.id, embedding: r.node.embedding });
        knownIds.add(r.id);
      }
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
    knownIds: () => readIdentityIds(env),
    embeddingless: (limit) => readEmbeddinglessIds(env, limit),
    storeEmbedding: (id, embedding) => writeIdentityEmbedding(env, id, embedding),
    embed: (texts) => embedTexts(env, texts),
    confirm: (term, candidates) => confirmIdentity(env, term, candidates),
    commit: (r) => commitResolution(env, r),
    defer: (term, nextRetryAt) => deferNovelTerm(env, term, nextRetryAt),
    coResolutionPairs: (limit) => readSkuCoResolutionPairs(env, limit),
    merge: (loser, survivor) => mergeIdentities(env, loser, survivor),
    now: () => Date.now(),
    maxPerTick: NORMALIZE_MAX_PER_TICK,
    floor: NORMALIZE_FLOOR,
    confirmMin: NORMALIZE_CONFIRM_MIN,
    topK: NORMALIZE_TOP_K,
    coResolveMaxPerTick: NORMALIZE_CORESOLVE_MAX_PER_TICK,
    embedBackfillMaxPerTick: NORMALIZE_EMBED_BACKFILL_MAX_PER_TICK,
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
