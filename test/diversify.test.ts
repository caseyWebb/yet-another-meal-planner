import { describe, it, expect } from "vitest";
import {
  diversifySelect,
  weekDiversity,
  coverageGain,
  selectOne,
  admit,
  newDiversifyState,
  normalizeScores,
  seededJitter,
  DEFAULT_DIVERSIFY_PARAMS,
  type DiversifyCandidate,
  type DiversifyParams,
  type DiversifiedPick,
} from "../src/diversify.js";

// A candidate with sensible defaults; override per test. Embeddings are tiny synthetic
// vectors — cosineSimilarity handles any length, and orthogonal vectors read as "distinct".
function c(over: Partial<DiversifyCandidate> & { slug: string }): DiversifyCandidate {
  return {
    title: over.slug,
    protein: null,
    cuisine: null,
    course: ["main"],
    time_total: null,
    score: 0.5,
    embedding: [1, 0, 0],
    ...over,
  };
}

describe("diversifySelect", () => {
  it("λ=1 with caps disabled reduces to top-K by score", () => {
    const cands = [
      c({ slug: "a", score: 0.9, embedding: [1, 0, 0] }),
      c({ slug: "b", score: 0.8, embedding: [0, 1, 0] }),
      c({ slug: "c", score: 0.7, embedding: [0, 0, 1] }),
    ];
    const picks = diversifySelect(cands, 3, 1, {
      lambda: 1,
      proteinCap: null,
      cuisineCap: null,
      courseCap: null,
      jitter: 0,
    });
    expect(picks.map((p) => p.slug)).toEqual(["a", "b", "c"]);
  });

  it("lowering λ spreads apart near-duplicates within the gate", () => {
    const cands = [
      c({ slug: "twin1", score: 1.0, embedding: [1, 0, 0], protein: "chicken" }),
      c({ slug: "twin2", score: 0.95, embedding: [1, 0, 0], protein: "chicken" }),
      c({ slug: "other", score: 0.6, embedding: [0, 1, 0], protein: "beef" }),
    ];
    // λ=1: pure relevance → the two twins win on score.
    const hi = diversifySelect(cands, 2, 1, { lambda: 1, proteinCap: null, jitter: 0 });
    expect(hi.map((p) => p.slug)).toEqual(["twin1", "twin2"]);
    // low λ: the redundant twin is penalized, the distinct dish takes the second slot.
    const lo = diversifySelect(cands, 2, 1, { lambda: 0.3, proteinCap: null, jitter: 0 });
    expect(lo.map((p) => p.slug)).toEqual(["twin1", "other"]);
  });

  it("honors the protein cap and never admits more than allowed", () => {
    const cands = [
      c({ slug: "ch1", score: 0.9, protein: "chicken", embedding: [1, 0, 0] }),
      c({ slug: "ch2", score: 0.85, protein: "chicken", embedding: [0, 1, 0] }),
      c({ slug: "ch3", score: 0.8, protein: "chicken", embedding: [0, 0, 1] }),
      c({ slug: "bf1", score: 0.5, protein: "beef", embedding: [1, 1, 0] }),
    ];
    const picks = diversifySelect(cands, 4, 1, { lambda: 0.7, proteinCap: 2, cuisineCap: null, jitter: 0 });
    expect(picks.filter((p) => p.protein === "chicken").length).toBeLessThanOrEqual(2);
    expect(picks.some((p) => p.protein === "beef")).toBe(true);
    // 2 chicken (cap) + 1 beef; the 3rd chicken is excluded → a genuine short slot.
    expect(picks.length).toBe(3);
  });

  it("leaves null-protein recipes uncapped", () => {
    const cands = [
      c({ slug: "n1", protein: null, embedding: [1, 0, 0], score: 0.9 }),
      c({ slug: "n2", protein: null, embedding: [0, 1, 0], score: 0.8 }),
    ];
    expect(diversifySelect(cands, 2, 1, { proteinCap: 1, jitter: 0 }).length).toBe(2);
  });

  it("is deterministic for a fixed seed and varies across seeds", () => {
    const cands = [
      c({ slug: "x", score: 0.5, embedding: [1, 0, 0] }),
      c({ slug: "y", score: 0.5, embedding: [0, 1, 0] }),
      c({ slug: "z", score: 0.5, embedding: [0, 0, 1] }),
    ];
    expect(diversifySelect(cands, 3, 7).map((p) => p.slug)).toEqual(
      diversifySelect(cands, 3, 7).map((p) => p.slug),
    );
    const firsts = new Set<string>();
    for (let s = 1; s <= 20; s++) firsts.add(diversifySelect(cands, 1, s)[0].slug);
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("returns fewer than n (or empty) when the caps/pool cannot supply more", () => {
    expect(diversifySelect([], 3)).toEqual([]);
    const chicken = [
      c({ slug: "a", protein: "chicken", embedding: [1, 0, 0], score: 0.9 }),
      c({ slug: "b", protein: "chicken", embedding: [0, 1, 0], score: 0.8 }),
      c({ slug: "c", protein: "chicken", embedding: [0, 0, 1], score: 0.7 }),
    ];
    expect(diversifySelect(chicken, 3, 1, { proteinCap: 1, jitter: 0 }).length).toBe(1);
  });
});

describe("weekDiversity", () => {
  it("counts distinct facets and the tightest pairwise similarity", () => {
    const emb = new Map<string, number[]>([
      ["a", [1, 0, 0]],
      ["b", [1, 0, 0]],
      ["c", [0, 1, 0]],
    ]);
    const d = weekDiversity(
      [
        { slug: "a", protein: "chicken", cuisine: "italian" },
        { slug: "b", protein: "chicken", cuisine: "french" },
        { slug: "c", protein: "beef", cuisine: "thai" },
      ],
      emb,
    );
    expect(d.distinctProteins).toBe(2);
    expect(d.distinctCuisines).toBe(3);
    expect(d.maxPairwiseSim).toBeCloseTo(1); // a and b are identical vectors
  });
});

// --- Holistic at-risk coverage (holistic-use-it-up) -------------------------------------------
//
// selectOne competes coverage against NORMALIZED pool scores, exactly as the planner does, so
// these drive selectOne directly with a seeded demand multiset threaded through ONE state — the
// mirror of assembleProposal's cross-slot fill.

/** Fill each pool with one pick, threading ONE state seeded with `demand` — the planner's loop. */
function fillSlots(
  pools: DiversifyCandidate[][],
  demand: Record<string, number>,
  params: Partial<DiversifyParams> = {},
  seed = 1,
): { picks: (DiversifiedPick | null)[]; state: ReturnType<typeof newDiversifyState> } {
  const p: DiversifyParams = { ...DEFAULT_DIVERSIFY_PARAMS, ...params };
  const state = newDiversifyState();
  for (const [k, v] of Object.entries(demand)) state.remainingAtRisk.set(k, v);
  const jitter = seededJitter(pools.flat(), seed, p.jitter);
  const picks = pools.map((pool) => selectOne(pool, state, p, normalizeScores(pool), jitter));
  return { picks, state };
}

describe("holistic at-risk coverage", () => {
  it("prefers an at-risk cover over an equally-relevant non-cover", () => {
    const pool = [
      c({ slug: "distractor", score: 0.8, embedding: [1, 0, 0] }),
      c({ slug: "uses-beef", score: 0.8, embedding: [0, 1, 0], perishable_ingredients: ["ground beef"] }),
    ];
    const { picks } = fillSlots([pool], { "ground beef": 1 });
    expect(picks[0]?.slug).toBe("uses-beef");
    expect(picks[0]?.claimed).toEqual(["ground beef"]);
  });

  it("splits a multi-serving item across two mains, decrementing to zero", () => {
    // Two slots, each a distractor + a distinct ground-beef cover, equal score. Coverage flips
    // both slots to the covers; the count-2 demand is claimed twice, once per main.
    const slot1 = [
      c({ slug: "d1", score: 0.8, embedding: [1, 0, 0] }),
      c({ slug: "beef1", score: 0.8, embedding: [0, 1, 0], perishable_ingredients: ["ground beef"] }),
    ];
    const slot2 = [
      c({ slug: "d2", score: 0.8, embedding: [1, 0, 0] }),
      c({ slug: "beef2", score: 0.8, embedding: [0, 0, 1], perishable_ingredients: ["ground beef"] }),
    ];
    const { picks, state } = fillSlots([slot1, slot2], { "ground beef": 2 });
    expect(picks.map((p) => p?.slug)).toEqual(["beef1", "beef2"]);
    expect(picks.flatMap((p) => p?.claimed ?? [])).toEqual(["ground beef", "ground beef"]);
    expect(state.remainingAtRisk.get("ground beef")).toBe(0);
  });

  it("credits a single-count item to only one main", () => {
    const slot1 = [
      c({ slug: "d1", score: 0.8, embedding: [1, 0, 0] }),
      c({ slug: "cilantro1", score: 0.8, embedding: [0, 1, 0], perishable_ingredients: ["cilantro"] }),
    ];
    const slot2 = [
      c({ slug: "d2", score: 0.8, embedding: [0, 0, 1] }),
      c({ slug: "cilantro2", score: 0.8, embedding: [0, 1, 1], perishable_ingredients: ["cilantro"] }),
    ];
    const { picks, state } = fillSlots([slot1, slot2], { cilantro: 1 });
    // Exactly one main claims cilantro; the demand is fully consumed.
    expect(picks.flatMap((p) => p?.claimed ?? []).filter((x) => x === "cilantro").length).toBe(1);
    expect(state.remainingAtRisk.get("cilantro")).toBe(0);
  });

  it("saturates the per-candidate gain so a hoarder can't run away", () => {
    // overlapCap=2: three perishable hits weigh 3.0 but saturate to gain 1.0 — same as two hits.
    const p = DEFAULT_DIVERSIFY_PARAMS;
    const demand = new Map([["a", 1], ["b", 1], ["c", 1]]);
    const three = coverageGain(c({ slug: "x", perishable_ingredients: ["a", "b", "c"] }), demand, p);
    const two = coverageGain(c({ slug: "y", perishable_ingredients: ["a", "b"] }), demand, p);
    expect(three.gain).toBe(1); // min(3,2)/2
    expect(two.gain).toBe(1); //  min(2,2)/2
    expect(three.claimed).toEqual(["a", "b", "c"]); // but it still CONSUMES all three
  });

  it("weighs a key-tier match below a perishable-tier match", () => {
    const p = DEFAULT_DIVERSIFY_PARAMS;
    const demand = new Map([["lemon", 1]]);
    const perish = coverageGain(c({ slug: "p", perishable_ingredients: ["lemon"] }), demand, p);
    const keyOnly = coverageGain(c({ slug: "k", ingredients_key: ["lemon"] }), demand, p);
    expect(perish.gain).toBeGreaterThan(keyOnly.gain); // 1.0/2 vs 0.4/2
    expect(keyOnly.claimed).toEqual(["lemon"]); // still claimed (it uses the item)
  });

  it("coverageWeight=0 reduces exactly to plain MMR (no use-it-up)", () => {
    // With spread from a filler, the distractor out-scores the cover; coverage would flip it,
    // but weight 0 leaves the relevance order intact.
    const pool = [
      c({ slug: "distractor", score: 0.9, embedding: [1, 0, 0] }),
      c({ slug: "uses-beef", score: 0.85, embedding: [0, 1, 0], perishable_ingredients: ["ground beef"] }),
      c({ slug: "filler", score: 0.5, embedding: [0, 0, 1] }),
    ];
    const off = fillSlots([pool], { "ground beef": 1 }, { coverageWeight: 0 });
    expect(off.picks[0]?.slug).toBe("distractor");
    const on = fillSlots([pool], { "ground beef": 1 }); // default weight overcomes the small gap
    expect(on.picks[0]?.slug).toBe("uses-beef");
  });

  it("is deterministic given a seed", () => {
    const pools = [
      [c({ slug: "d1", score: 0.8, embedding: [1, 0, 0] }), c({ slug: "beef1", score: 0.8, embedding: [0, 1, 0], perishable_ingredients: ["ground beef"] })],
      [c({ slug: "d2", score: 0.8, embedding: [1, 0, 0] }), c({ slug: "beef2", score: 0.8, embedding: [0, 0, 1], perishable_ingredients: ["ground beef"] })],
    ];
    const a = fillSlots(pools, { "ground beef": 2 }, {}, 42);
    const b = fillSlots(pools, { "ground beef": 2 }, {}, 42);
    expect(a.picks.map((p) => p?.slug)).toEqual(b.picks.map((p) => p?.slug));
    expect(a.picks.flatMap((p) => p?.claimed ?? [])).toEqual(b.picks.flatMap((p) => p?.claimed ?? []));
  });

  it("admit (a locked pick) consumes its at-risk items too", () => {
    const state = newDiversifyState();
    state.remainingAtRisk.set("salmon", 1);
    const claimed = admit(state, c({ slug: "locked-salmon", perishable_ingredients: ["salmon"] }));
    expect(claimed).toEqual(["salmon"]);
    expect(state.remainingAtRisk.get("salmon")).toBe(0);
  });

  it("has no coverage effect when there is no demand", () => {
    const pool = [
      c({ slug: "distractor", score: 0.9, embedding: [1, 0, 0] }),
      c({ slug: "uses-beef", score: 0.85, embedding: [0, 1, 0], perishable_ingredients: ["ground beef"] }),
      c({ slug: "filler", score: 0.5, embedding: [0, 0, 1] }),
    ];
    const { picks } = fillSlots([pool], {}); // empty demand → plain relevance order
    expect(picks[0]?.slug).toBe("distractor");
    expect(picks[0]?.claimed).toEqual([]);
  });
});
