// The periodic identity re-confirm pass (periodic-identity-reconfirm). A scheduled job that
// re-examines EDGELESS concrete auto-nodes — the below-floor no-LLM mints minted before their
// neighbors existed — against the now-denser registry and ENRICHES them: it adds the satisfies
// edges (kielbasa → sausage) or the synonym merge that could not exist at mint time. A near-mirror
// of the capture job (src/ingredient-normalize.ts): drain a bounded batch, retrieve nearest
// neighbors by cosine, run the SAME classifier confirm, apply — the difference is WHAT it drains
// (already-resolved under-connected nodes, not the novel-term queue) and that it must never make
// things worse.
//
// It is strictly NON-DESTRUCTIVE: it only ADDS edges (insert-or-ignore) or MERGES a node into a
// clear synonym survivor (this node is always the loser, so a human node is never merged away and
// human nodes are never selected). It NEVER removes/downgrades an edge, splits a node, or changes a
// node's canonical id (a specialization takes only the safe subset — a general edge to a known
// base — and leaves the id alone). Each eligible node is re-confirmed AT MOST ONCE then stamped, so
// the pass drains its backlog and quiesces to a no-op (the steady-state ≈0-LLM property holds).
//
// Failure handling mirrors the capture job's discipline: a transient env.AI/D1 error on a node
// skips it, leaving `reconfirmed_at` null (retried next tick), with no partial write; a
// contract-invalid confirm fails safe to a no-op (stamp it, change nothing) rather than inventing
// an edge/merge. Bounded per tick on the internal env.AI/D1 budget (no external subrequests).

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { cosineSimilarity } from "./embedding.js";
import {
  readReconfirmBatch,
  readIdentityEmbeddings,
  stampReconfirmed,
  commitReconfirmEdges,
  mergeIdentities,
  type ReconfirmNode,
  type NormalizationLog,
} from "./corpus-db.js";
import { confirmIdentity, NORMALIZE_MODEL, type IdentityConfirm, type ScoredCandidate } from "./ingredient-classify.js";
import { NORMALIZE_TOP_K } from "./ingredient-normalize.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** Under-connected nodes re-examined per scheduled tick (bounded; the rest wait for a later tick). */
export const RECONFIRM_MAX_PER_TICK = 10;

export interface ReconfirmDeps {
  loadBatch(limit: number): Promise<ReconfirmNode[]>;
  identityEmbeddings(): Promise<{ id: string; embedding: number[] }[]>;
  confirm(term: string, candidates: ScoredCandidate[]): Promise<IdentityConfirm>;
  /** Insert-or-ignore any edges + append the (re-confirm-marked) decision log. */
  commitEdges(r: { edges?: { from: string; to: string; kind: string }[]; log: NormalizationLog }): Promise<void>;
  /** Set `loser`'s representative to `survivor` (the union-find merge), logged as a re-confirm. */
  merge(loser: string, survivor: string): Promise<void>;
  /** Mark a node re-confirmed (the one-shot stamp) so it isn't re-processed. */
  stamp(id: string, now: number): Promise<void>;
  now(): number;
  maxPerTick: number;
  topK: number;
}

export interface ReconfirmSummary {
  /** Nodes stamped this tick (processed to a terminal decision, incl. fail-safe no-ops). */
  reconfirmed: number;
  /** Total satisfies-edges committed across the tick's enriched nodes. */
  edges_added: number;
  /** Nodes merged into a synonym survivor (`same`). */
  merged: number;
  /** Nodes that stayed novel (no merge, edges only or nothing). */
  still_novel: number;
  /** Nodes skipped on a transient error (stamp left null; retried next tick). */
  skipped: number;
}

function emptySummary(): ReconfirmSummary {
  return { reconfirmed: 0, edges_added: 0, merged: 0, still_novel: 0, skipped: 0 };
}

/** The readable surface form of a node id (base + detail flattened) — the confirm's `term`. */
function readableForm(node: ReconfirmNode): string {
  return node.id.split("::").join(" ");
}

