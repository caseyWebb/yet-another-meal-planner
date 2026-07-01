import { describe, it, expect } from "vitest";
import { mergeEffectiveFacets, parseFacetRow, EMPTY_FACETS, type ClassifiedFacets } from "../src/recipe-facets.js";

const classified = (over: Partial<ClassifiedFacets> = {}): ClassifiedFacets => ({ ...EMPTY_FACETS, ...over });

describe("mergeEffectiveFacets", () => {
  it("Tier A — classified wins over an authored legacy value", () => {
    const eff = mergeEffectiveFacets(
      { ingredients_key: ["legacy"], perishable_ingredients: ["old"] },
      classified({ ingredients_key: ["chicken", "rice"], perishable_ingredients: ["cilantro"] }),
    );
    expect(eff.ingredients_key).toEqual(["chicken", "rice"]);
    expect(eff.perishable_ingredients).toEqual(["cilantro"]);
  });

  it("Tier A — an empty CLASSIFIED array wins over a stale authored value (classified is authoritative)", () => {
    // A non-null classified row with [] (e.g. perishable_ingredients for a shelf-stable dish) is the
    // classifier's authoritative answer — it must NOT resurrect a stale authored legacy value.
    const eff = mergeEffectiveFacets(
      { ingredients_key: ["legacy"], perishable_ingredients: ["stale"] },
      classified({ ingredients_key: ["chicken"], perishable_ingredients: [] }),
    );
    expect(eff.perishable_ingredients).toEqual([]);
    expect(eff.ingredients_key).toEqual(["chicken"]);
  });

  it("Tier A — falls back to authored legacy ONLY before classification (classified is null)", () => {
    const eff = mergeEffectiveFacets({ ingredients_key: ["legacy"] }, null);
    expect(eff.ingredients_key).toEqual(["legacy"]);
  });

  it("Tier A — empty when neither classified nor authored has a value", () => {
    const eff = mergeEffectiveFacets({}, null);
    expect(eff.ingredients_key).toEqual([]);
    expect(eff.side_search_terms).toEqual([]);
    expect(eff.meal_preppable).toBeNull();
  });

  it("Tier B — an authored override wins over the classified value", () => {
    const eff = mergeEffectiveFacets({ protein: "beef", cuisine: "french" }, classified({ protein: "pork", cuisine: "italian" }));
    expect(eff.protein).toBe("beef");
    expect(eff.cuisine).toBe("french");
  });

  it("Tier B — an absent override falls back to the classified value", () => {
    const eff = mergeEffectiveFacets({}, classified({ protein: "pork", cuisine: "italian", course: ["main"] }));
    expect(eff.protein).toBe("pork");
    expect(eff.cuisine).toBe("italian");
    expect(eff.course).toEqual(["main"]);
  });

  it("Tier B — an authored null override wins (present beats classified)", () => {
    const eff = mergeEffectiveFacets({ protein: null }, classified({ protein: "pork" }));
    expect(eff.protein).toBeNull();
  });

  it("Tier B — an authored course override wins and is normalized", () => {
    const eff = mergeEffectiveFacets({ course: "Main" }, classified({ course: ["side"] }));
    expect(eff.course).toEqual(["main"]);
  });

  it("tags — UNION of authored and classified (authored first, deduped)", () => {
    const eff = mergeEffectiveFacets({ tags: ["holiday", "quick"] }, classified({ tags: ["quick", "roast"] }));
    expect(eff.tags).toEqual(["holiday", "quick", "roast"]);
  });

  it("not-yet-classified (null) — effective is the authored values / empty", () => {
    const eff = mergeEffectiveFacets({ protein: "chicken", course: ["main"], tags: ["a"] }, null);
    expect(eff.protein).toBe("chicken");
    expect(eff.course).toEqual(["main"]);
    expect(eff.tags).toEqual(["a"]);
    expect(eff.ingredients_key).toEqual([]);
  });
});

describe("parseFacetRow", () => {
  it("parses a D1 row (JSON arrays + 0/1 boolean) into ClassifiedFacets", () => {
    const f = parseFacetRow({
      slug: "x",
      protein: "chicken",
      cuisine: null,
      course: '["main","side"]',
      season: "[]",
      tags: '["weeknight"]',
      ingredients_key: '["chicken","rice"]',
      perishable_ingredients: '["cilantro"]',
      side_search_terms: '["a crisp salad"]',
      meal_preppable: 1,
    });
    expect(f.protein).toBe("chicken");
    expect(f.cuisine).toBeNull();
    expect(f.course).toEqual(["main", "side"]);
    expect(f.tags).toEqual(["weeknight"]);
    expect(f.meal_preppable).toBe(true);
  });

  it("tolerates null/garbage columns as empty", () => {
    const f = parseFacetRow({
      slug: "x",
      protein: null,
      cuisine: null,
      course: null,
      season: "not json",
      tags: null,
      ingredients_key: null,
      perishable_ingredients: null,
      side_search_terms: null,
      meal_preppable: null,
    });
    expect(f.course).toEqual([]);
    expect(f.season).toEqual([]);
    expect(f.meal_preppable).toBeNull();
  });
});
