import { describe, it, expect } from "vitest";
import {
  daysSince,
  freshnessBoost,
  favoriteAffinity,
  pantryOverlap,
  rankCandidates,
  resolveRankParams,
  DEFAULT_RANK_PARAMS,
  type SearchCandidate,
  type RankParams,
} from "../src/semantic-search.js";
import { filterRecipes, type RecipeIndex } from "../src/recipes.js";
import { mergeOverlay } from "../src/overlay.js";
import type { Overlay } from "../src/overlay.js";

const NOW = new Date("2026-06-24T12:00:00Z");

// A candidate with sensible defaults; override per test.
function cand(over: Partial<SearchCandidate> & { slug: string; embedding: number[] }): SearchCandidate {
  return {
    title: over.slug,
    description: null,
    protein: null,
    cuisine: null,
    time_total: null,
    last_cooked: null,
    ingredients_key: [],
    perishable_ingredients: [],
    ...over,
  };
}

describe("daysSince", () => {
  it("counts whole UTC days, flooring", () => {
    expect(daysSince("2026-06-24", NOW)).toBe(0); // same day
    expect(daysSince("2026-06-09", NOW)).toBe(15);
    expect(daysSince("2026-05-25", NOW)).toBe(30);
  });

  it("is 0 for a future or unparseable date (treated as just-cooked)", () => {
    expect(daysSince("2026-12-01", NOW)).toBe(0);
    expect(daysSince("not-a-date", NOW)).toBe(0);
  });
});

describe("freshnessBoost", () => {
  const p = DEFAULT_RANK_PARAMS; // noveltyBoost 0.1, resurfaceAfterDays 30

  it("boosts a never-cooked recipe by noveltyBoost", () => {
    expect(freshnessBoost(null, NOW, p)).toBeCloseTo(0.1);
  });

  it("is neutral once cooked beyond the resurface window", () => {
    expect(freshnessBoost("2026-05-25", NOW, p)).toBe(0); // 30 days, == window
    expect(freshnessBoost("2026-01-01", NOW, p)).toBe(0); // long ago
  });

  it("demotes a recently-cooked recipe, decaying to 0 at the window edge", () => {
    expect(freshnessBoost("2026-06-24", NOW, p)).toBeCloseTo(-0.1); // today → full demotion
    expect(freshnessBoost("2026-06-09", NOW, p)).toBeCloseTo(-0.05); // 15/30 → half
  });
});

describe("favoriteAffinity", () => {
  it("is 0 with no favorites (cold start)", () => {
    expect(favoriteAffinity([1, 0, 0], [])).toBe(0);
  });

  it("is the MAX cosine to any favorite (nearest-liked, not centroid)", () => {
    const recipe = [1, 0, 0];
    const favs = [
      [0, 1, 0], // cosine 0
      [1, 1, 0], // cosine ~0.707 — the nearest
    ];
    expect(favoriteAffinity(recipe, favs)).toBeCloseTo(Math.SQRT1_2);
  });
});

