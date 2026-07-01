// The LEVEL-1 "shape the week" leg for `propose_meal_plan`: cadence-as-debt scheduling over a
// per-tenant night-vibe palette. Each night vibe carries a target PERIOD P (days) — "a simple
// pasta ~weekly", "a big project cook ~monthly" — and we track when it was last satisfied
// (slot provenance) so OVERDUE vibes bid harder for this plan's N slots.
//
//   debt(vibe)     = days_since(last_satisfied) / P        (0 = just done, 1 = exactly due)
//   samplingWeight = base · debtCurve(debt)                (debtCurve monotonic + CAPPED, so
//                    an ancient vibe can't monopolize the plan)
//
// `sampleWeek` force-places pinned + high-debt vibes first, then fills the rest by QUOTA:
// weather enters as discrete, mutually-exclusive per-day CATEGORIES (`src/weather.ts`
// `WeatherCategory`: grill / cold-comfort / wet / mild), histogrammed over the window and
// converted to integer slot quotas — NOT a continuous per-vibe multiplier over a flattened tag
// union (that shape destroyed proportion and leaked cross-category boosts; see the
// `weather-bucket-planning` change). Each non-`mild` category's quota is filled from that
// category's member vibes ∪ bucketless vibes (a vibe with no bucket membership is a universal
// filler), ranked by cadence-debt via SEEDED BOUNDED-MULTIPLICITY sampling: each vibe may be
// drawn up to `max(1, floor(window / vibe_period))` times (a weekly-period vibe in a 14-day
// window can legitimately fill 2 slots), with occurrence caps and used-state threaded as ONE pool
// across every category fill — a vibe placed in one category's quota counts against its cap in
// every other quota it's drawn from. A quota with no eligible member, and every `mild`-day slot,
// degrades to the FLEX pool: the whole remaining palette ranked by debt. Over-subscription
// resolves by debt rank; losers roll over (their debt keeps climbing). Deterministic (seed).
//
// A spike against synthetic backlogs surfaced one refinement encoded here: under a realistic
// backlog, force-placed overdue vibes ate every slot and weather never shaped the outcome. So
// PINNED vibes stay sticky (explicit user intent) but OVERDUE force-placement yields
// `minSampledSlots` back to the weighted pool, guaranteeing weather always shapes ≥1 slot. A
// second refinement layers on for buckets: an overdue (but not YET escape-hatch-overdue) vibe
// whose bucket's category has a zero quota this window — "a grill vibe due on a week with no
// grill days" — rolls over rather than force-placing into a mismatched slot ("grill in the
// garage"); once its debt crosses `forceRegardlessAt` (a higher tier than `forceDueAt`), it
// force-places unconditionally, same as any other overdue vibe.
//
// Bucket membership reuses `weather_affinity` (see `resolveBucketMembership`): each stored value
// is read through the same tag→category map `src/weather.ts` uses for a forecast day, so legacy
// weather-vibe tags (`grill-friendly`, `soup`, `no-grill`, …) AND new category names
// (`grill`, `cold-comfort`, `wet`) both resolve to bucket membership with zero data migration. A
// vibe with no (or unrecognized) affinity values is BUCKETLESS — eligible everywhere.
// `weather_antipathy` is not consulted by quota allocation (the hard category exclusion replaces
// graded penalties); the column is read but ignored here.

import { mulberry32 } from "./rng.js";
import { deriveCategory, type WeatherCategory, WEATHER_BUCKETS } from "./weather.js";

/** One night vibe as the scheduler sees it (the palette row's scheduling-relevant fields). */
export interface NightVibeSpec {
  id: string;
  /** Base sampling weight before debt (default 1). */
  base_weight?: number;
  /** Always place this vibe (explicit weekly intent) — outranks debt, immune to the reserve. */
  pinned?: boolean;
  /** Bucket-membership source (reused, back-compat field — see `resolveBucketMembership`):
   *  either legacy weather-vibe tags (`grill-friendly`, `soup`, `no-grill`, …) or new category
   *  names (`grill`, `cold-comfort`, `wet`). Absent/empty/unrecognized → bucketless (universal
   *  filler). Resolved through the same tag→category map a forecast day uses. */
  weather_affinity?: string[];
  /** NOT consulted by quota allocation (the hard category exclusion replaces graded penalties);
   *  read for back-compat only. */
  weather_antipathy?: string[];
  /** Target cadence period in days — the divisor for this vibe's occurrence cap within a
   *  planning window (`max(1, floor(window / cadence_days))`). Absent/null → cap 1. */
  cadence_days?: number | null;
}

