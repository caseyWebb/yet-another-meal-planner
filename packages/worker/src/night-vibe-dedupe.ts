// Pure phrase-space dedup for meal-vibe derivation (meal-vibe-archetype-derivation
// capability). Two deterministic helpers, no I/O — the `night-vibe-derive.ts` / `diversify.ts`
// discipline, so they are unit-testable off `workerd` with synthetic vectors:
//   * planQueueConvergence — collapse a member's accumulated PENDING `add_vibe` proposals onto one
//     representative per near-duplicate group (the queue-convergence sweep). Deterministic +
//     idempotent: iterate pending in (created_at ASC, id ASC) order; the earliest survivor of a
//     group is its representative, so a rerun over converged state supersedes nothing further.
//   * filterCandidates — drop a freshly-derived candidate whose named phrase is already covered by
//     a basis vector (palette ∪ pending-representatives ∪ rejected) or by an earlier kept candidate
//     in the same run (within-run dedup is first-kept-wins).
// The convergence key is `(meal, phrase-space)`: a lunch candidate dedupes against lunch vibes and
// lunch-mealed proposals ONLY — the same phrase in a different meal is NOT a duplicate. A pending
// proposal (or basis vibe) lacking a meal is treated as `dinner` (pre-meal-dimension rows).
// The vectors are the NAMED-PHRASE embeddings (the semantic identity the member experiences); the
// caller (`runDerivation`) supplies them via a prebuilt `Map<phrase, number[]>` so this module
// stays pure. Threshold defaults to the shared derive dedup threshold (0.85).

import { cosineSimilarity } from "./embedding.js";
import { DEFAULT_DERIVE_PARAMS } from "./night-vibe-derive.js";
import type { DerivedArchetype } from "./night-vibe-derive.js";

/** One pending `add_vibe` proposal the sweep converges — its id, named phrase, meal
 *  (absent = pre-meal row, treated as dinner), and enqueue time. */
export interface PendingVibeProposal {
  id: string;
  vibe: string;
  meal?: string;
  created_at: string | null;
}

/** One dedup-basis vector with its meal (absent = dinner). */
export interface MealVector {
  meal?: string;
  vec: number[];
}

/** The dedup basis for the sweep: the member's palette phrase vectors and their rejected-proposal
 *  phrase vectors, each carrying its meal. A pending proposal near either IN ITS OWN MEAL is
 *  superseded before it can be a representative. */
export interface ConvergenceBasis {
  paletteVecs: MealVector[];
  rejectedVecs: MealVector[];
}

/** What the sweep decided: the pending ids to supersede (with what covered each) and the pending
 *  proposals that survive as their group's representative (for the candidate-filter basis). */
export interface QueueConvergencePlan {
  /** `coveredBy`: "palette" | "rejected" | the representative proposal's id. */
  superseded: { id: string; coveredBy: string }[];
  representatives: { id: string; vibe: string; meal: string }[];
}

/** Normalize an optional meal onto the closed set's default (pre-meal rows are dinner). */
function mealOf(meal: string | undefined): string {
  return meal === "breakfast" || meal === "lunch" || meal === "dinner" ? meal : "dinner";
}

/** Ascending `(created_at, id)` — the deterministic sweep order. A null `created_at` sorts first
 *  (an unstamped legacy row is treated as oldest); the id tiebreak makes exact ties deterministic. */
function byCreatedThenId(a: PendingVibeProposal, b: PendingVibeProposal): number {
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when `vec` is within `threshold` cosine of any SAME-MEAL vector in `basis`. */
function coveredByAny(vec: number[] | undefined, meal: string, basis: MealVector[], threshold: number): boolean {
  if (!vec) return false;
  return basis.some((b) => mealOf(b.meal) === meal && cosineSimilarity(vec, b.vec) >= threshold);
}

/**
 * Plan the queue-convergence sweep over a member's PENDING `add_vibe` proposals.
 * Iterating in `(created_at ASC, id ASC)` order, a proposal whose phrase is within `threshold` of
 * (a) a palette vibe OF ITS MEAL, (b) a rejected proposal OF ITS MEAL, or (c) an earlier surviving
 * representative OF ITS MEAL is superseded; otherwise it survives and becomes a representative.
 * Comparison is to representatives only (not transitive closure) — order-deterministic and
 * idempotent. Only ids in `pending` appear in the plan; the caller guarantees they are all
 * `status='pending'` (rejected/accepted rows are never passed in). `vecOf` maps each pending
 * phrase to its embedding; a phrase absent from the map (embedding unavailable) can never match,
 * so it survives rather than being wrongly collapsed.
 */
export function planQueueConvergence(
  pending: PendingVibeProposal[],
  basis: ConvergenceBasis,
  vecOf: Map<string, number[]>,
  threshold = DEFAULT_DERIVE_PARAMS.dedupThreshold,
): QueueConvergencePlan {
  const ordered = [...pending].sort(byCreatedThenId);
  const superseded: { id: string; coveredBy: string }[] = [];
  const representatives: { id: string; vibe: string; meal: string }[] = [];
  const repVecs: number[][] = [];

  for (const p of ordered) {
    const vec = vecOf.get(p.vibe);
    const meal = mealOf(p.meal);
    if (coveredByAny(vec, meal, basis.paletteVecs, threshold)) {
      superseded.push({ id: p.id, coveredBy: "palette" });
      continue;
    }
    if (coveredByAny(vec, meal, basis.rejectedVecs, threshold)) {
      superseded.push({ id: p.id, coveredBy: "rejected" });
      continue;
    }
    const rep = vec
      ? representatives.find((r, i) => r.meal === meal && cosineSimilarity(vec, repVecs[i]) >= threshold)
      : undefined;
    if (rep) {
      superseded.push({ id: p.id, coveredBy: rep.id });
      continue;
    }
    representatives.push({ id: p.id, vibe: p.vibe, meal });
    if (vec) repVecs.push(vec);
    else repVecs.push([]); // keep index alignment; a zero-length vec never matches (cosine → 0)
  }

  return { superseded, representatives };
}

/**
 * Drop candidates already covered in `(meal, phrase-space)` (design D1(d)). A candidate is
 * dropped when its named phrase is within `threshold` of any SAME-MEAL `basisVecs` vector
 * (palette ∪ pending-representatives ∪ rejected) or of an earlier KEPT candidate of its meal
 * this run — within-run dedup is first-kept-wins, so candidates should arrive in the order the
 * caller prefers to keep (biggest-cluster-first for the clusters branch, generator order for
 * cold start). This applies to EVERY candidate source, cluster-derived and cold-start alike.
 * `vecOf` maps each candidate phrase to its embedding; a candidate whose phrase is absent from
 * the map can't be matched and is kept.
 */
export function filterCandidates(
  candidates: DerivedArchetype[],
  basisVecs: MealVector[],
  vecOf: Map<string, number[]>,
  threshold = DEFAULT_DERIVE_PARAMS.dedupThreshold,
): DerivedArchetype[] {
  const kept: DerivedArchetype[] = [];
  const keptVecs: MealVector[] = [];
  for (const c of candidates) {
    const vec = vecOf.get(c.vibe);
    const meal = mealOf(c.meal);
    if (coveredByAny(vec, meal, basisVecs, threshold)) continue;
    if (coveredByAny(vec, meal, keptVecs, threshold)) continue;
    kept.push(c);
    if (vec) keptVecs.push({ meal, vec });
  }
  return kept;
}
