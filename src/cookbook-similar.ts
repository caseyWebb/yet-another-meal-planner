// Pure nearest-neighbor selection for the cookbook's "Similar Recipes" section. No I/O
// here (mirrors src/cookbook-search.ts), so the selection is unit-testable without any
// binding; the route (src/cookbook.ts) supplies the stored embedding map and renders the
// ordered neighbors.
//
// This is recipe→recipe similarity over ALREADY-STORED vectors: the viewed recipe's
// embedding and every candidate's are read from `recipe_derived` (via loadRecipeEmbeddings),
// so finding neighbors is pure cosine arithmetic — NO query embedding and NO Workers AI
// call. That is the load-bearing distinction from the query-embedding semantic search the
// cookbook dropped: there is no query to embed, both vectors already exist.
//
// Both the neighbor COUNT (k) and the similarity FLOOR are tuning constants, deliberately
// kept OUT of the spec'd contract — the spec fixes the ordering semantics (descending,
// self-excluded, floored, deterministic ties, empty-when-unembedded), not these numbers.

import { cosineSimilarity } from "./embedding.js";

/** Max neighbors shown in the "Similar Recipes" section. Tuning constant (not spec'd). */
export const SIMILAR_K = 5;

/**
 * Minimum cosine similarity for a recipe to count as "similar" — below it, a neighbor is
 * dropped rather than listed under a heading it doesn't earn, and when nothing clears it the
 * section is omitted. Tuning constant (not spec'd). Anchored at the value the cookbook's
 * removed query→recipe semantic tier used; recipe↔recipe cosine tends to run higher than
 * that query↔recipe baseline, so tune (likely upward) against the live corpus during apply.
 */
export const SIMILAR_FLOOR = 0.5;

/** Selection knobs, injected so tests pin them independent of the shipped defaults. */
export interface NeighborParams {
  k: number;
  floor: number;
}

export const DEFAULT_NEIGHBOR_PARAMS: NeighborParams = { k: SIMILAR_K, floor: SIMILAR_FLOOR };

/**
 * The recipes nearest to `slug` by cosine over the stored embedding map, as ordered slugs
 * (most similar first), capped at `params.k`. Pure: the caller supplies the map
 * (loadRecipeEmbeddings). The viewed recipe is excluded from its own neighbors; candidates
 * below `params.floor` are dropped; ties break on slug for a deterministic order. Returns
 * `[]` when the viewed recipe has no vector in the map (not yet reconciled) or nothing
 * clears the floor — the route reads an empty list as "omit the section".
 */
export function nearestNeighbors(
  slug: string,
  embeddings: Map<string, number[]>,
  params: NeighborParams = DEFAULT_NEIGHBOR_PARAMS,
): string[] {
  const self = embeddings.get(slug);
  if (!self) return [];
  const scored: { slug: string; sim: number }[] = [];
  for (const [candidate, vec] of embeddings) {
    if (candidate === slug) continue; // exclude the recipe itself
    const sim = cosineSimilarity(self, vec);
    if (sim >= params.floor) scored.push({ slug: candidate, sim });
  }
  // Descending similarity, tie-broken on slug for a deterministic order.
  scored.sort((a, b) => b.sim - a.sim || a.slug.localeCompare(b.slug));
  return scored.slice(0, Math.max(0, params.k)).map((s) => s.slug);
}
