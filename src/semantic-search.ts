// Pure ranking for `recipe_semantic_search` (semantic-meal-plan). No I/O here so the
// scoring is unit-testable; the tool wrapper (src/tools.ts) supplies the facet-
// prefiltered candidates, their embeddings, the query vector, the favorite vectors,
// and the reference `now`. This is the cosine + re-rank middle leg of the design's
// "distill → retrieve → compose": hard constraints are already gated in the
// prefilter (filterRecipes), so everything here only *reorders* survivors — it can
// never admit a recipe the gate rejected.
//
// Score for a candidate against one query:
//   score = cosine(query, recipe)                     // semantic relevance (the lens)
//         + favoriteWeight · maxCosine(recipe, favs)  // taste direction (nearest-liked)
//         + freshnessBoost(last_cooked, now)          // rotation (never-cooked ↑, recent ↓)
// The two boosts are deliberately SMALL relative to cosine (which dominates for
// relevant matches), so they nudge rather than override — favorites set *direction*,
// freshness sets *rotation*, and neither can drag an irrelevant recipe to the top.

import { cosineSimilarity } from "./embedding.js";
import type { Preferences } from "./profile-db.js";

/** A facet-prefiltered candidate with its resolved embedding + freshness signal. */
export interface SearchCandidate {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
  /** The recipe's embedding (EMBED_DIM floats). Candidates without one are dropped
   *  by the caller before ranking — an unembedded recipe is "not yet indexed". */
  embedding: number[];
  /** YYYY-MM-DD of the caller's most recent cook, or null if never cooked. */
  last_cooked: string | null;
}

/** One ranked result row (compact — what the tool returns per spec). */
export interface ScoredRecipe {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
  /** Final blended score (cosine + favorite + freshness), rounded. */
  score: number;
  /** Raw query↔recipe cosine before the boosts, for transparency/debugging. */
  similarity: number;
}

/** Tunable re-rank weights. Defaults below; overridden per-tenant by `rotation` prefs. */
export interface RankParams {
  /** Weight on max-cosine-to-a-favorite (taste direction). */
  favoriteWeight: number;
  /** Magnitude of the never-cooked boost and the just-cooked demotion (rotation). */
  noveltyBoost: number;
  /** Days after which a cooked recipe is fully "rotated back in" (demotion → 0). */
  resurfaceAfterDays: number;
}

export const DEFAULT_RANK_PARAMS: RankParams = {
  favoriteWeight: 0.15,
  noveltyBoost: 0.1,
  resurfaceAfterDays: 30,
};

/** Default top-K per spec when the caller doesn't specify, and the hard cap. */
export const DEFAULT_K = 10;
export const MAX_K = 50;

/** Round to 4 decimals — enough to order, compact in the JSON the model reads. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days from a YYYY-MM-DD day to `now` (UTC), floored, never negative. A future
 *  or unparseable date yields 0 (treated as "just cooked" → maximal demotion). */
export function daysSince(day: string, now: Date): number {
  const then = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(then)) return 0;
  const ms = now.getTime() - then;
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/**
 * Rotation boost from cook recency:
 *   * never cooked      → +noveltyBoost            (new imports get their shot)
 *   * cooked ≥ window   →  0                        (fully rotated back in)
 *   * cooked < window   → −noveltyBoost·(1 − d/window)  (recent → demoted, linearly
 *                                                    decaying to 0 at the window edge)
 */
export function freshnessBoost(lastCooked: string | null, now: Date, params: RankParams): number {
  if (lastCooked === null) return params.noveltyBoost;
  const d = daysSince(lastCooked, now);
  if (d >= params.resurfaceAfterDays) return 0;
  return -params.noveltyBoost * (1 - d / params.resurfaceAfterDays);
}

/** Max cosine of a recipe to ANY favorited recipe's vector (nearest-liked, not a
 *  centroid — people are multimodal). 0 when there are no favorites (cold-start no-op). */
export function favoriteAffinity(recipe: number[], favorites: number[][]): number {
  let best = 0;
  for (const fav of favorites) {
    const c = cosineSimilarity(recipe, fav);
    if (c > best) best = c;
  }
  return best;
}

/**
 * Rank facet-prefiltered candidates for ONE query vector: blend cosine relevance with
 * the favorite and freshness boosts, sort descending, return the top `k`. Pure — the
 * caller resolves candidates/embeddings/favorites and passes `now`.
 */
export function rankCandidates(
  candidates: SearchCandidate[],
  queryVec: number[],
  favorites: number[][],
  now: Date,
  params: RankParams,
  k: number,
): ScoredRecipe[] {
  const scored = candidates.map((c) => {
    const similarity = cosineSimilarity(queryVec, c.embedding);
    const score =
      similarity +
      params.favoriteWeight * favoriteAffinity(c.embedding, favorites) +
      freshnessBoost(c.last_cooked, now, params);
    return {
      slug: c.slug,
      title: c.title,
      description: c.description,
      protein: c.protein,
      cuisine: c.cuisine,
      time_total: c.time_total,
      score: round4(score),
      similarity: round4(similarity),
    };
  });
  // Sort by blended score, breaking ties on slug for a deterministic order.
  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return scored.slice(0, Math.max(1, Math.min(k, MAX_K)));
}

/**
 * Resolve the re-rank params from a tenant's preferences, falling back to defaults for
 * any field not set. Reads a `rotation: { resurface_after_days, novelty_boost }` object
 * (added to the preferences schema in the favorite cutover; until then every tenant
 * gets the defaults). Defensive about the loose `Preferences` shape — a malformed value
 * is ignored in favor of the default rather than throwing on the read path.
 */
export function resolveRankParams(prefs: Preferences | null): RankParams {
  const rotation =
    prefs && typeof prefs.rotation === "object" && prefs.rotation !== null
      ? (prefs.rotation as Record<string, unknown>)
      : {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    favoriteWeight: DEFAULT_RANK_PARAMS.favoriteWeight,
    noveltyBoost: num(rotation.novelty_boost, DEFAULT_RANK_PARAMS.noveltyBoost),
    resurfaceAfterDays: num(rotation.resurface_after_days, DEFAULT_RANK_PARAMS.resurfaceAfterDays),
  };
}