/** Tunable knobs for the debt curve and forcing. */
export interface CadenceParams {
  /** Debt at/above which a vibe is force-placed before sampling (hard "overdue"). */
  forceDueAt: number;
  /** Debt at/above which an overdue vibe force-places REGARDLESS of a zero-quota bucket mismatch
   *  (the escape hatch — "so overdue it forces even into the garage"). Always ≥ `forceDueAt`. */
  forceRegardlessAt: number;
  /** debtCurve saturation ceiling — the multiplier an infinitely-overdue vibe reaches. */
  debtCap: number;
  /** debtCurve steepness past the due line (how fast debt→weight ramps once due). */
  debtSteepness: number;
  /** Floor multiplier for a not-yet-due vibe (debt near 0) so it can still surface. */
  debtFloor: number;
  /** Per-matched-weather-vibe bump (weight × (1 + weatherBoost·matches)). Retained only for the
   *  standalone `weatherMultiplier` helper (kept for any external caller); the quota-based
   *  `sampleWeek` allocation does NOT apply it — weather is structural (quotas), not a weight. */
  weatherBoost: number;
  /** Multiplier when a vibe is anti-matched by weather. Same retained-for-`weatherMultiplier`-only
   *  caveat as `weatherBoost`. */
  weatherPenalty: number;
  /** Debt assigned to a never-satisfied vibe (treated as maximally overdue). */
  neverDebt: number;
  /** Slots reserved for weighted sampling that overdue force-placement may NOT consume, so
   *  weather always shapes at least this many slots (pinned vibes are exempt). */
  minSampledSlots: number;
}

export const DEFAULT_CADENCE_PARAMS: CadenceParams = {
  forceDueAt: 1.5,
  forceRegardlessAt: 3,
  debtCap: 4,
  debtSteepness: 1.5,
  debtFloor: 0.25,
  weatherBoost: 0.6,
  weatherPenalty: 0.35,
  neverDebt: 3,
  minSampledSlots: 1,
};

/**
 * Resolve a night vibe's discrete BUCKET membership from `weather_affinity`, back-compat over
 * both value shapes: legacy weather-vibe tags (`soup`, `comfort`, `grill-friendly`, `light`,
 * `no-grill` — the `deriveVibes` vocabulary) and new category names (`grill`, `cold-comfort`,
 * `wet`) both resolve through the SAME `deriveCategory` map, so old and new rows are interpreted
 * identically with zero migration. `mild`/unrecognized entries never contribute a bucket (`mild`
 * isn't a bucket a vibe can be exclusively tied to). Empty/absent/all-unrecognized → bucketless
 * (the empty set) — a universal filler, per the `weather-bucket-planning` contract.
 */
