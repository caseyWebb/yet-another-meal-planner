// The LEVEL-2 "fill the slot" selection for `propose_meal_plan`: Maximal Marginal Relevance
// plus facet-spread caps. Given the candidates for one slot's query — already scored by the
// repo's `rankCandidates` blend (cosine + favorite-affinity + freshness + pantry overlap) —
// pick N recipes that are RELEVANT but VARIED, rather than the top-K by score, which clumps
// into near-duplicates (three near-identical braises, two butter-chicken rows) on a corpus
// whose relevant recipes sit at high pairwise cosine.
//
// No I/O — the tool wrapper supplies the scored candidates + their embeddings + the seed, so
// the scoring is unit-testable (mirrors src/semantic-search.ts). This step only REORDERS and
// SELECTS survivors of the hard gate; it can never admit a recipe the prefilter rejected.
//
// A spike against the real 158-recipe corpus established two things the defaults encode:
//   1. The facet CAPS are the primary diversity lever (they bind for ~89% of anchors); MMR
//      alone barely beats top-K until λ drops so low it pulls in irrelevant dishes. Ship both:
//      caps = coarse categorical spread, MMR = fine semantic de-duplication.
//   2. λ ≈ 0.65 is the sweet spot — variety rises with negligible relevance loss; below ~0.4
//      relevance falls off a cliff (desserts next to savory anchors), so 0.4 is a hard floor.

import { cosineSimilarity } from "./embedding.js";
import { mulberry32 } from "./rng.js";

/** A scored candidate for one slot, with the facets the caps spread over and the embedding
 *  the redundancy penalty uses. Assembled by the caller from the ranked search rows. */
export interface DiversifyCandidate {
  slug: string;
  title: string;
  protein: string | null;
  cuisine: string | null;
  /** The open-vocabulary course array (a recipe counts against every course it lists). */
  course: string[];
  time_total: number | null;
  /** The caller's blended relevance (`rankCandidates` score). */
  score: number;
  /** The recipe's embedding (EMBED_DIM floats) — drives the redundancy penalty. */
  embedding: number[];
  /** Alias-normalized waste-prone ingredients (`perishable_ingredients`) — the PERISHABLE tier
   *  of the holistic at-risk coverage term. Absent/empty → the recipe covers nothing at that
   *  tier (the term is a no-op for it). */
  perishable_ingredients?: string[];
  /** Alias-normalized defining ingredients (`ingredients_key`) — the KEY tier of coverage
   *  (weighs less than perishable). Absent/empty → no key-tier coverage. */
  ingredients_key?: string[];
}

/** One selected pick, annotated with the MMR objective + redundancy at selection time. */
export interface DiversifiedPick {
  slug: string;
  title: string;
  protein: string | null;
  cuisine: string | null;
  course: string[];
  time_total: number | null;
  score: number;
  /** The MMR objective value when this candidate was chosen (for transparency/debug). */
  mmr: number;
  /** Max cosine to any already-picked recipe at selection time (0 for the first pick). */
  redundancy: number;
  /** The at-risk items this pick CLAIMED (decremented from the demand multiset) — what it
   *  actually uses up, for the caller's `uses_perishables` / `why`. Empty when no demand. */
  claimed: string[];
}

/** Tunable knobs for the MMR + facet-spread selection. */
export interface DiversifyParams {
  /** MMR trade-off in [0,1]. 1 = pure relevance (reduces to top-K by score); lower = more
   *  novelty (distance from what's already picked). Floor ~0.4 before relevance degrades. */
  lambda: number;
  /** Max recipes sharing one `protein` value; `null` protein is uncapped ("unknown" is not a
   *  facet to spread). `null` disables the cap. */
  proteinCap: number | null;
  /** Max recipes sharing one `cuisine` value; `null` cuisine uncapped. `null` disables. */
  cuisineCap: number | null;
  /** Max recipes sharing one `course` token. `null` disables (prefer a hard course gate
   *  upstream to keeping desserts out of a mains slot). */
  courseCap: number | null;
  /** Small seeded tie-break noise on the MMR objective so a different seed yields a different
   *  (still valid, still near-optimal) week. Kept small relative to the normalized score. */
  jitter: number;
  /** Weight on the holistic at-risk COVERAGE term (`coverageWeight · cover(c)`, cover ∈ [0,1]).
   *  Big enough that a saturated cover overcomes a MODERATE relevance gap (the spike's passive
   *  +0.12 lost to a ~0.22 gap), small enough that a decisively off-vibe cover still loses. The
   *  primary use-it-up tuning knob. `0` disables coverage (reduces to plain MMR + caps). */
  coverageWeight: number;
  /** Per-item coverage weight when an at-risk item is in the candidate's `perishable_ingredients`
   *  (using an at-risk perishable is the waste-prevention win). Mirrors `RankParams.perishWeight`. */
  perishWeight: number;
  /** Per-item coverage weight when an at-risk item is only in `ingredients_key`. < perishWeight. */
  keyWeight: number;
  /** Saturation ceiling for the summed per-candidate coverage, in perishable-equivalents — so one
   *  item-rich recipe can't run away with every slot. Mirrors `RankParams.overlapCap`. */
  overlapCap: number;
}

