import { describe, it, expect } from "vitest";
import {
  daysSince,
  freshnessBoost,
  favoriteAffinity,
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
  const noBoosts: RankParams = { favoriteWeight: 0, noveltyBoost: 0, resurfaceAfterDays: 30 };

  it("orders by cosine relevance to the query", () => {
    const query = [1, 0];
    const out = rankCandidates(
      [
        cand({ slug: "far", embedding: [0, 1] }), // cosine 0
        cand({ slug: "near", embedding: [1, 0] }), // cosine 1
      ],
      query,
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
    const params: RankParams = { favoriteWeight: 0.15, noveltyBoost: 0, resurfaceAfterDays: 30 };
    const out = rankCandidates(
      [
        cand({ slug: "b", embedding: [0.6, 0, 0.8] }), // sim 0.6, no favorite nearby
        cand({ slug: "a", embedding: [0.5, 0.866, 0] }), // sim 0.5, but near the favorite
      ],
      query,
      [[0, 1, 0]], // favorite on the y-axis → close to "a"
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
    });
  });
});

describe("resolveRankParams", () => {
  it("defaults when prefs are null or have no rotation", () => {
    expect(resolveRankParams(null)).toEqual(DEFAULT_RANK_PARAMS);
    expect(resolveRankParams({ stores: {} })).toEqual(DEFAULT_RANK_PARAMS);
  });

  it("reads rotation overrides, keeping the default favorite weight", () => {
    const p = resolveRankParams({ rotation: { novelty_boost: 0.2, resurface_after_days: 14 } });
    expect(p).toEqual({ favoriteWeight: 0.15, noveltyBoost: 0.2, resurfaceAfterDays: 14 });
  });

  it("ignores malformed / non-positive rotation values", () => {
    const p = resolveRankParams({ rotation: { novelty_boost: "lots", resurface_after_days: -5 } });
    expect(p).toEqual(DEFAULT_RANK_PARAMS);
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