export function resolveBucketMembership(vibe: Pick<NightVibeSpec, "weather_affinity">): Set<WeatherCategory> {
  const out = new Set<WeatherCategory>();
  for (const raw of vibe.weather_affinity ?? []) {
    // A stored category name resolves directly; a legacy tag resolves via the same per-day
    // priority map a forecast day's `meal_vibes` would (a single-tag "day" of just that value).
    const cat: WeatherCategory = (WEATHER_BUCKETS as readonly string[]).includes(raw)
      ? (raw as WeatherCategory)
      : deriveCategory([raw]);
    if (cat !== "mild") out.add(cat);
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Monotonic, capped debt→weight curve.
 *   debt ≤ 0     → debtFloor                                  (just satisfied; barely eligible)
 *   0 < debt < 1 → floor ramping linearly to 1 at the due line
 *   debt ≥ 1     → 1 + (cap−1)·(1 − e^{−k·(debt−1)})          (saturating toward debtCap)
 * Non-decreasing everywhere; never exceeds debtCap. k = debtSteepness.
 */
export function debtCurve(debt: number, params: CadenceParams = DEFAULT_CADENCE_PARAMS): number {
  const p = { ...DEFAULT_CADENCE_PARAMS, ...params };
  if (debt <= 0) return p.debtFloor;
  if (debt < 1) return p.debtFloor + (1 - p.debtFloor) * debt;
  const over = debt - 1;
  return 1 + (p.debtCap - 1) * (1 - Math.exp(-p.debtSteepness * over));
}

/** `days_since(last_satisfied) / period`. Never-satisfied (null) → `neverDebt` (max overdue). */
export function debt(
  lastSatisfiedDay: string | null,
  period: number,
  now: Date,
  neverDebt = DEFAULT_CADENCE_PARAMS.neverDebt,
): number {
  if (lastSatisfiedDay == null) return neverDebt;
  const then = Date.parse(`${lastSatisfiedDay}T00:00:00Z`);
  if (Number.isNaN(then)) return neverDebt;
  const days = Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
  return period > 0 ? days / period : neverDebt;
}

/**
 * Weather multiplier for one vibe. `weatherVibes` is the union of derived meal-vibes across the
 * planning window. `mult = (1 + weatherBoost·favorMatches) · (weatherPenalty if any antipathy
 * match else 1)`. No affinity + no antipathy → neutral 1 (weather-agnostic vibe).
 */
export function weatherMultiplier(
  vibe: NightVibeSpec,
  weatherVibes: string[],
  params: CadenceParams = DEFAULT_CADENCE_PARAMS,
): number {
  const p = { ...DEFAULT_CADENCE_PARAMS, ...params };
  const wset = new Set(weatherVibes);
  let favor = 0;
  for (const w of vibe.weather_affinity ?? []) if (wset.has(w)) favor++;
  let anti = false;
  for (const w of vibe.weather_antipathy ?? []) if (wset.has(w)) anti = true;
  return (1 + p.weatherBoost * favor) * (anti ? p.weatherPenalty : 1);
}

/** A vibe's computed weight + scheduling flags for this week. */
export interface WeightedVibe {
  id: string;
  weight: number;
  debt: number;
  pinned: boolean;
  /** Force-placed before sampling (pinned, or debt ≥ forceDueAt). */
  forced: boolean;
  vibe: NightVibeSpec;
}

/** Compute each vibe's sampling weight: `base · debtCurve(debt)`. `debtByVibe` maps vibe id →
 *  debt (from `debt()`), so satisfaction/provenance stays the caller's concern. Weather is
 *  deliberately NOT a weight term here — `sampleWeek`'s quota-fill applies it structurally (which
 *  category's pool a vibe is even eligible for), not as a graded multiplier on top of debt. */
export function computeWeights(
  palette: NightVibeSpec[],
  debtByVibe: Map<string, number>,
  params: CadenceParams = DEFAULT_CADENCE_PARAMS,
): WeightedVibe[] {
  const p = { ...DEFAULT_CADENCE_PARAMS, ...params };
  return palette.map((vibe) => {
    const d = debtByVibe.get(vibe.id) ?? 0;
    const base = vibe.base_weight ?? 1;
    const weight = base * debtCurve(d, p);
    return { id: vibe.id, weight, debt: d, pinned: !!vibe.pinned, forced: !!vibe.pinned || d >= p.forceDueAt, vibe };
  });
}

/**
 * Seeded weighted sampling WITHOUT replacement of `k` items (each `{ id, weight }`), via the
 * Efraimidis–Spirakis key (`key = u^{1/w}`, take top-k). Exact weighted-without-replacement,
 * deterministic given `rng`. Non-positive weights get an epsilon so they stay last-resort
 * eligible rather than producing NaN.
 */
export function weightedSampleWithoutReplacement<T extends { id: string; weight: number }>(
  items: T[],
  k: number,
  rng: () => number,
): T[] {
  const keyed = items.map((it) => {
    const w = it.weight > 0 ? it.weight : 1e-9;
    const u = Math.max(rng(), 1e-12);
    return { it, key: Math.pow(u, 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key || a.it.id.localeCompare(b.it.id));
  return keyed.slice(0, Math.max(0, k)).map((x) => x.it);
}

/** A vibe's occurrence cap within a planning window: `max(1, floor(window / vibe_period))`.
 *  No period (or a period ≥ the window) → cap 1, the plan's original at-most-once behavior. */
export function occurrenceCap(vibePeriod: number | null | undefined, window: number): number {
  if (vibePeriod == null || vibePeriod <= 0 || window <= 0) return 1;
  return Math.max(1, Math.floor(window / vibePeriod));
}

/** A per-draw cooldown multiplier applied to a vibe's weight right after it's drawn, so a
 *  recurring vibe's occurrences spread across the window rather than clustering adjacently.
 *  Restored to normal (1×) after one draw — a short, local nudge, not a hard exclusion. */
const RECURRENCE_COOLDOWN = 0.15;

/**
 * Seeded BOUNDED-MULTIPLICITY weighted sampling of `k` slots from `items` (each carrying its own
 * `cap` — the max times it may be drawn). Draw-by-draw: each draw runs one Efraimidis–Spirakis
 * pick (`key = u^{1/w}`, top-1) over every vibe whose remaining count is still > 0, then
 * decrements that vibe's remaining count (removing it from the pool only once exhausted) and
 * applies `RECURRENCE_COOLDOWN` to its weight for the *next* draw only, so a just-placed vibe is
 * less likely (not impossible) to land on the immediately following slot. Stops when `k` slots
 * are filled or every ticket is exhausted. Deterministic given `rng`.
 */
export function boundedMultiplicitySample<T extends { id: string; weight: number; cap: number }>(
  items: T[],
  k: number,
  rng: () => number,
): T[] {
  const state = new BoundedMultiplicityState(items);
  return drawBoundedMultiplicity(state, items, k, rng);
}

/**
 * Threaded state for bounded-multiplicity sampling ACROSS multiple calls (multiple category
 * fills) — the occurrence-cap "remaining" counters and the just-drawn cooldown persist across
 * calls on the SAME state, so a vibe placed while filling one category's quota is correctly one
 * draw closer to exhausting its cap in every other quota it's eligible for. A fresh
 * `boundedMultiplicitySample` call (no shared state) is the single-fill special case.
 */
export class BoundedMultiplicityState {
  readonly remaining = new Map<string, number>();
  readonly cooldown = new Map<string, number>();
  constructor(items: { id: string; cap: number }[]) {
    for (const it of items) this.remaining.set(it.id, Math.max(this.remaining.get(it.id) ?? 0, Math.max(0, it.cap)));
  }
}

/** Draw up to `k` items from `items` against a (possibly shared) `BoundedMultiplicityState`,
 *  respecting each item's remaining count and the just-drawn cooldown. See
 *  `boundedMultiplicitySample`'s doc for the per-draw mechanics; this is that function's engine,
 *  factored out so `sampleWeek`'s quota fill can thread ONE state across every category. */
export function drawBoundedMultiplicity<T extends { id: string; weight: number }>(
  state: BoundedMultiplicityState,
  items: T[],
  k: number,
  rng: () => number,
): T[] {
  const out: T[] = [];
  for (let draw = 0; draw < Math.max(0, k); draw++) {
    const eligible = items.filter((it) => (state.remaining.get(it.id) ?? 0) > 0);
    if (eligible.length === 0) break;

    let best: T | null = null;
    let bestKey = -Infinity;
    for (const it of eligible) {
      const mult = state.cooldown.get(it.id) ?? 1;
      const w = it.weight * mult > 0 ? it.weight * mult : 1e-9;
      const u = Math.max(rng(), 1e-12);
      const key = Math.pow(u, 1 / w);
      if (key > bestKey || (key === bestKey && best !== null && it.id.localeCompare(best.id) < 0)) {
        bestKey = key;
        best = it;
      }
    }
    if (!best) break;

    out.push(best);
    state.remaining.set(best.id, (state.remaining.get(best.id) ?? 1) - 1);
    // Cooldown resets each draw (spacing is local, not a permanent penalty); only the
    // just-drawn vibe carries one into the NEXT draw.
    state.cooldown.clear();
    if ((state.remaining.get(best.id) ?? 0) > 0) state.cooldown.set(best.id, RECURRENCE_COOLDOWN);
  }
  return out;
}

/** The reliable-forecast horizon (days) — a day beyond this is more noise than signal, so it's
 *  treated as `mild` rather than categorized (spec: "Weather window bounds at the lesser of the
 *  planning window and forecast reliability"). */
export const RELIABILITY_CAP = 10;

/** Deterministic category order used ONLY as the largest-remainder rounding tie-break — fixed so
 *  two categories with identical fractional remainders always resolve the same way. */
const CATEGORY_ORDER: WeatherCategory[] = ["grill", "cold-comfort", "wet", "mild"];

/**
 * Histogram `dayCategories` (one per planning-window day) into per-category day COUNTS, capping
 * at `RELIABILITY_CAP` days — categories beyond the cap don't count directly, but the excess days
 * still exist as slots to fill, so the caller folds them into `mild` (see `sampleWeek`). Every
 * category in `WEATHER_BUCKETS` plus `mild` is present in the result (0 when absent).
 */
export function histogramCategories(dayCategories: WeatherCategory[]): Record<WeatherCategory, number> {
  const counted = dayCategories.slice(0, RELIABILITY_CAP);
  const hist: Record<WeatherCategory, number> = { grill: 0, "cold-comfort": 0, wet: 0, mild: 0 };
  for (const c of counted) hist[c]++;
  // Days beyond the reliability cap are treated as mild for allocation purposes.
  for (let i = RELIABILITY_CAP; i < dayCategories.length; i++) hist.mild++;
  return hist;
}

/**
 * Convert a day-category histogram into integer slot QUOTAS summing to exactly `slots`, via
 * largest-remainder rounding: each category's exact share is `slots · count / totalDays`; take
 * the floor of each, then distribute the `slots - sum(floors)` leftover one at a time to the
 * categories with the largest fractional remainder, tie-broken by `CATEGORY_ORDER`. An empty
 * histogram (no days) puts the entire quota on `mild` (nothing to mirror — pure flex).
 */
export function computeQuotas(hist: Record<WeatherCategory, number>, slots: number): Record<WeatherCategory, number> {
  const total = CATEGORY_ORDER.reduce((s, c) => s + hist[c], 0);
  const quotas: Record<WeatherCategory, number> = { grill: 0, "cold-comfort": 0, wet: 0, mild: 0 };
  if (slots <= 0) return quotas;
  if (total <= 0) {
    quotas.mild = slots;
    return quotas;
  }
  const exact = CATEGORY_ORDER.map((c) => ({ cat: c, val: (slots * hist[c]) / total }));
  let used = 0;
  for (const { cat, val } of exact) {
    const floor = Math.floor(val);
    quotas[cat] = floor;
    used += floor;
  }
  let leftover = slots - used;
  const byRemainder = exact
    .map(({ cat, val }) => ({ cat, remainder: val - Math.floor(val) }))
    .sort((a, b) => b.remainder - a.remainder || CATEGORY_ORDER.indexOf(a.cat) - CATEGORY_ORDER.indexOf(b.cat));
  for (const { cat } of byRemainder) {
    if (leftover <= 0) break;
    quotas[cat]++;
    leftover--;
  }
  return quotas;
}

/** One placed slot: which vibe, why it landed, and its scheduling signals. */
export interface WeekSlot {
  id: string;
  reason: "pinned" | "overdue" | "sampled";
  debt: number;
  weight: number;
}

export interface SampledWeek {
  slots: WeekSlot[];
  /** Forced vibes that didn't fit (over-subscription, the reserve, or a zero-quota bucket
   *  mismatch before the escape hatch) — roll over to next week. */
  rolledOver: string[];
  /** Every vibe's weight/debt/flags, weight-descending, for diagnostics. */
  weights: { id: string; weight: number; debt: number; forced: boolean; pinned: boolean }[];
  /** Each non-forced vibe's occurrence cap this plan (`max(1, floor(window / vibe_period))`),
   *  for diagnostics/inspection — a forced (pinned/overdue) vibe is placed at most once and
   *  isn't included here (its cardinality isn't governed by the window). */
  occurrenceCaps: { id: string; cap: number }[];
  /** The integer slot quota computed for each category (post-rounding, pre-degrade), for
   *  diagnostics/inspection. */
  quotas: Record<WeatherCategory, number>;
}

/**
 * Shape one plan of `n` vibe slots over a `window`-day planning horizon. `dayCategories` is one
 * `WeatherCategory` per planning-window day (from `deriveCategory`/`dayCategory` in
 * `src/weather.ts`) — the window's weather MIX, not a flattened union. Deterministic given
 * `seed`.
 *   1. Compute weights (debtCurve only — weather is structural below, not a weight term).
 *   2. Place PINNED vibes (debt-desc), up to n — sticky, exempt from the reserve.
 *   3. Place OVERDUE vibes (debt ≥ forceDueAt, debt-desc) up to `n − minSampledSlots` (so the
 *      weighted pool keeps at least `minSampledSlots`). A bucketed overdue vibe whose category's
 *      quota is ZERO this window (histogrammed over the slots that would remain after pinned
 *      placement) rolls over rather than force-placing into a mismatched slot — UNLESS its debt
 *      has crossed `forceRegardlessAt`, the escape hatch, in which case it force-places anyway.
 *      Excess (over-subscribed) overdue vibes also roll over.
 *   4. Fill the remaining slots by QUOTA: histogram the (capped) `dayCategories`, convert to
 *      integer quotas over the actually-remaining slots (largest-remainder rounding), then fill
 *      each non-`mild` category's quota from {members of that bucket} ∪ {bucketless vibes} via
 *      seeded BOUNDED-MULTIPLICITY sampling by debt-weight; a quota with no eligible member (or
 *      the `mild` quota itself) degrades to/draws from the FLEX pool (the whole remaining
 *      palette). Occurrence caps and "already drawn" state are threaded as ONE
 *      `BoundedMultiplicityState` across every category's fill, so a bucketless vibe placed while
 *      filling `grill` correctly counts against its cap when `wet` is filled next.
 *
 * `window` defaults to `n` (the plan's own night count) when omitted, which reproduces the
 * previous at-most-once behavior for every vibe (a period ≥ its own window caps at 1).
 * `dayCategories` defaults to `[]` (no forecast signal → the whole plan is flex, today's
 * debt-only behavior).
 */
export function sampleWeek(
  palette: NightVibeSpec[],
  dayCategories: WeatherCategory[],
  debtByVibe: Map<string, number>,
  n: number,
  seed = 1,
  params: Partial<CadenceParams> = {},
  window?: number,
): SampledWeek {
  const p: CadenceParams = { ...DEFAULT_CADENCE_PARAMS, ...params };
  const rng = mulberry32(seed);
  const weights = computeWeights(palette, debtByVibe, p);
  const effectiveWindow = window ?? n;
  const periodById = new Map(palette.map((v) => [v.id, v.cadence_days ?? null]));
  const bucketsById = new Map(palette.map((v) => [v.id, resolveBucketMembership(v)]));
  const hist = histogramCategories(dayCategories);

  const slots: WeekSlot[] = [];
  const used = new Set<string>();
  const rolledOver: string[] = [];

  // How many non-forced vibes could be sampled at all? Only reserve slots for the weighted pool
  // if such a pool exists (an all-forced palette can't reserve — everything is intent/overdue).
  const sampleablePool = weights.filter((w) => !w.forced);
  const reserve = sampleablePool.length > 0 ? Math.min(p.minSampledSlots, n) : 0;

  // Step 2: pinned first (sticky, ignore the reserve), ranked by debt. A pinned vibe is a
  // single force-place per id, not itself repeated.
  const pinned = weights.filter((w) => w.pinned).sort((a, b) => b.debt - a.debt || a.id.localeCompare(b.id));
  for (const w of pinned) {
    if (slots.length < n) {
      slots.push({ id: w.id, reason: "pinned", debt: round4(w.debt), weight: round4(w.weight) });
      used.add(w.id);
    } else {
      rolledOver.push(w.id);
    }
  }

  // Step 3: overdue (non-pinned forced), ranked by debt, but leave `reserve` slots for the pool.
  // A bucketed vibe whose category has a zero quota (checked against the quota computed over the
  // slots that would remain after pinned placement — the same denominator the eventual fill will
  // use once overdue placement is done) rolls over UNLESS it has crossed the escape hatch
  // (`forceRegardlessAt`), in which case it force-places regardless of forecast match.
  // Force-placement cardinality is unaffected by the window — a palette shouldn't declare the
  // same vibe overdue twice, and this is a single force-place per vibe id.
  const gatingQuotas = computeQuotas(hist, Math.max(0, n - pinned.length));
  const overdue = weights
    .filter((w) => w.forced && !w.pinned)
    .sort((a, b) => b.debt - a.debt || a.id.localeCompare(b.id));
  const overdueCap = Math.max(0, n - reserve);
  for (const w of overdue) {
    const buckets = bucketsById.get(w.id) ?? new Set<WeatherCategory>();
    const mismatched = [...buckets].length > 0 && [...buckets].every((cat) => gatingQuotas[cat] === 0);
    const escapeHatch = w.debt >= p.forceRegardlessAt;
    if (mismatched && !escapeHatch) {
      rolledOver.push(w.id); // "grill in the garage" — no matching day this window, not yet urgent enough to force
      continue;
    }
    if (slots.length < overdueCap) {
      slots.push({ id: w.id, reason: "overdue", debt: round4(w.debt), weight: round4(w.weight) });
      used.add(w.id);
    } else {
      rolledOver.push(w.id); // yields to the weather-sampled reserve, or over-subscribed
    }
  }

  // Step 4: fill the rest by QUOTA — histogram → integer quotas over the ACTUALLY remaining
  // slots, then fill each category from its eligible pool (members ∪ bucketless) by seeded
  // bounded-multiplicity sampling, threading ONE state across every category fill so occurrence
  // caps and "already used" status are global, not per-category-fill-local.
  const remaining = n - slots.length;
  const occurrenceCaps: { id: string; cap: number }[] = [];
  const quotas = computeQuotas(hist, Math.max(0, remaining));
  if (remaining > 0) {
    const pool = weights
      .filter((w) => !used.has(w.id) && !w.forced)
      .map((w) => {
        const cap = occurrenceCap(periodById.get(w.id), effectiveWindow);
        occurrenceCaps.push({ id: w.id, cap });
        return { ...w, cap, buckets: bucketsById.get(w.id) ?? new Set<WeatherCategory>() };
      });
    const state = new BoundedMultiplicityState(pool);

    let flexSlots = quotas.mild;
    for (const cat of WEATHER_BUCKETS) {
      const quota = quotas[cat];
      if (quota <= 0) continue;
      // Eligible pool = this category's members ∪ bucketless vibes (a vibe belonging to a
      // DIFFERENT, non-empty bucket set is structurally excluded — not merely de-weighted).
      const eligible = pool.filter((w) => w.buckets.size === 0 || w.buckets.has(cat));
      if (eligible.length === 0) {
        // No eligible member for a > 0 quota: degrade to flex rather than leave slots empty.
        flexSlots += quota;
        continue;
      }
      const drawn = drawBoundedMultiplicity(state, eligible, quota, rng);
      for (const s of drawn) {
        slots.push({ id: s.id, reason: "sampled", debt: round4(s.debt), weight: round4(s.weight) });
        used.add(s.id);
      }
      // Fewer than `quota` were drawable (pool exhausted its caps) — the shortfall joins flex.
      flexSlots += quota - drawn.length;
    }

    if (flexSlots > 0) {
      const flexPool = pool.filter((w) => !used.has(w.id));
      for (const s of drawBoundedMultiplicity(state, flexPool, flexSlots, rng)) {
        slots.push({ id: s.id, reason: "sampled", debt: round4(s.debt), weight: round4(s.weight) });
        used.add(s.id);
      }
    }
  }

  return {
    slots,
    rolledOver,
    weights: weights
      .map((w) => ({ id: w.id, weight: round4(w.weight), debt: round4(w.debt), forced: w.forced, pinned: w.pinned }))
      .sort((a, b) => b.weight - a.weight),
    occurrenceCaps,
    quotas,
  };
}
