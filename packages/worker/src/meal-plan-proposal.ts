// The two-level propose_meal_plan planner core (meal-plan-proposal capability). PURE — the
// tool wrapper loads context (palette, vectors, index, embeddings, favorites, weather, pantry),
// samples the week shape (Level 1, night-vibe-schedule.ts), ranks each slot's candidates
// (Level 2, semantic-search.ts), and hands the assembled inputs here for the cross-slot
// diversify + plate composition. Keeping this pure makes the compose logic unit-testable
// off `workerd`, exactly like semantic-search.ts.

import {
  DEFAULT_DIVERSIFY_PARAMS,
  admit,
  newDiversifyState,
  normalizeScores,
  selectOne,
  seededJitter,
  weekDiversity,
  type DiversifyCandidate,
  type DiversifyParams,
} from "./diversify.js";
import { cosineSimilarity } from "./embedding.js";
import type { WeekSlot } from "./night-vibe-schedule.js";
import type { WeatherCategory } from "./weather.js";

/** A corpus side attached to a main (rung-1 `pairs_with`). */
export interface ProposedSide {
  slug: string;
  title: string;
}

/** One swap-menu candidate: a compact lite row from the slot's ranked pool. */
export interface AlternateLite {
  slug: string;
  title: string;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
}

/** The chosen main for a slot (compact — what the surface renders). */
export interface ProposedMain {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
  score: number;
}

/** One shaped-and-filled slot. `main: null` is an EXPLICIT empty slot (never silently dropped). */
export interface ProposedSlot {
  vibe_id: string | null;
  reason: "pinned" | "overdue" | "sampled" | "locked";
  main: ProposedMain | null;
  empty_reason?: string;
  /** Swap material from this slot's already-computed ranked pool (member-app-propose D3),
   *  week-deduped and gate-surviving by construction — no extra retrieval. Top-6 by pool
   *  rank; `[]` on vibe-less locked slots (no pool). An EMPTY vibe slot keeps its pool's
   *  alternates (the escape hatch for an over-constrained night). */
  alternates: AlternateLite[];
  /** The remaining pool candidate nearest by cosine to the chosen main ("something
   *  similar"); null when the pool is exhausted or the slot has no main. */
  alt_similar: AlternateLite | null;
  /** The highest-ranked remaining candidate of a DIFFERENT cuisine than the main; null
   *  when none qualifies or the slot has no main. */
  alt_different: AlternateLite | null;
  /** Present (true) when this slot's query vector came from a `slots[].vibe` override. */
  vibe_override?: true;
  /** Present (true) when the main was pinned via `slots[].recipe` (identity-preserving). */
  recipe_pinned?: true;
  /** The non-`mild` weather-category quota that placed this sampled slot (D9) — also
   *  folded into `why[]`. Absent on pinned/overdue/flex/locked slots. */
  weather_category?: WeatherCategory;
  sides: ProposedSide[];
  /** The at-risk items this main actually CLAIMED (decremented from the demand) — what it uses up,
   *  not merely any perishable it lists (holistic use-it-up). */
  uses_perishables: string[];
  flags: {
    /** Alias-resolved perishables (canonical ids, the same form as `uses_perishables`) this main
     *  uses that no other proposed main shares (single-use waste risk). */
    waste?: string[];
    /** The recipe keeps well / batches (`meal_preppable`). */
    meal_prep?: boolean;
    /** Never cooked by the caller. */
    novel?: boolean;
    /** No corpus side (`pairs_with`) was found — the surface may add an open-world side. */
    no_corpus_side?: boolean;
  };
  /** Human-readable reasons this main was chosen (legibility). */
  why: string[];
}

export interface ProposalResult {
  plan: ProposedSlot[];
  variety: {
    distinct_proteins: number;
    distinct_cuisines: number;
    mean_pairwise_sim: number;
    max_pairwise_sim: number;
  };
  /** At-risk items the assembled plan did NOT cover (residual demand > 0) — the honest "still
   *  going bad" signal, so the caller can re-roll, lock, or shop around them. Empty when the plan
   *  covers everything (or there was no at-risk demand). */
  uncovered_at_risk: string[];
  diagnostics: { seed: number; lambda: number; nights: number; filled: number; empty: number };
}

