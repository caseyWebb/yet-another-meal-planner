// Cook-time vibe-satisfaction attribution (converge-meal-planning-surfaces D4). Pure — no I/O
// here so the threshold/multi-vibe logic is unit-testable without a binding, mirroring
// src/semantic-search.ts / src/cookbook-similar.ts. The caller (src/cooking-write.ts) resolves the
// cooked recipe's embedding + the palette vibe vectors (both cron-captured, `recipe_derived` /
// `night_vibe_derived`) and turns the returned records into `vibe_satisfaction` INSERTs inside the
// log_cooked batch.
//
// This is the INVERSE of `rankCandidates`: there a query vector ranks recipe candidates; here the
// cooked recipe's vector is scored against each palette vibe. It reuses the SAME cosine helper
// (`cosineSimilarity`, src/embedding.ts) rather than reinventing one, and issues NO embedding call.
//
// Attribution unions two signals (night-vibe-palette / cooking-history "Satisfaction is revealed at
// cook time"):
//   (a) the cleared plan row's `from_vibe` — a GUARANTEED-RESET PRIOR: an explicitly-aimed vibe
//       always gets a record, even at a borderline/zero cosine (or when it isn't embedded yet).
//   (b) every palette vibe the cooked recipe cosine-matches — bounded to avoid one dish suppressing
//       the whole palette: the single TOP match resets when it clears the (lower) FLOOR, and any
//       OTHER vibe resets only when it clears the (higher) GATE.

import { cosineSimilarity } from "./embedding.js";

/**
 * Top-match floor and secondary-match gate for cook-time cosine attribution, on the recipe↔vibe
 * cosine scale. The top (strongest) match resets when it clears `floor`; weaker matches reset only
 * when they clear `gate` (the over-reset guard — a single lucky dish cannot reset the whole
 * palette). `floor < gate` by construction.
 *
 * DEFAULTS, to be calibrated on production cook logs (the "calibrate the cosine band on the first
 * production hours" precedent of `NORMALIZE_CONFIRM_MIN = 0.72` in src/ingredient-normalize.ts):
 * recipe↔vibe is a query-phrase↔recipe-description cosine, which runs lower than the recipe↔recipe
 * band (`SIMILAR_FLOOR = 0.5`, src/cookbook-similar.ts), so these ship deliberately modest and get
 * pinned to the observed match/non-match split against real cook→palette pairs during apply.
 */
export const VIBE_SATISFY_FLOOR = 0.5;
export const VIBE_SATISFY_GATE = 0.6;

/** The threshold pair, injected so tests pin them independent of the shipped defaults. */
export interface VibeSatisfyParams {
  /** Top-match reset bar (the strongest cosine match resets at/above this). */
  floor: number;
  /** Secondary-match reset bar (every OTHER match resets only at/above this; > floor). */
  gate: number;
}

export const DEFAULT_VIBE_SATISFY_PARAMS: VibeSatisfyParams = {
  floor: VIBE_SATISFY_FLOOR,
  gate: VIBE_SATISFY_GATE,
};

/** One vibe a cook satisfied, with the cosine at attribution time (`score`, provenance only). */
export interface VibeSatisfactionMatch {
  vibe_id: string;
  /** cosine(recipe, vibe) — 0 when the from_vibe prior fires on an unembedded recipe/vibe. */
  score: number;
}

/**
 * Decide which palette vibes a cooked recipe satisfies and at what cosine. Pure.
 *
 * @param recipeVec  the cooked recipe's embedding, or `[]` when it isn't reconciled yet
 * @param vibeVectors  palette vibe id → embedding (only embedded vibes are present)
 * @param fromVibe  the cleared plan row's `from_vibe`, or null for an off-plan / hand-picked cook
 * @param params  the floor/gate thresholds (defaults ship in `DEFAULT_VIBE_SATISFY_PARAMS`)
 *
 * Returns a record for:
 *   - `fromVibe` ALWAYS when present (the guaranteed-reset prior — its `score` is the computed
 *     cosine when the vibe is embedded, else 0),
 *   - the single TOP cosine match when it clears `floor` (a full reset for the strongest match),
 *   - any OTHER vibe whose cosine clears `gate` (the over-reset guard).
 * Deduped by vibe id (a vibe that is both the from_vibe and a cosine match keeps its cosine score).
 * A recipe with no embedding yields at most the `from_vibe` prior; a vibe with no embedding is
 * skipped by cosine but still fires when it is the `from_vibe`. Ordered score-desc, id-asc
 * (deterministic — the batch order and any test assertion are stable).
 */
export function matchCookedVibes(
  recipeVec: number[],
  vibeVectors: Map<string, number[]>,
  fromVibe: string | null,
  params: VibeSatisfyParams = DEFAULT_VIBE_SATISFY_PARAMS,
): VibeSatisfactionMatch[] {
  // Score every embedded palette vibe against the cooked recipe, strongest first (id-asc ties).
  const scored: VibeSatisfactionMatch[] = [];
  for (const [vibe_id, vec] of vibeVectors) {
    scored.push({ vibe_id, score: cosineSimilarity(recipeVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score || a.vibe_id.localeCompare(b.vibe_id));

  // Top match resets at/above the floor; every other match resets only at/above the higher gate.
  const selected = new Map<string, number>();
  scored.forEach(({ vibe_id, score }, i) => {
    const isTop = i === 0;
    if (score >= params.gate || (isTop && score >= params.floor)) selected.set(vibe_id, score);
  });

  // The guaranteed-reset prior: from_vibe always gets a record, keeping its cosine score when it was
  // also a cosine match, else scoring it directly (0 when the recipe or the vibe isn't embedded).
  if (fromVibe && !selected.has(fromVibe)) {
    const vec = vibeVectors.get(fromVibe);
    selected.set(fromVibe, vec ? cosineSimilarity(recipeVec, vec) : 0);
  }

  return [...selected]
    .map(([vibe_id, score]) => ({ vibe_id, score }))
    .sort((a, b) => b.score - a.score || a.vibe_id.localeCompare(b.vibe_id));
}