/** Top-K nearest identity ids to a vector, by cosine, descending — EXCLUDING the node itself. */
function nearest(
  selfId: string,
  vec: number[],
  identityVecs: { id: string; embedding: number[] }[],
  topK: number,
): { id: string; score: number }[] {
  return identityVecs
    .filter((c) => c.id !== selfId)
    .map((c) => ({ id: c.id, score: cosineSimilarity(vec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Map a confirm's edges (endpoints "NEW" or candidate ids) onto this node's id. */
function mapEdges(edges: IdentityConfirm["edges"], selfId: string): { from: string; to: string; kind: string }[] {
  return edges.map((e) => ({
    from: e.from === "NEW" ? selfId : e.from,
    to: e.to === "NEW" ? selfId : e.to,
    kind: e.kind,
  }));
}

/**
 * Re-confirm one node against its nearest neighbors and apply the ENRICH-ONLY subset of the
 * confirm. Returns the applied outcome + how many edges were committed; the caller stamps + counts.
 * Throws only on a TRANSIENT (env.AI/D1) error so the caller can skip-and-retry; a contract-invalid
 * confirm is caught here and turned into a no-op (fail safe — stamp, change nothing).
 */
async function reconfirmOne(
  deps: ReconfirmDeps,
  node: ReconfirmNode,
  neighborVecs: { id: string; embedding: number[] }[],
): Promise<{ outcome: "same" | "novel"; edges_added: number }> {
  const term = readableForm(node);
  const ranked = nearest(node.id, node.embedding, neighborVecs, deps.topK);
  // No neighbors to compare → the node is genuinely isolated; stamp it as still-novel, no LLM call.
  if (ranked.length === 0) {
    await deps.commitEdges({ log: reconfirmLog(node, "novel", null) });
    return { outcome: "novel", edges_added: 0 };
  }

  const known = new Set(ranked.map((r) => r.id));
  let confirm: IdentityConfirm;
  try {
    confirm = await deps.confirm(term, ranked); // scored — the confirm sees each candidate's cosine
  } catch (e) {
    // Contract-invalid confirm → fail safe to a no-op (stamp, change nothing). A transient AI/D1
    // error → rethrow so the caller skips the node (stamp left null, retried next tick).
    if (e instanceof ToolError && e.code === "validation_failed") {
      await deps.commitEdges({ log: reconfirmLog(node, "novel", ranked, NORMALIZE_MODEL, "confirm_failed_safe") });
      return { outcome: "novel", edges_added: 0 };
    }
    throw e;
  }

  if (confirm.outcome === "same" && confirm.match) {
    // Clear synonym → merge THIS node into the survivor (the node is always the loser, so a human
    // survivor is fine and a human node is never a loser). The merge writes its own re-confirm log.
    await deps.merge(node.id, confirm.match);
    return { outcome: "same", edges_added: 0 };
  }

  // specialization / novel: take only the enrich subset — add the confirm's edges (never re-id).
  const edges = mapEdges(confirm.edges, node.id);
  if (confirm.outcome === "specialization" && confirm.match && known.has(confirm.match)) {
    // The safe subset of a specialization: a general edge from this node to the known base. Do NOT
    // change the node's canonical id (a full base::detail re-home is out of scope for v1).
    const generalEdge = { from: node.id, to: confirm.match, kind: "general" };
    if (!edges.some((e) => e.from === generalEdge.from && e.to === generalEdge.to && e.kind === generalEdge.kind)) {
      edges.push(generalEdge);
    }
  }
  const outcome = confirm.outcome === "specialization" ? "specialization" : "novel";
  await deps.commitEdges({ edges, log: reconfirmLog(node, outcome, ranked, NORMALIZE_MODEL, undefined, confirm.reason) });
  return { outcome: "novel", edges_added: edges.length };
}

/** Build a re-confirm decision log row (always marked `isReconfirm`). */
function reconfirmLog(
  node: ReconfirmNode,
  outcome: NormalizationLog["outcome"],
  candidates: { id: string; score: number }[] | null,
  model: string | null = null,
  note?: string,
  reason?: string,
): NormalizationLog {
  const detail: Record<string, unknown> = {};
  if (note) detail.note = note;
  if (reason) detail.reason = reason;
  return {
    term: readableForm(node),
    outcome,
    resolved_id: node.id,
    candidates: candidates ?? undefined,
    model,
    detail: Object.keys(detail).length ? detail : undefined,
    isReconfirm: true,
  };
}

/** The core pass, pure w.r.t. its injected deps (unit-testable without env). */
export async function reconfirmIdentities(deps: ReconfirmDeps): Promise<ReconfirmSummary> {
  const now = deps.now();
  const nodes = await deps.loadBatch(deps.maxPerTick);
  const summary = emptySummary();
  if (nodes.length === 0) return summary; // self-quiesced: nothing eligible, no model calls this tick

  const identityVecs = await deps.identityEmbeddings();

  for (const node of nodes) {
    try {
      const res = await reconfirmOne(deps, node, identityVecs);
      await deps.stamp(node.id, now); // one-shot: stamp AFTER a terminal decision (never re-processed)
      summary.reconfirmed++;
      summary.edges_added += res.edges_added;
      if (res.outcome === "same") summary.merged++;
      else summary.still_novel++;
    } catch (e) {
      // Transient (env.AI/D1) → skip the node, leave `reconfirmed_at` null (retried next tick), no
      // partial write. Un-stamped IS the re-try state — there is no defer row.
      summary.skipped++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ingredient-reconfirm] skipped "${node.id}":`, msg);
    }
  }
  return summary;
}

/** Wire the real env for the scheduled handler. */
export function buildReconfirmDeps(env: Env): ReconfirmDeps {
  return {
    loadBatch: (limit) => readReconfirmBatch(env, limit),
    identityEmbeddings: () => readIdentityEmbeddings(env),
    confirm: (term, candidates) => confirmIdentity(env, term, candidates),
    commitEdges: (r) => commitReconfirmEdges(env, r),
    merge: (loser, survivor) => mergeIdentities(env, loser, survivor, { isReconfirm: true }),
    stamp: (id, now) => stampReconfirmed(env, id, now),
    now: () => Date.now(),
    maxPerTick: RECONFIRM_MAX_PER_TICK,
    topK: NORMALIZE_TOP_K,
  };
}

/**
 * One scheduled run: do the re-confirm pass, record the `ingredient-reconfirm` job_health + job_run
 * rows (a `{ reconfirmed, edges_added, merged, still_novel }` summary), and rethrow so the
 * platform's cron status reflects a hard failure (mirrors runNormalizeJob).
 */
export async function runReconfirmJob(env: Env, deps: ReconfirmDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const s = await reconfirmIdentities(deps);
    const summary = {
      reconfirmed: s.reconfirmed,
      edges_added: s.edges_added,
      merged: s.merged,
      still_novel: s.still_novel,
    };
    await writeJobHealth(env, "ingredient-reconfirm", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "ingredient-reconfirm", {
      ok: true,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-reconfirm] pass failed:", msg);
    await writeJobHealth(env, "ingredient-reconfirm", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: msg },
    }).catch(() => {});
    await writeJobRun(env, "ingredient-reconfirm", {
      ok: false,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
