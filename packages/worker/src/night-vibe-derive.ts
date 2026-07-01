// Pure archetype-DERIVATION engine (night-vibe-archetype-derivation capability). Clusters a
// member's taste-space (their favorited + recently-cooked recipe vectors) into archetype
// groups, infers a cadence for each from the group's observed cook interval, and drops any
// group already covered by an existing palette vibe. The naming (cluster → vibe phrase) is a
// small-model step wired in the tool/cron layer — this module is pure numerics + injected
// inputs, so it is unit-testable off `workerd`, exactly like diversify.ts / semantic-search.ts.
//
// This is the "capture" half the reconcile loop was missing: derive archetypes from behavior,
// name them (capture), enqueue as add_vibe proposals; the member confirms and the palette grows.

import { cosineSimilarity } from "./embedding.js";
import { mulberry32 } from "./rng.js";
import { slugify } from "./discovery.js";
import type { WeatherCategory } from "./weather.js";

/** One recipe in the member's taste-space: its vector plus the dates it was cooked (for cadence). */
export interface TasteItem {
  slug: string;
  embedding: number[];
  /** YYYY-MM-DD cook dates for this recipe (empty/absent when never cooked, e.g. a favorite). */
  cookDates?: string[];
  /** The recipe's AI description (the naming step's grounding text). */
  description?: string;
}

/** One derived archetype — a cluster of similar recipes with a centroid + inferred cadence. */
export interface ArchetypeCluster {
  /** Unit centroid of the cluster (the retrieval anchor + dedup key). */
  centroid: number[];
  members: TasteItem[];
  /** Inferred `cadence_days` from the members' pooled cook dates, or null when too sparse. */
  cadence_days: number | null;
}

/** Tunable knobs — deliberately conservative to avoid over-generating vibes (Open Questions). */
export interface DeriveParams {
  /** Drop a cluster whose centroid is within this cosine of an existing palette vibe. */
  dedupThreshold: number;
  /** Ignore a cluster with fewer than this many members (noise / one-offs). */
  minClusterSize: number;
  /** Upper bound on k (archetypes per member) so a week stays flexible, not robotic. */
  maxK: number;
}

export const DEFAULT_DERIVE_PARAMS: DeriveParams = {
  dedupThreshold: 0.85,
  minClusterSize: 2,
  maxK: 8,
};

function normalize(v: number[]): number[] {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  return mag > 0 ? v.map((x) => x / mag) : v;
}

function mean(vs: number[][]): number[] {
  const d = vs[0].length;
  const out = new Array<number>(d).fill(0);
  for (const v of vs) for (let i = 0; i < d; i++) out[i] += v[i];
  for (let i = 0; i < d; i++) out[i] /= vs.length;
  return out;
}

/** Choose k sized to the taste-space footprint: ~sqrt(n/2), clamped to [2, maxK], never > n. */
export function chooseK(n: number, maxK = DEFAULT_DERIVE_PARAMS.maxK): number {
  if (n <= 2) return Math.max(1, n);
  return Math.min(n, Math.max(2, Math.min(maxK, Math.round(Math.sqrt(n / 2)))));
}

/**
 * Seeded spherical k-means (k-means++ init) over unit vectors — cosine similarity is the metric
 * (assign to the nearest centroid by cosine; centroid = re-normalized mean). Deterministic given
 * `seed`; ties break to the lowest cluster index. Returns `assignment[i]` = cluster id. When
 * `k >= n`, each point is its own cluster.
 */
export function kmeans(vectors: number[][], k: number, seed: number, maxIter = 25): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (k >= n) return vectors.map((_, i) => i);
  const rng = mulberry32(seed);

  // k-means++ seeding: first centroid uniformly, each next weighted by squared cosine-distance.
  const centroids: number[][] = [vectors[Math.floor(rng() * n)]];
  while (centroids.length < k) {
    const d2 = vectors.map((v) => {
      let best = -Infinity;
      for (const c of centroids) {
        const s = cosineSimilarity(v, c);
        if (s > best) best = s;
      }
      const dist = 1 - best;
      return dist * dist;
    });
    const sum = d2.reduce((a, b) => a + b, 0);
    let r = rng() * (sum || 1);
    let idx = 0;
    for (; idx < n - 1; idx++) {
      r -= d2[idx];
      if (r <= 0) break;
    }
    centroids.push(vectors[idx]);
  }

  const assign = new Array<number>(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = -Infinity;
      let bi = 0;
      for (let c = 0; c < centroids.length; c++) {
        const s = cosineSimilarity(vectors[i], centroids[c]);
        if (s > best) {
          best = s;
          bi = c;
        }
      }
      if (assign[i] !== bi) {
        assign[i] = bi;
        changed = true;
      }
    }
    for (let c = 0; c < centroids.length; c++) {
      const members = vectors.filter((_, i) => assign[i] === c);
      if (members.length) centroids[c] = normalize(mean(members));
    }
    if (!changed) break;
  }
  return assign;
}

/**
 * Cluster a member's taste-space into archetypes. Normalizes vectors, runs seeded k-means
 * (k from `chooseK` unless overridden), drops clusters below `minClusterSize`, and computes each
 * surviving cluster's centroid + inferred cadence. Deterministic given `seed`; clusters are
 * returned biggest-first (with a slug tiebreak) so the strongest archetypes lead.
 */
