// Pure ranking + cache-key derivation for the cookbook site's hybrid (substring +
// semantic) search. No I/O here (mirrors src/semantic-search.ts), so the merge math and
// the cache key are unit-testable without a Workers AI / KV binding; the route
// (src/cookbook.ts) supplies the substring survivors, the embedded candidates, and the
// resolved query vector.
//
// Two tiers, in order:
//   1. SUBSTRING — exact-intent title/tag matches (filterRecipes' `query` facet). Shown
//      in full, alphabetized: these are what the visitor literally asked for.
//   2. SEMANTIC  — every OTHER embedded recipe whose cosine to the query clears a floor,
//      best-first, capped at `k`. The floor cuts the long tail so a nonsense query
//      returns its substring hits (often none) rather than the whole corpus weakly ranked.
// Dedup is by slug across the boundary: a recipe in both tiers shows once, in SUBSTRING.
//
// The surface is anonymous (no caller identity), so ranking is pure cosine — none of the
// per-tenant favorite / freshness / pantry boosts the agent-facing `search_recipes` tool
// applies (src/semantic-search.ts). That coupling is deliberately kept off this page.

import { cosineSimilarity, EMBED_MODEL } from "./embedding.js";
import { hashText } from "./hash.js";

/** One rendered row — the fields a cookbook list item needs. */
export interface CookbookHit {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
}

/** A semantic-tier candidate: a hit plus its recipe embedding (the cosine input). */
export interface EmbeddedCandidate extends CookbookHit {
  embedding: number[];
}

/** Semantic-tier cap. The substring tier is uncapped — every literal match is shown. */
export const COOKBOOK_K = 30;

/**
 * Minimum cosine for a semantic-tier match — a long-tail cutoff, NOT a spec'd constant.
 * `mergeCookbookResults` takes the floor as a parameter so it can be tuned (and tested)
 * independently; this is only the route's default starting point. Conservative because
 * the always-on substring tier already covers literal title/tag matches, so the semantic
 * tier only needs to add genuinely-related vibes. Tune against the live corpus.
 */
export const DEFAULT_SIMILARITY_FLOOR = 0.5;

/** Normalize a query for the cache key + embedding: lowercase, trim, collapse whitespace. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * KV key for a query's cached embedding vector. Keyed by the embedding MODEL and the
 * normalized query, so (a) the route and the cache agree on identity, (b) equivalent
 * queries ("Tacos", " tacos ") share a vector, and (c) changing EMBED_MODEL — and thus
 * the vector dimension — yields a different key, so no stale-dimension vector is reused.
 */
export function queryVectorCacheKey(q: string): string {
  return `cookbook:qvec:${hashText(`${EMBED_MODEL}\n${normalizeQuery(q)}`)}`;
}

/** Title-then-slug ascending — the substring tier's deterministic browse order. */
function byTitleThenSlug(a: CookbookHit, b: CookbookHit): number {
  return a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
}

/**
 * Merge the two tiers into the final ordered, deduped result list. Pure. `substring` is
 * the exact-intent set (shown in full, alphabetized); `candidates` is the embedded pool
 * (every recipe with a vector). When `queryVec` is null/empty — the graceful-degradation
 * path, embedding unavailable — the semantic tier is skipped and the substring tier is
 * returned alone. A slug already in the substring tier is dropped from the semantic tier,
 * so a both-tier match appears exactly once.
 */
export function mergeCookbookResults(
  substring: CookbookHit[],
  candidates: EmbeddedCandidate[],
  queryVec: number[] | null,
  floor: number,
  k: number,
): CookbookHit[] {
  const seen = new Set<string>();
  const subTier: CookbookHit[] = [];
  for (const hit of [...substring].sort(byTitleThenSlug)) {
    if (seen.has(hit.slug)) continue; // dedupe within the substring set
    seen.add(hit.slug);
    subTier.push(hit);
  }

  if (!queryVec || queryVec.length === 0) return subTier;

  const scored: { hit: CookbookHit; sim: number }[] = [];
  for (const c of candidates) {
    if (seen.has(c.slug)) continue; // a both-tier match shows once, in the substring tier
    const sim = cosineSimilarity(queryVec, c.embedding);
    if (sim < floor) continue; // long-tail cutoff
    scored.push({
      hit: { slug: c.slug, title: c.title, description: c.description, protein: c.protein, cuisine: c.cuisine },
      sim,
    });
  }
  // Best-first; break ties on slug so the order is deterministic.
  scored.sort((a, b) => b.sim - a.sim || a.hit.slug.localeCompare(b.hit.slug));

  const semTier = scored.slice(0, Math.max(0, k)).map((s) => s.hit);
  return [...subTier, ...semTier];
}