export const DEFAULT_DIVERSIFY_PARAMS: DiversifyParams = {
  lambda: 0.65,
  proteinCap: 2,
  cuisineCap: 3,
  courseCap: null,
  jitter: 0.02,
  // Tuning knob (Open Question — task 5.2): with λ=0.65 a saturated 2-item cover contributes
  // ~0.35 to the objective (overcomes a ~0.5 normalized-relevance gap), a 1-item cover ~0.17.
  coverageWeight: 0.35,
  perishWeight: 1.0,
  keyWeight: 0.4,
  overlapCap: 2,
};

/**
 * Normalize the score column to [0,1] so the MMR blend `λ·relevance − (1−λ)·maxSimToPicked`
 * mixes two comparable [0,1] terms (raw scores can exceed 1 via the boosts; cosine is ≤1). A
 * flat column normalizes to all-1. Returns a fresh slug→normScore map.
 */
export function normalizeScores(candidates: DiversifyCandidate[]): Map<string, number> {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candidates) {
    if (c.score < lo) lo = c.score;
    if (c.score > hi) hi = c.score;
  }
  const span = hi - lo;
  const out = new Map<string, number>();
  for (const c of candidates) {
    out.set(c.slug, span > 0 ? (c.score - lo) / span : 1);
  }
  return out;
}

/** Would picking `cand` violate a facet cap given the already-picked tallies? */
function violatesCap(
  cand: DiversifyCandidate,
  params: DiversifyParams,
  proteinCounts: Map<string, number>,
  cuisineCounts: Map<string, number>,
  courseCounts: Map<string, number>,
): boolean {
  if (params.proteinCap != null && cand.protein != null) {
    if ((proteinCounts.get(cand.protein) ?? 0) >= params.proteinCap) return true;
  }
  if (params.cuisineCap != null && cand.cuisine != null) {
    if ((cuisineCounts.get(cand.cuisine) ?? 0) >= params.cuisineCap) return true;
  }
  if (params.courseCap != null) {
    for (const co of cand.course) {
      if ((courseCounts.get(co) ?? 0) >= params.courseCap) return true;
    }
  }
  return false;
}