export function clusterTasteSpace(
  items: TasteItem[],
  seed: number,
  params: Partial<DeriveParams> & { k?: number } = {},
): ArchetypeCluster[] {
  const p: DeriveParams = { ...DEFAULT_DERIVE_PARAMS, ...params };
  if (items.length === 0) return [];
  const normed = items.map((it) => normalize(it.embedding));
  const k = params.k ?? chooseK(items.length, p.maxK);
  const assign = kmeans(normed, k, seed);

  const byCluster = new Map<number, TasteItem[]>();
  assign.forEach((c, i) => {
    const arr = byCluster.get(c) ?? [];
    arr.push(items[i]);
    byCluster.set(c, arr);
  });

  const clusters: ArchetypeCluster[] = [];
  for (const [, members] of [...byCluster.entries()].sort((a, b) => a[0] - b[0])) {
    if (members.length < p.minClusterSize) continue;
    const centroid = normalize(mean(members.map((m) => normalize(m.embedding))));
    const dates = members.flatMap((m) => m.cookDates ?? []);
    clusters.push({ centroid, members, cadence_days: inferCadence(dates) });
  }
  clusters.sort((a, b) => b.members.length - a.members.length || a.members[0].slug.localeCompare(b.members[0].slug));
  return clusters;
}

/** Infer a cadence (days) from a set of cook dates: the median gap between consecutive cooks,
 *  rounded, floored at 1. Null when fewer than two distinct dates (too sparse to estimate). */
export function inferCadence(cookDates: string[]): number | null {
  const days = [...new Set(cookDates)]
    .map((d) => Date.parse(d.length <= 10 ? `${d}T00:00:00Z` : d))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (days.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push((days[i] - days[i - 1]) / 86_400_000);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.max(1, Math.round(median));
}

/** Drop clusters whose centroid is already covered by an existing palette vibe (cosine ≥ the
 *  dedup threshold) — so derivation never proposes a vibe the member already has. */
export function dedupeClusters(
  clusters: ArchetypeCluster[],
  paletteVectors: number[][],
  threshold = DEFAULT_DERIVE_PARAMS.dedupThreshold,
): ArchetypeCluster[] {
  return clusters.filter((cl) => !paletteVectors.some((pv) => cosineSimilarity(cl.centroid, pv) >= threshold));
}

/** A named candidate archetype — the add_vibe proposal payload (before enqueue). */
export interface DerivedArchetype {
  id: string;
  vibe: string;
  cadence_days: number | null;
  /** Discrete weather bucket membership from the naming pass's classification (weather-bucket-
   *  planning) — a one-element category array, or absent when neutral/unclassified (bucketless,
   *  fail-soft default). Written verbatim into the `add_vibe` proposal's `weather_affinity`. */
  weather_affinity?: WeatherCategory[];
  /** Which member recipes formed this cluster + its size (proposal evidence). */
  evidence: { member_slugs: string[]; size: number };
}

/** The naming step, injected so the orchestration is testable without `env.AI`. */
export interface DeriveDeps {
  /** Name a cluster from its members' descriptions + the inferred cadence (and classify its
   *  weather bucket in the same call), or null to skip it. */
  name(input: {
    descriptions: string[];
    cadence_days: number | null;
  }): Promise<{ vibe: string; cadence_days: number | null; weather_affinity?: WeatherCategory[] } | null>;
}

/**
 * End-to-end archetype derivation: cluster the taste-space, drop clusters already covered by the
 * palette, cap to `maxProposals` (biggest-first), and NAME each surviving cluster into a candidate
 * vibe + weather bucket (via the injected small-model dep, one call per cluster). Returns the
 * `add_vibe` candidates. Deterministic in the clustering/dedup; the naming is the only
 * non-deterministic (model) step, injected so this orchestration is unit-testable with a fake
 * namer.
 */
export async function deriveArchetypes(
  items: TasteItem[],
  paletteVectors: number[][],
  seed: number,
  deps: DeriveDeps,
  params: Partial<DeriveParams> & { k?: number; maxProposals?: number } = {},
): Promise<DerivedArchetype[]> {
  const p: DeriveParams = { ...DEFAULT_DERIVE_PARAMS, ...params };
  const clusters = dedupeClusters(clusterTasteSpace(items, seed, params), paletteVectors, p.dedupThreshold);
  const capped = params.maxProposals != null ? clusters.slice(0, params.maxProposals) : clusters;

  const out: DerivedArchetype[] = [];
  for (const cl of capped) {
    const descriptions = cl.members.map((m) => m.description).filter((d): d is string => typeof d === "string" && d.length > 0);
    const named = await deps.name({ descriptions, cadence_days: cl.cadence_days });
    const vibe = named?.vibe.trim();
    if (!vibe) continue;
    const id = slugify(vibe);
    if (!id) continue;
    const archetype: DerivedArchetype = {
      id,
      vibe,
      cadence_days: named?.cadence_days ?? cl.cadence_days,
      evidence: { member_slugs: cl.members.map((m) => m.slug), size: cl.members.length },
    };
    // Fail-soft: a missing/neutral classification simply omits weather_affinity → bucketless,
    // never blocks the derived vibe itself from being proposed.
    if (named?.weather_affinity && named.weather_affinity.length > 0) archetype.weather_affinity = named.weather_affinity;
    out.push(archetype);
  }
  return out;
}