describe("rankCandidates", () => {
  // Isolate cosine: no favorite/novelty nudges. Pantry weights keep their defaults but
  // every call below passes [] boostItems, so the overlap term is always 0 here.
  const noBoosts: RankParams = { ...DEFAULT_RANK_PARAMS, favoriteWeight: 0, noveltyBoost: 0 };

  it("orders by cosine relevance to the query", () => {
    const query = [1, 0];
    const out = rankCandidates(
      [
        cand({ slug: "far", embedding: [0, 1] }), // cosine 0
        cand({ slug: "near", embedding: [1, 0] }), // cosine 1
      ],
      query,
      [],
      [],
      NOW,
      noBoosts,
      10,
    );
    expect(out.map((r) => r.slug)).toEqual(["near", "far"]);
    expect(out[0].similarity).toBeCloseTo(1);
    expect(out[1].similarity).toBeCloseTo(0);
  });

  it("lets a favorite nudge flip two close candidates (taste direction)", () => {
    const query = [1, 0, 0];
    const params: RankParams = { ...DEFAULT_RANK_PARAMS, noveltyBoost: 0 };
    const out = rankCandidates(
      [
        cand({ slug: "b", embedding: [0.6, 0, 0.8] }), // sim 0.6, no favorite nearby
        cand({ slug: "a", embedding: [0.5, 0.866, 0] }), // sim 0.5, but near the favorite
      ],
      query,
      [[0, 1, 0]], // favorite on the y-axis → close to "a"
      [],
      NOW,
      params,
      10,
    );
    // a: 0.5 + 0.15*0.866 ≈ 0.63 outranks b: 0.6
    expect(out.map((r) => r.slug)).toEqual(["a", "b"]);
  });

  it("surfaces a never-cooked recipe over an identical recently-cooked one", () => {
    const query = [1, 0];
    const out = rankCandidates(
      [
        cand({ slug: "stale", embedding: [1, 0], last_cooked: "2026-06-24" }), // today
        cand({ slug: "fresh", embedding: [1, 0], last_cooked: null }), // never cooked
      ],
      query,
      [],
      [],
      NOW,
      DEFAULT_RANK_PARAMS,
      10,
    );
    expect(out.map((r) => r.slug)).toEqual(["fresh", "stale"]);
  });

  it("caps at k and breaks ties deterministically by slug", () => {
    const query = [1, 0];
    const out = rankCandidates(
      [
        cand({ slug: "c", embedding: [1, 0] }),
        cand({ slug: "a", embedding: [1, 0] }),
        cand({ slug: "b", embedding: [1, 0] }),
      ],
      query,
      [],
      [],
      NOW,
      noBoosts,
      2,
    );
    expect(out.map((r) => r.slug)).toEqual(["a", "b"]); // all tie on score → slug asc, top 2
  });

  it("returns the compact row shape", () => {
    const out = rankCandidates(
      [cand({ slug: "x", title: "X dish", description: "cozy", protein: "beef", cuisine: "thai", time_total: 40, embedding: [1, 0] })],
      [1, 0],
      [],
      [],
      NOW,
      noBoosts,
      10,
    );
    expect(out[0]).toEqual({
      slug: "x",
      title: "X dish",
      description: "cozy",
      protein: "beef",
      cuisine: "thai",
      time_total: 40,
      score: 1,
      similarity: 1,
      pantry_overlap: [],
    });
  });
});

describe("resolveRankParams", () => {
  it("defaults when prefs are null or have no rotation", () => {
    expect(resolveRankParams(null)).toEqual(DEFAULT_RANK_PARAMS);
    expect(resolveRankParams({ stores: {} })).toEqual(DEFAULT_RANK_PARAMS);
  });

  it("reads rotation overrides, keeping the other defaults (incl. pantry weights)", () => {
    const p = resolveRankParams({ rotation: { novelty_boost: 0.2, resurface_after_days: 14 } });
    expect(p).toEqual({ ...DEFAULT_RANK_PARAMS, noveltyBoost: 0.2, resurfaceAfterDays: 14 });
  });

  it("ignores malformed / non-positive rotation values", () => {
    const p = resolveRankParams({ rotation: { novelty_boost: "lots", resurface_after_days: -5 } });
    expect(p).toEqual(DEFAULT_RANK_PARAMS);
  });
});

describe("pantryOverlap", () => {
  const p = DEFAULT_RANK_PARAMS; // perishWeight 1.0, keyWeight 0.4, overlapCap 2, pantryWeight 0.12

  it("is a no-op with no boost items or no overlap", () => {
    const c = cand({ slug: "x", embedding: [1, 0], perishable_ingredients: ["bok choy"] });
    expect(pantryOverlap(c, [], p)).toEqual({ boost: 0, matched: [] });
    expect(pantryOverlap(cand({ slug: "y", embedding: [1, 0] }), ["bok choy"], p)).toEqual({
      boost: 0,
      matched: [],
    });
  });

  it("weights a perishable hit above a key-only hit", () => {
    const perish = cand({ slug: "p", embedding: [1, 0], perishable_ingredients: ["bok choy"] });
    const keyOnly = cand({ slug: "k", embedding: [1, 0], ingredients_key: ["bok choy"] });
    const a = pantryOverlap(perish, ["bok choy"], p);
    const b = pantryOverlap(keyOnly, ["bok choy"], p);
    expect(a.boost).toBeCloseTo(0.12 * (1.0 / 2)); // 0.06
    expect(b.boost).toBeCloseTo(0.12 * (0.4 / 2)); // 0.024
    expect(a.boost).toBeGreaterThan(b.boost);
    expect(a.matched).toEqual(["bok choy"]);
  });

  it("scores an item in BOTH lists at the perishable tier, once", () => {
    const c = cand({
      slug: "c",
      embedding: [1, 0],
      perishable_ingredients: ["lemon"],
      ingredients_key: ["lemon", "garlic"],
    });
    const r = pantryOverlap(c, ["lemon"], p);
    expect(r.boost).toBeCloseTo(0.12 * (1.0 / 2)); // perishable tier, not 1.4
    expect(r.matched).toEqual(["lemon"]);
  });

  it("saturates at overlapCap so extra matches don't keep growing the boost", () => {
    const c = cand({
      slug: "c",
      embedding: [1, 0],
      perishable_ingredients: ["bok choy", "salmon", "cilantro"],
    });
    const r = pantryOverlap(c, ["bok choy", "salmon", "cilantro"], p);
    expect(r.boost).toBeCloseTo(0.12); // 3.0 weighted → capped at 2 → pantryWeight·1
    expect(r.matched).toEqual(["bok choy", "salmon", "cilantro"]);
  });

  it("dedupes repeated boost items", () => {
    const c = cand({ slug: "c", embedding: [1, 0], perishable_ingredients: ["bok choy"] });
    const r = pantryOverlap(c, ["bok choy", "bok choy"], p);
    expect(r.boost).toBeCloseTo(0.12 * (1.0 / 2));
    expect(r.matched).toEqual(["bok choy"]);
  });
});

