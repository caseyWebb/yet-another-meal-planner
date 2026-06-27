import { describe, it, expect } from "vitest";
import {
  reconcileRecipeFacets,
  facetGateHash,
  extractFacets,
  type DerivedFacetDeps,
  type RecipeToClassify,
  type FacetState,
} from "../src/recipe-classify.js";
import { EMPTY_FACETS, type ClassifiedFacets } from "../src/recipe-facets.js";

const recipe = (slug: string, body = "## Ingredients\n- x\n## Instructions\n1. go", over: Record<string, unknown> = {}): RecipeToClassify => ({
  slug,
  title: slug,
  body,
  courseOverride: null,
  bodyHash: facetGateHash(body, over),
});

function makeDeps(
  recipes: RecipeToClassify[],
  state: FacetState[],
  opts: { maxPerTick?: number; failOn?: Set<string>; classified?: (r: RecipeToClassify) => ClassifiedFacets } = {},
) {
  const upserts: Array<{ slug: string; facets: ClassifiedFacets; bodyHash: string }> = [];
  const empties: Array<{ slug: string; bodyHash: string }> = [];
  let prunedWith: string[] = [];
  const deps: DerivedFacetDeps = {
    loadRecipes: async () => recipes,
    loadFacetState: async () => state,
    classify: async (r) => {
      if (opts.failOn?.has(r.slug)) throw new Error("classify failed");
      return opts.classified ? opts.classified(r) : { ...EMPTY_FACETS, protein: "chicken", course: ["main"] };
    },
    upsertFacets: async (slug, facets, bodyHash) => {
      upserts.push({ slug, facets, bodyHash });
    },
    upsertEmpty: async (slug, bodyHash) => {
      empties.push({ slug, bodyHash });
    },
    pruneOrphans: async (corpusSlugs) => {
      prunedWith = corpusSlugs;
      const corpus = new Set(corpusSlugs);
      return state.filter((s) => !corpus.has(s.slug)).length;
    },
    maxPerTick: opts.maxPerTick ?? 100,
    kv: { get: async () => null, put: async () => {}, delete: async () => {} },
    now: () => 1000,
  };
  return { deps, upserts, empties, prunedWithRef: () => prunedWith };
}

describe("facetGateHash", () => {
  it("is stable for the same body + overrides, and changes when either changes", () => {
    const a = facetGateHash("body", { protein: "beef" });
    expect(facetGateHash("body", { protein: "beef" })).toBe(a);
    expect(facetGateHash("body2", { protein: "beef" })).not.toBe(a);
    expect(facetGateHash("body", { protein: "pork" })).not.toBe(a);
  });

  it("ignores non-conditioning keys (only body + Tier-B overrides matter)", () => {
    expect(facetGateHash("body", { protein: "beef", servings: 4 })).toBe(facetGateHash("body", { protein: "beef" }));
  });
});

describe("reconcileRecipeFacets", () => {
  it("classifies only stale recipes (gate), leaving up-to-date ones alone", async () => {
    const fresh = recipe("fresh");
    const stale = recipe("stale");
    const { deps, upserts } = makeDeps(
      [fresh, stale],
      [{ slug: "fresh", body_hash: fresh.bodyHash }], // fresh already matches; stale has no row
    );
    const r = await reconcileRecipeFacets(deps);
    expect(r.classified).toBe(1);
    expect(upserts.map((u) => u.slug)).toEqual(["stale"]);
  });

  it("bounds work per tick and reports the pending remainder", async () => {
    const recipes = [recipe("a"), recipe("b"), recipe("c")];
    const { deps, upserts } = makeDeps(recipes, [], { maxPerTick: 2 });
    const r = await reconcileRecipeFacets(deps);
    expect(r.classified).toBe(2);
    expect(r.pending).toBe(1);
    expect(upserts).toHaveLength(2);
  });

  it("records an EMPTY gate-advanced row on a classify failure (not re-spent next tick)", async () => {
    const { deps, upserts, empties } = makeDeps([recipe("bad")], [], { failOn: new Set(["bad"]) });
    const r = await reconcileRecipeFacets(deps);
    expect(r.failed).toBe(1);
    expect(r.classified).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(empties.map((e) => e.slug)).toEqual(["bad"]);
    // The gate hash is advanced so the next tick (same body) is not re-classified.
    expect(empties[0].bodyHash).toBe(recipe("bad").bodyHash);
  });

  it("prunes facet rows whose slug is no longer in the corpus", async () => {
    const { deps, prunedWithRef } = makeDeps(
      [recipe("kept")],
      [
        { slug: "kept", body_hash: recipe("kept").bodyHash },
        { slug: "gone", body_hash: "h" },
      ],
    );
    const r = await reconcileRecipeFacets(deps);
    expect(r.pruned).toBe(1); // "gone" is not in the corpus
    expect(prunedWithRef()).toEqual(["kept"]);
  });
});

describe("extractFacets", () => {
  const aliases = { evoo: "olive oil", "chx thighs": "chicken thighs" };

  it("normalizes derived ingredient facets through the alias table and coerces types", () => {
    const f = extractFacets(
      {
        protein: "chicken",
        cuisine: "italian",
        course: ["Main"],
        season: ["summer"],
        tags: ["quick"],
        ingredients_key: ["EVOO", "chx thighs"],
        perishable_ingredients: ["EVOO"],
        side_search_terms: ["a crisp salad"],
        meal_preppable: true,
      },
      aliases,
    );
    expect(f.ingredients_key).toEqual(["olive oil", "chicken thighs"]);
    expect(f.perishable_ingredients).toEqual(["olive oil"]);
    expect(f.course).toEqual(["main"]);
    expect(f.meal_preppable).toBe(true);
  });

  it("coerces a missing/non-boolean meal_preppable to null and missing arrays to []", () => {
    const f = extractFacets({ protein: "beef" }, {});
    expect(f.meal_preppable).toBeNull();
    expect(f.ingredients_key).toEqual([]);
    expect(f.course).toEqual([]);
    expect(f.cuisine).toBeNull();
  });
});