/** The fully-loaded, pure inputs the compose needs (assembled by the tool). */
export interface ProposalCtx {
  /** Level-1 sampled slots to fill (from `sampleWeek`), in fill order. */
  slots: WeekSlot[];
  /** Each vibe's ranked candidate pool (Level-2), by vibe id. */
  poolByVibe: Map<string, DiversifyCandidate[]>;
  /** Locked picks the caller pinned — pre-seeded into the diversify state and returned first. */
  locked?: DiversifyCandidate[];
  /** Raw lock slugs that couldn't be resolved (unknown / unembedded / rejected) — surfaced as
   *  explicit empty `locked` slots so a lock is never silently dropped. */
  lockedUnresolved?: string[];
  /** The nights the caller requested (for honest diagnostics when locks/palette under-fill). */
  requestedNights?: number;
  /** slug → recipe frontmatter (for sides / waste / meal-prep). */
  frontmatterBySlug: Map<string, Record<string, unknown>>;
  /** slug → embedding (for the variety diagnostics). */
  embeddingBySlug: Map<string, number[]>;
  /** The holistic at-risk DEMAND multiset (alias-normalized item → count), derived from the
   *  pantry (+ the `boost_ingredients` override). Seeds the diversify state's `remainingAtRisk`;
   *  each pick's coverage claims decrement it, and the residual is `uncovered_at_risk`. */
  atRiskDemand: Map<string, number>;
  /** slug → last_cooked (YYYY-MM-DD); absent = never cooked (novel). */
  lastCooked: Map<string, string>;
  seed: number;
  params?: Partial<DiversifyParams>;
  /** slot vibe id → extra why hints (e.g. a weather note). */
  whyByVibe?: Map<string, string[]>;
  /** vibe id → the caller's RESOLVED per-slot recipe pin (`slots[].recipe`, D3): admitted
   *  into the diversify state up-front alongside the locks (a fixed pick shapes the whole
   *  week's diversification), then returned in that vibe's slot position with its
   *  `vibe_id`/`reason` intact and `recipe_pinned: true`. A vibe sampled twice consumes
   *  its pin on the FIRST of its slots. */
  pinnedByVibe?: Map<string, DiversifyCandidate>;
  /** vibe id → the raw UNRESOLVABLE pin name (unknown / unembedded / rejected / excluded)
   *  — surfaced as an explicit empty slot with the lock-style reason, never dropped. */
  pinnedUnresolvedByVibe?: Map<string, string>;
  /** vibe ids whose query vector was replaced by a `slots[].vibe` override phrase — the
   *  returned slots are marked `vibe_override: true` (gate + identity unchanged). */
  overriddenVibes?: Set<string>;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Accepts either a raw candidate (locked) or a scored pick — only the shared fields are read. */
type MainSource = Pick<DiversifyCandidate, "slug" | "title" | "protein" | "cuisine" | "time_total" | "score">;

function mainOf(c: MainSource, fm: Record<string, unknown> | undefined): ProposedMain {
  return {
    slug: c.slug,
    title: c.title,
    description: typeof fm?.description === "string" ? fm.description : null,
    protein: c.protein,
    cuisine: c.cuisine,
    time_total: c.time_total,
    score: c.score,
  };
}

/**
 * Assemble a proposal: fill each Level-1 slot with one diverse main (threading ONE diversify
 * state across slots so the protein/cuisine caps + de-duplication span the whole WEEK), then
 * compose each plate (rung-1 `pairs_with` corpus sides), flag single-use perishable waste and
 * meal-prep, and annotate `why`. Deterministic given `seed`. A slot whose pool is empty or
 * can't clear the caps becomes an explicit empty slot (never dropped).
 */
export function assembleProposal(ctx: ProposalCtx): ProposalResult {
  const p: DiversifyParams = { ...DEFAULT_DIVERSIFY_PARAMS, ...ctx.params };
  const locked = ctx.locked ?? [];
  // One jitter function over locked + every pool, so a single seed determines the whole week.
  const union: DiversifyCandidate[] = [...locked];
  for (const pool of ctx.poolByVibe.values()) union.push(...pool);
  const jitter = seededJitter(union, ctx.seed, p.jitter);
  const state = newDiversifyState();
  // Seed the holistic at-risk demand so the cross-slot coverage term can spread it over the week.
  for (const [item, count] of ctx.atRiskDemand) state.remainingAtRisk.set(item, count);

  const chosen: ProposedSlot[] = [];
  /** slug → the chosen candidate's ALIAS-RESOLVED perishable ids, captured at choose time.
   *  The cross-main single-use waste check counts over these — the raw frontmatter strings
   *  would miss sharing across surface forms ("scallions" vs "green onions" are one id). */
  const perishBySlug = new Map<string, string[]>();
  /** Every slot starts with empty swap material; the alternates pass below fills it in. */
  const noSwap = () => ({ alternates: [] as AlternateLite[], alt_similar: null, alt_different: null });

  // Locked picks first — seed the state so the rest diversify away from them (and consume any
  // at-risk items the locked recipe uses, so they aren't re-covered or reported as still at risk).
  for (const lc of locked) {
    const claimed = admit(state, lc, p);
    perishBySlug.set(lc.slug, lc.perishable_ingredients ?? []);
    chosen.push({ vibe_id: null, reason: "locked", main: mainOf(lc, ctx.frontmatterBySlug.get(lc.slug)), ...noSwap(), sides: [], uses_perishables: claimed, flags: {}, why: ["locked"] });
  }
  // Unresolved locks become explicit empty locked slots (never silently dropped).
  for (const raw of ctx.lockedUnresolved ?? []) {
    chosen.push({ vibe_id: null, reason: "locked", main: null, empty_reason: `locked recipe '${raw}' is unavailable (unknown, unembedded, or rejected)`, ...noSwap(), sides: [], uses_perishables: [], flags: {}, why: [] });
  }

  // Recipe pins admit up-front ALONGSIDE the locks (D3): a fixed pick shapes the whole
  // week's diversification, not just the slots after its own. Deterministic order — locks
  // (input order, above), then pins in slot order, one admission per vibe id.
  const pinnedByVibe = ctx.pinnedByVibe ?? new Map<string, DiversifyCandidate>();
  const pinClaims = new Map<string, string[]>();
  for (const slot of ctx.slots) {
    const pin = pinnedByVibe.get(slot.id);
    if (!pin || pinClaims.has(slot.id)) continue;
    pinClaims.set(slot.id, admit(state, pin, p));
  }

  // Then fill the sampled slots.
  const pinConsumed = new Set<string>();
  for (const slot of ctx.slots) {
    const pool = ctx.poolByVibe.get(slot.id) ?? [];
    const why = [...(ctx.whyByVibe?.get(slot.id) ?? [])];
    const marks: Pick<ProposedSlot, "vibe_override" | "weather_category"> = {};
    if (ctx.overriddenVibes?.has(slot.id)) marks.vibe_override = true;
    if (slot.category) marks.weather_category = slot.category;

    // A resolved recipe pin fills this slot with vibe identity intact (`vibe_id`/`reason`
    // unchanged, why leads "your pick"); a vibe sampled twice consumes it once.
    const pin = pinnedByVibe.get(slot.id);
    if (pin && !pinConsumed.has(slot.id)) {
      pinConsumed.add(slot.id);
      perishBySlug.set(pin.slug, pin.perishable_ingredients ?? []);
      chosen.push({ vibe_id: slot.id, reason: slot.reason, main: mainOf(pin, ctx.frontmatterBySlug.get(pin.slug)), ...noSwap(), ...marks, recipe_pinned: true, sides: [], uses_perishables: pinClaims.get(slot.id) ?? [], flags: {}, why: ["your pick", ...why] });
      continue;
    }
    // An unresolvable pin surfaces as an explicit empty slot (lock-style, never dropped);
    // its pool's alternates (filled below) stay as the escape hatch.
    const rawPin = ctx.pinnedUnresolvedByVibe?.get(slot.id);
    if (rawPin !== undefined && !pinConsumed.has(slot.id)) {
      pinConsumed.add(slot.id);
      chosen.push({ vibe_id: slot.id, reason: slot.reason, main: null, empty_reason: `pinned recipe '${rawPin}' is unavailable (unknown, unembedded, rejected, or excluded)`, ...noSwap(), ...marks, sides: [], uses_perishables: [], flags: {}, why });
      continue;
    }

    // Weather legibility (D9): a slot placed by a non-`mild` category quota says so —
    // on planner-picked mains only (a pinned main was the member's choice, not weather's).
    if (slot.category) why.push(`fits this window's ${slot.category} weather`);
    if (pool.length === 0) {
      chosen.push({ vibe_id: slot.id, reason: slot.reason, main: null, empty_reason: "no retrievable candidate for this vibe", ...noSwap(), ...marks, sides: [], uses_perishables: [], flags: {}, why });
      continue;
    }
    const norm = normalizeScores(pool);
    const pick = selectOne(pool, state, p, norm, jitter);
    if (!pick) {
      chosen.push({ vibe_id: slot.id, reason: slot.reason, main: null, empty_reason: "no candidate cleared the variety caps", ...noSwap(), ...marks, sides: [], uses_perishables: [], flags: {}, why });
      continue;
    }
    // The pick is a lite `DiversifiedPick`; its resolved perishables live on its pool candidate.
    perishBySlug.set(pick.slug, pool.find((c) => c.slug === pick.slug)?.perishable_ingredients ?? []);
    chosen.push({ vibe_id: slot.id, reason: slot.reason, main: mainOf(pick, ctx.frontmatterBySlug.get(pick.slug)), ...noSwap(), ...marks, sides: [], uses_perishables: pick.claimed, flags: {}, why });
  }

  // Alternates (D3): per vibe slot, from its ALREADY-COMPUTED ranked pool minus the week's
  // used recipes — no extra retrieval, no re-ranking, deterministic (pool rank + used set,
  // no RNG). Gate survivors by construction (the pool is facet-gated + reject/exclude
  // filtered); they deliberately ignore the MMR caps — a swap is an explicit member choice.
  // Locked slots (vibe-less, no pool) keep the `noSwap()` defaults.
  const liteOf = (c: DiversifyCandidate): AlternateLite => ({ slug: c.slug, title: c.title, protein: c.protein, cuisine: c.cuisine, time_total: c.time_total });
  for (const slot of chosen) {
    if (slot.vibe_id === null) continue;
    const remaining = (ctx.poolByVibe.get(slot.vibe_id) ?? []).filter((c) => !state.usedSlugs.has(c.slug));
    slot.alternates = remaining.slice(0, 6).map(liteOf);
    if (!slot.main) continue; // an empty slot keeps its alternates but has no similarity anchor
    const mainVec = ctx.embeddingBySlug.get(slot.main.slug);
    if (mainVec) {
      let best: DiversifyCandidate | null = null;
      let bestSim = -Infinity;
      for (const c of remaining) {
        const s = cosineSimilarity(c.embedding, mainVec);
        if (s > bestSim) {
          bestSim = s;
          best = c; // strict > keeps the higher pool rank on ties — deterministic
        }
      }
      slot.alt_similar = best ? liteOf(best) : null;
    }
    const diff = remaining.find((c) => c.cuisine !== slot.main!.cuisine);
    slot.alt_different = diff ? liteOf(diff) : null;
  }

  // Compose each plate now that all mains are chosen (waste needs the full set).
  // Which perishables does each chosen main use (for the "single-use" cross-main check)?
  // Counted over the candidates' alias-RESOLVED ids (`perishBySlug`, captured at choose time),
  // so two mains sharing one ingredient under different surface forms count as sharing it.
  const perishUseCount = new Map<string, number>();
  for (const list of perishBySlug.values()) for (const item of new Set(list)) perishUseCount.set(item, (perishUseCount.get(item) ?? 0) + 1);

  for (const slot of chosen) {
    if (!slot.main) continue;
    const fm = ctx.frontmatterBySlug.get(slot.main.slug);
    const perish = perishBySlug.get(slot.main.slug) ?? [];

    // Sides: rung-1 curated pairs_with (corpus sides).
    const pairs = strArray(fm?.pairs_with);
    slot.sides = pairs.map((s) => ({ slug: s, title: titleOf(ctx.frontmatterBySlug.get(s)) ?? s }));
    if (slot.sides.length === 0) slot.flags.no_corpus_side = true;

    // Waste: this main's perishables that NO OTHER proposed main uses (single-use risk).
    const waste = [...new Set(perish)].filter((item) => (perishUseCount.get(item) ?? 0) === 1);
    if (waste.length) slot.flags.waste = waste;

    // Meal-prep.
    if (fm?.meal_preppable === true) slot.flags.meal_prep = true;

    // Novelty.
    if (!ctx.lastCooked.has(slot.main.slug)) {
      slot.flags.novel = true;
      slot.why.push("never cooked before");
    }

    // Use-it-up: `uses_perishables` was set at fill time to the at-risk items this main actually
    // CLAIMED (decremented from the demand) — not merely any perishable it lists. Explain each.
    for (const item of slot.uses_perishables) slot.why.push(`uses your ${item}`);
  }

  const mains = chosen.map((s) => s.main).filter((m): m is ProposedMain => m != null);
  const wd = weekDiversity(
    mains.map((m) => ({ slug: m.slug, protein: m.protein, cuisine: m.cuisine })),
    ctx.embeddingBySlug,
  );

  // Residual: at-risk demand the whole plan couldn't cover (count still > 0) — the honest waste view.
  const uncoveredAtRisk = [...state.remainingAtRisk.entries()].filter(([, n]) => n > 0).map(([item]) => item).sort();

  const plan = chosen;
  const filled = mains.length;
  return {
    plan,
    variety: {
      distinct_proteins: wd.distinctProteins,
      distinct_cuisines: wd.distinctCuisines,
      mean_pairwise_sim: wd.meanPairwiseSim,
      max_pairwise_sim: wd.maxPairwiseSim,
    },
    uncovered_at_risk: uncoveredAtRisk,
    diagnostics: {
      seed: ctx.seed,
      lambda: p.lambda,
      nights: ctx.requestedNights ?? ctx.slots.length + locked.length + (ctx.lockedUnresolved?.length ?? 0),
      filled,
      empty: plan.length - filled,
    },
  };
}

function titleOf(fm: Record<string, unknown> | undefined): string | null {
  return typeof fm?.title === "string" ? fm.title : null;
}