describe("rankCandidates pantry overlap", () => {
  const query = [1, 0];

  it("ranks a perishable-overlap recipe above an equal-cosine key-only one and reports the hit", () => {
    const out = rankCandidates(
      [
        cand({ slug: "key", embedding: [1, 0], ingredients_key: ["bok choy"] }),
        cand({ slug: "perish", embedding: [1, 0], perishable_ingredients: ["bok choy"] }),
      ],
      query,
      [],
      ["bok choy"],
      NOW,
      DEFAULT_RANK_PARAMS,
      10,
    );
    expect(out.map((r) => r.slug)).toEqual(["perish", "key"]);
    expect(out[0].pantry_overlap).toEqual(["bok choy"]);
    expect(out[1].pantry_overlap).toEqual(["bok choy"]);
  });

  it("nudges but does not lift an off-vibe recipe above genuinely on-vibe ones", () => {
    const out = rankCandidates(
      [
        // on-vibe, no overlap: cosine 1.0
        cand({ slug: "onvibe", embedding: [1, 0] }),
        // off-vibe but matches every boost item: cosine 0, max overlap boost 0.12
        cand({
          slug: "offvibe",
          embedding: [0, 1],
          perishable_ingredients: ["bok choy", "salmon", "cilantro"],
        }),
      ],
      query,
      [],
      ["bok choy", "salmon", "cilantro"],
      NOW,
      DEFAULT_RANK_PARAMS,
      10,
    );
    // 1.0 vs 0 + 0.12 — the saturated boost can't overcome the cosine gap.
    expect(out.map((r) => r.slug)).toEqual(["onvibe", "offvibe"]);
  });

  it("leaves a zero-overlap candidate in the results, unboosted", () => {
    // Zero the novelty boost to isolate: score should equal cosine when nothing overlaps.
    const out = rankCandidates(
      [cand({ slug: "x", embedding: [1, 0] })],
      query,
      [],
      ["bok choy"],
      NOW,
      { ...DEFAULT_RANK_PARAMS, noveltyBoost: 0 },
      10,
    );
    expect(out.map((r) => r.slug)).toEqual(["x"]); // still returned
    expect(out[0].pantry_overlap).toEqual([]);
    expect(out[0].score).toBeCloseTo(out[0].similarity); // no boost applied
  });
});

// recipe_semantic_search computes its candidate set by merging the caller's overlay
// onto the shared index and running filterRecipes (the SAME shared predicate as
// list_recipes) BEFORE ranking. So a rejected recipe is gated out of `survivors` and
// can never become a ranking candidate — this reproduces that gate end-to-end.
describe("recipe_semantic_search reject gate", () => {
  it("a rejected slug is gated out of the survivor set, so it never ranks", () => {
    const index: RecipeIndex = {
      keeper: { slug: "keeper", title: "Keeper", last_cooked: null },
      hidden: { slug: "hidden", title: "Hidden", last_cooked: null },
    };
    const overlay: Overlay = { hidden: { reject: true } };
    // Mirror the handler: merge overlay → effective index → filterRecipes(facets).
    const effective: RecipeIndex = {};
    for (const [slug, entry] of Object.entries(index)) {
      effective[slug] = { ...mergeOverlay(entry, overlay[slug], undefined), slug };
    }
    const survivors = filterRecipes(effective, {}, NOW).map((r) => r.slug);
    expect(survivors).toEqual(["keeper"]);
    expect(survivors).not.toContain("hidden");
  });
});