/** Fold a freshly-picked recipe into the facet tallies. */
function tally(
  cand: DiversifyCandidate,
  proteinCounts: Map<string, number>,
  cuisineCounts: Map<string, number>,
  courseCounts: Map<string, number>,
): void {
  if (cand.protein != null) proteinCounts.set(cand.protein, (proteinCounts.get(cand.protein) ?? 0) + 1);
  if (cand.cuisine != null) cuisineCounts.set(cand.cuisine, (cuisineCounts.get(cand.cuisine) ?? 0) + 1);
  for (const co of cand.course) courseCounts.set(co, (courseCounts.get(co) ?? 0) + 1);
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The running selection state MMR threads across picks — already-chosen recipes (for the
 *  redundancy penalty + dedup) and the facet tallies (for the caps). Shared across a whole
 *  week when the cross-slot fill wants variety spread over the *week*, not within one pool. */
export interface DiversifyState {
  usedSlugs: Set<string>;
  pickedVecs: number[][];
  proteinCounts: Map<string, number>;
  cuisineCounts: Map<string, number>;
  courseCounts: Map<string, number>;
  /** The holistic at-risk DEMAND multiset: alias-normalized item → still-uncovered count. Seeded
   *  from the caller's pantry (perishables, age-weighted, quantity→count) and DECREMENTED as picks
   *  claim items — so a multi-serving item (count > 1) can be claimed by several mains across the
   *  week and a single-count item is credited once. Empty → coverage is a no-op (plain MMR). */
  remainingAtRisk: Map<string, number>;
}

export function newDiversifyState(): DiversifyState {
  return {
    usedSlugs: new Set(),
    pickedVecs: [],
    proteinCounts: new Map(),
    cuisineCounts: new Map(),
    courseCounts: new Map(),
    remainingAtRisk: new Map(),
  };
}

/**
 * The holistic coverage gain for one candidate against the STILL-uncovered demand: sum the tiered
 * weight of each demand item (count > 0) the candidate uses — perishable tier when it's in the
 * recipe's `perishable_ingredients`, else the lower key tier when only in `ingredients_key` —
 * saturate at `overlapCap`, and normalize to [0,1] so `coverageWeight · gain` mixes with the other
 * [0,1] objective terms. Also returns the items CLAIMED (all matched, regardless of saturation —
 * the recipe genuinely consumes them), which the caller decrements + reports. Alias-normalized set
 * membership only — NO vectors. A no-op (0, []) when there's no demand or nothing overlaps.
 */
export function coverageGain(
  cand: DiversifyCandidate,
  remaining: Map<string, number>,
  params: DiversifyParams,
): { gain: number; claimed: string[] } {
  if (remaining.size === 0) return { gain: 0, claimed: [] };
  const perish = new Set(cand.perishable_ingredients ?? []);
  const key = new Set(cand.ingredients_key ?? []);
  let weighted = 0;
  const claimed: string[] = [];
  for (const [item, count] of remaining) {
    if (count <= 0) continue;
    if (perish.has(item)) {
      weighted += params.perishWeight;
      claimed.push(item);
    } else if (key.has(item)) {
      weighted += params.keyWeight;
      claimed.push(item);
    }
  }
  if (claimed.length === 0) return { gain: 0, claimed: [] };
  const cap = params.overlapCap > 0 ? params.overlapCap : 1;
  // Sort so the claimed order (→ uses_perishables / why order) is stable regardless of the demand
  // Map's insertion order (pantry reads have no ORDER BY). The gain is order-independent already.
  claimed.sort();
  return { gain: Math.min(weighted, cap) / cap, claimed };
}

/** Decrement each claimed item's demand by one (floor 0) — the set-cover consumption step. */
function decrementDemand(remaining: Map<string, number>, claimed: string[]): void {
  for (const item of claimed) {
    const cur = remaining.get(item) ?? 0;
    if (cur > 0) remaining.set(item, cur - 1);
  }
}

/**
 * Pick the single best candidate from `pool` under MMR + facet caps, given the running
 * `state`. Mutates `state` with the pick (used slug, picked vector, facet tallies) and returns
 * it — or null when nothing clears the caps / the pool is exhausted. `norm` is the pool's
 * normalized relevance (`normalizeScores`); `jitter(slug)` is the seeded tie-break noise. This
 * is the shared core of both single-pool `diversifySelect` and the cross-slot week fill (which
 * threads ONE state across per-slot pools so protein/cuisine caps and de-duplication span the
 * whole week).
 */
export function selectOne(
  pool: DiversifyCandidate[],
  state: DiversifyState,
  params: DiversifyParams,
  norm: Map<string, number>,
  jitter: (slug: string) => number,
): DiversifiedPick | null {
  let best: DiversifyCandidate | null = null;
  let bestVal = -Infinity;
  let bestRedundancy = 0;
  let bestClaimed: string[] = [];
  for (const c of pool) {
    if (state.usedSlugs.has(c.slug)) continue;
    if (violatesCap(c, params, state.proteinCounts, state.cuisineCounts, state.courseCounts)) continue;
    let redundancy = 0;
    for (const v of state.pickedVecs) {
      const s = cosineSimilarity(c.embedding, v);
      if (s > redundancy) redundancy = s;
    }
    const rel = norm.get(c.slug) ?? 0;
    // Holistic at-risk coverage: an ADDITIVE, bounded term over the still-uncovered demand — it
    // only reorders gate survivors (never admits a gated-out recipe) and stays subordinate to
    // relevance via `coverageWeight` + saturation.
    const { gain, claimed } = coverageGain(c, state.remainingAtRisk, params);
    const val = params.lambda * rel - (1 - params.lambda) * redundancy + params.coverageWeight * gain + jitter(c.slug);
    if (val > bestVal || (val === bestVal && best && c.slug.localeCompare(best.slug) < 0)) {
      bestVal = val;
      best = c;
      bestRedundancy = redundancy;
      bestClaimed = claimed;
    }
  }
  if (!best) return null;
  state.usedSlugs.add(best.slug);
  state.pickedVecs.push(best.embedding);
  tally(best, state.proteinCounts, state.cuisineCounts, state.courseCounts);
  decrementDemand(state.remainingAtRisk, bestClaimed); // consume what this pick claimed
  return {
    slug: best.slug,
    title: best.title,
    protein: best.protein,
    cuisine: best.cuisine,
    course: best.course,
    time_total: best.time_total,
    score: best.score,
    mmr: round4(bestVal),
    redundancy: round4(bestRedundancy),
    claimed: bestClaimed,
  };
}

/** Admit a candidate into the state WITHOUT scoring it — for a locked pick the caller has
 *  already chosen. Marks it used, adds its vector (so later picks diversify away from it), and
 *  folds it into the facet caps. Idempotent-ish: re-admitting a used slug double-counts, so
 *  the caller admits each locked recipe once. */
export function admit(state: DiversifyState, c: DiversifyCandidate, params: DiversifyParams = DEFAULT_DIVERSIFY_PARAMS): DiversifiedPick["claimed"] {
  if (state.usedSlugs.has(c.slug)) return [];
  state.usedSlugs.add(c.slug);
  state.pickedVecs.push(c.embedding);
  tally(c, state.proteinCounts, state.cuisineCounts, state.courseCounts);
  // A locked pick consumes its at-risk items too, so the rest of the week doesn't re-cover them
  // and they aren't falsely reported as still going bad.
  const { claimed } = coverageGain(c, state.remainingAtRisk, params);
  decrementDemand(state.remainingAtRisk, claimed);
  return claimed;
}

/** Build the seeded per-candidate jitter function (stable per slug, seed-determined) over a
 *  candidate set — the tie-break noise that lets a different seed yield a different week. */
export function seededJitter(candidates: DiversifyCandidate[], seed: number, magnitude: number): (slug: string) => number {
  const rng = mulberry32(seed);
  const by = new Map<string, number>();
  for (const c of [...candidates].sort((a, b) => a.slug.localeCompare(b.slug))) {
    by.set(c.slug, (rng() - 0.5) * 2 * magnitude);
  }
  return (slug: string) => by.get(slug) ?? 0;
}

/**
 * Select up to `n` diverse recipes from `candidates` (one slot's pool). Greedy MMR under the
 * facet caps:
 *   pick₁ = argmax normScore (highest relevance that clears the caps)
 *   pickₙ = argmax [ λ·normScore(r) − (1−λ)·maxCos(r, picked) + seededJitter(r) ]
 *           over candidates that clear the facet caps.
 * Deterministic for a fixed seed; a different seed yields a different valid selection. Ties
 * break on slug (after jitter) so behavior is stable when jitter=0.
 *
 * Returns FEWER than `n` only when the caps + pool genuinely can't supply more — a real
 * failure mode the caller must detect (surface a short/empty slot, or relax + re-query).
 */
export function diversifySelect(
  candidates: DiversifyCandidate[],
  n: number,
  seed = 1,
  params: Partial<DiversifyParams> = {},
): DiversifiedPick[] {
  const p: DiversifyParams = { ...DEFAULT_DIVERSIFY_PARAMS, ...params };
  const jitter = seededJitter(candidates, seed, p.jitter);
  const norm = normalizeScores(candidates);
  const state = newDiversifyState();
  const picked: DiversifiedPick[] = [];
  while (picked.length < n) {
    const pick = selectOne(candidates, state, p, norm, jitter);
    if (!pick) break; // caps exhausted the pool — return what we have (a real short-slot case)
    picked.push(pick);
  }
  return picked;
}

/** Diversity metrics for a selected week — the tool's `variety` diagnostics. `meanPairwiseSim`
 *  / `maxPairwiseSim` are cosine over the picked pairs (LOWER = more varied / fewer clones). */
export interface WeekDiversity {
  distinctProteins: number;
  distinctCuisines: number;
  meanPairwiseSim: number;
  maxPairwiseSim: number;
}

export function weekDiversity(
  week: { slug: string; protein: string | null; cuisine: string | null }[],
  embeddingBySlug: Map<string, number[]>,
): WeekDiversity {
  const proteins = new Set<string>();
  const cuisines = new Set<string>();
  for (const r of week) {
    if (r.protein) proteins.add(r.protein);
    if (r.cuisine) cuisines.add(r.cuisine);
  }
  let sum = 0;
  let pairs = 0;
  let max = 0;
  for (let i = 0; i < week.length; i++) {
    for (let j = i + 1; j < week.length; j++) {
      const a = embeddingBySlug.get(week[i].slug);
      const b = embeddingBySlug.get(week[j].slug);
      if (!a || !b) continue;
      const s = cosineSimilarity(a, b);
      sum += s;
      pairs++;
      if (s > max) max = s;
    }
  }
  return {
    distinctProteins: proteins.size,
    distinctCuisines: cuisines.size,
    meanPairwiseSim: pairs ? round4(sum / pairs) : 0,
    maxPairwiseSim: round4(max),
  };
}
