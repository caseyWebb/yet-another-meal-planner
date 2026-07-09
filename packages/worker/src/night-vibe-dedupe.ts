// Pure phrase-space dedup for night-vibe derivation (night-vibe-archetype-derivation capability).
// Two deterministic helpers, no I/O — the `night-vibe-derive.ts` / `diversify.ts` discipline, so
// they are unit-testable off `workerd` with synthetic vectors:
//   * planQueueConvergence — collapse a member's accumulated PENDING `add_vibe` proposals onto one
//     representative per near-duplicate group (the queue-convergence sweep). Deterministic +
//     idempotent: iterate pending in (created_at ASC, id ASC) order; the earliest survivor of a
//     group is its representative, so a rerun over converged state supersedes nothing further.
//   * filterCandidates — drop a freshly-derived candidate whose named phrase is already covered by
//     a basis vector (palette ∪ pending-representatives ∪ rejected) or by an earlier kept candidate
//     in the same run (within-run dedup is first-kept-wins).
// The vectors are the NAMED-PHRASE embeddings (the semantic identity the member experiences); the
// caller (`runDerivation`) supplies them via a prebuilt `Map<phrase, number[]>` so this module
// stays pure. Threshold defaults to the shared derive dedup threshold (0.85).

import { cosineSimilarity } from "./embedding.js";
import { DEFAULT_DERIVE_PARAMS } from "./night-vibe-derive.js";
import type { DerivedArchetype } from "./night-vibe-derive.js";

/** One pending `add_vibe` proposal the sweep converges — its id, named phrase, and enqueue time. */
export interface PendingVibeProposal {
  id: string;
  vibe: string;
  created_at: string | null;
}

/** The dedup basis for the sweep: the member's palette phrase vectors and their rejected-proposal
 *  phrase vectors. A pending proposal near either is superseded before it can be a representative. */
export interface ConvergenceBasis {
  paletteVecs: number[][];
  rejectedVecs: number[][];
}

/** What the sweep decided: the pending ids to supersede (with what covered each) and the pending
 *  proposals that survive as their group's representative (for the candidate-filter basis). */
export interface QueueConvergencePlan {
  /** `coveredBy`: "palette" | "rejected" | the representative proposal's id. */
  superseded: { id: string; coveredBy: string }[];
  representatives: { id: string; vibe: string }[];
}

/** Ascending `(created_at, id)` — the deterministic sweep order. A null `created_at` sorts first
 *  (an unstamped legacy row is treated as oldest); the id tiebreak makes exact ties deterministic. */
function byCreatedThenId(a: PendingVibeProposal, b: PendingVibeProposal): number {
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when `vec` is within `threshold` cosine of any vector in `basis`. */
function coveredByAny(vec: number[] | undefined, basis: number[][], threshold: number): boolean {
  if (!vec) return false;
  return basis.some((b) => cosineSimilarity(vec, b) >= threshold);
}

/**
 * Plan the queue-convergence sweep over a member's PENDING `add_vibe` proposals (design D4).
 * Iterating in `(created_at ASC, id ASC)` order, a proposal whose phrase is within `threshold` of
 * (a) a palette vibe, (b) a rejected proposal, or (c) an earlier surviving representative is
 * superseded; otherwise it survives and becomes a representative. Comparison is to representatives
 * only (not transitive closure) — order-deterministic and idempotent. Only ids in `pending` appear
 * in the plan; the caller guarantees they are all `status='pending'` (rejected/accepted rows are
 * never passed in). `vecOf` maps each pending phrase to its embedding; a phrase absent from the map
 * (embedding unavailable) can never match, so it survives rather than being wrongly collapsed.
 */
export function planQueueConvergence(
  pending: PendingVibeProposal[],
  basis: ConvergenceBasis,
  vecOf: Map<string, number[]>,
  threshold = DEFAULT_DERIVE_PARAMS.dedupThreshold,
): QueueConvergencePlan {
  const ordered = [...pending].sort(byCreatedThenId);
  const superseded: { id: string; coveredBy: string }[] = [];
  const representatives: { id: string; vibe: string }[] = [];
  const repVecs: number[][] = [];

  for (const p of ordered) {
    const vec = vecOf.get(p.vibe);
    if (coveredByAny(vec, basis.paletteVecs, threshold)) {
      superseded.push({ id: p.id, coveredBy: "palette" });
      continue;
    }
    if (coveredByAny(vec, basis.rejectedVecs, threshold)) {
      superseded.push({ id: p.id, coveredBy: "rejected" });
      continue;
    }
    const rep = vec ? representatives.find((_, i) => cosineSimilarity(vec, repVecs[i]) >= threshold) : undefined;
    if (rep) {
      superseded.push({ id: p.id, coveredBy: rep.id });
      continue;
    }
    representatives.push({ id: p.id, vibe: p.vibe });
    if (vec) repVecs.push(vec);
    else repVecs.push([]); // keep index alignment; a zero-length vec never matches (cosine → 0)
  }

  return { superseded, representatives };
}

/**
 * Drop candidates already covered in phrase space (design D1(d)). A candidate is dropped when its
 * named phrase is within `threshold` of any `basisVecs` vector (palette ∪ pending-representatives ∪
 * rejected) or of an earlier KEPT candidate this run — within-run dedup is first-kept-wins, so
 * candidates should arrive in the order the caller prefers to keep (biggest-cluster-first for the
 * clusters branch, generator order for cold start). `vecOf` maps each candidate phrase to its
 * embedding; a candidate whose phrase is absent from the map can't be matched and is kept.
 */
export function filterCandidates(
  candidates: DerivedArchetype[],
  basisVecs: number[][],
  vecOf: Map<string, number[]>,
  threshold = DEFAULT_DERIVE_PARAMS.dedupThreshold,
): DerivedArchetype[] {
  const kept: DerivedArchetype[] = [];
  const keptVecs: number[][] = [];
  for (const c of candidates) {
    const vec = vecOf.get(c.vibe);
    if (coveredByAny(vec, basisVecs, threshold)) continue;
    if (coveredByAny(vec, keptVecs, threshold)) continue;
    kept.push(c);
    if (vec) keptVecs.push(vec);
  }
  return kept;
}
