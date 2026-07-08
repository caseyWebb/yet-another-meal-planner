import { describe, it, expect } from "vitest";
import {
  matchIngredient,
  normalizeIngredient,
  normalizePerishables,
  baseOf,
  brandKey,
  tiebreak,
  relevanceScore,
  isOnSale,
  isFlyerWorthy,
  dedupeFlyerHits,
  type MatchDeps,
} from "../src/matching.js";
import type { KrogerCandidate } from "../src/kroger.js";

function cand(overrides: Partial<KrogerCandidate> & { productId: string }): KrogerCandidate {
  return {
    brand: "",
    description: "",
    categories: [],
    size: null,
    price: { regular: 0, promo: 0 },
    fulfillment: { curbside: true, delivery: true, inStore: true },
    aisleLocation: null,
    ...overrides,
  };
}

function makeDeps(opts: Partial<MatchDeps> & { byId?: Record<string, KrogerCandidate | null> } = {}): MatchDeps {
  return {
    search: opts.search ?? (async () => []),
    productById: opts.productById ?? (async (id: string) => opts.byId?.[id] ?? null),
    aliases: opts.aliases ?? {},
    searchTerms: opts.searchTerms,
    brands: opts.brands ?? {},
    cache: opts.cache ?? [],
    locationId: opts.locationId ?? "L1",
  };
}

describe("isOnSale (real discount only — flyer savings:0 bug)", () => {
  it("is true only when promo is positive AND below regular", () => {
    expect(isOnSale(cand({ productId: "a", price: { regular: 5, promo: 3 } }))).toBe(true);
  });
  it("is false when promo equals regular (Kroger's non-sale promo echo)", () => {
    expect(isOnSale(cand({ productId: "b", price: { regular: 2.99, promo: 2.99 } }))).toBe(false);
  });
  it("is false when there is no promo", () => {
    expect(isOnSale(cand({ productId: "c", price: { regular: 4, promo: 0 } }))).toBe(false);
  });
  it("is false when promo exceeds regular (bad data — never 'on sale')", () => {
    expect(isOnSale(cand({ productId: "d", price: { regular: 4, promo: 5 } }))).toBe(false);
  });
});

describe("isFlyerWorthy (flyer drops near-zero discounts)", () => {
  it("keeps a meaningful discount (>= 5% off)", () => {
    expect(isFlyerWorthy(cand({ productId: "a", price: { regular: 5, promo: 4 } }))).toBe(true); // 20% off
  });
  it("keeps a discount exactly at the 5% boundary", () => {
    expect(isFlyerWorthy(cand({ productId: "e", price: { regular: 10, promo: 9.5 } }))).toBe(true);
  });
  it("drops a near-zero (penny) discount — the reported noise", () => {
    expect(isFlyerWorthy(cand({ productId: "b", price: { regular: 2.99, promo: 2.98 } }))).toBe(false);
  });
  it("drops a non-sale (promo == regular, savings 0)", () => {
    expect(isFlyerWorthy(cand({ productId: "c", price: { regular: 2.99, promo: 2.99 } }))).toBe(false);
  });
  it("drops a no-promo item", () => {
    expect(isFlyerWorthy(cand({ productId: "d", price: { regular: 4, promo: 0 } }))).toBe(false);
  });
  it("respects a lower min_savings_pct — a 3% discount passes a 2% floor", () => {
    expect(isFlyerWorthy(cand({ productId: "e", price: { regular: 10, promo: 9.7 } }), 0.02)).toBe(true);
  });
  it("respects a higher min_savings_pct — a 3% discount fails a 10% floor", () => {
    expect(isFlyerWorthy(cand({ productId: "f", price: { regular: 10, promo: 9.7 } }), 0.1)).toBe(false);
  });
});

describe("dedupeFlyerHits", () => {
  const mkCand = (id: string, regular = 5, promo = 4): KrogerCandidate =>
    cand({ productId: id, brand: "B", description: `item-${id}`, price: { regular, promo } });

  it("a product surfaced by a single term appears once with matched_terms = [term]", () => {
    const items = dedupeFlyerHits([{ term: "milk", candidates: [mkCand("P1")] }]);
    expect(items).toHaveLength(1);
    expect(items[0].matched_terms).toEqual(["milk"]);
  });

  it("a product surfaced by two terms carries both in matched_terms", () => {
    const p = mkCand("P1");
    const items = dedupeFlyerHits([
      { term: "milk", candidates: [p] },
      { term: "dairy", candidates: [p] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].matched_terms).toEqual(["milk", "dairy"]);
  });

  it("two distinct products from the same term both appear", () => {
    const items = dedupeFlyerHits([{ term: "dairy", candidates: [mkCand("P1"), mkCand("P2")] }]);
    expect(items.map((i) => i.sku)).toEqual(["P1", "P2"]);
  });

  it("preserves scan order — first-occurrence term list position is stable", () => {
    const p = mkCand("P1");
    const items = dedupeFlyerHits([
      { term: "term-a", candidates: [p] },
      { term: "term-b", candidates: [p] },
      { term: "term-c", candidates: [p] },
    ]);
    expect(items[0].matched_terms).toEqual(["term-a", "term-b", "term-c"]);
  });

  it("computes savings as regular - promo rounded to cents", () => {
    const items = dedupeFlyerHits([{ term: "t", candidates: [mkCand("P1", 5.99, 4.99)] }]);
    expect(items[0].savings).toBe(1);
  });
});

describe("normalizeIngredient", () => {
  it("strips a leading quantity/unit", () => {
    expect(normalizeIngredient("2 lb chicken thighs", {})).toBe("chicken thighs");
    expect(normalizeIngredient("1 cup olive oil", {})).toBe("olive oil");
    expect(normalizeIngredient("3 onions", {})).toBe("onions");
  });

  it("preserves a ratio-style product qualifier (a fraction is stripped only with a unit)", () => {
    // The fat ratio must NOT be discarded as a leading quantity — and both forms agree.
    expect(normalizeIngredient("80/20 ground beef", {})).toBe("80/20 ground beef");
    expect(normalizeIngredient("1 lb 80/20 ground beef", {})).toBe("80/20 ground beef");
    // A genuine fraction quantity WITH a unit still strips.
    expect(normalizeIngredient("1/2 cup milk", {})).toBe("milk");
    expect(normalizeIngredient("2 eggs", {})).toBe("eggs"); // plain count still strips
  });

  it("applies aliases case-insensitively", () => {
    expect(normalizeIngredient("EVOO", { EVOO: "olive oil" })).toBe("olive oil");
    expect(normalizeIngredient("Extra Virgin Olive Oil", { "extra virgin olive oil": "olive oil" })).toBe(
      "olive oil",
    );
  });

  it("derives the [brands] key by underscoring spaces", () => {
    expect(brandKey("olive oil")).toBe("olive_oil");
  });
});

describe("baseOf", () => {
  it("returns the segment up to the first :: (a bare base is its own base)", () => {
    expect(baseOf("ground beef")).toBe("ground beef");
    expect(baseOf("ground beef::fat-80-20")).toBe("ground beef");
    expect(baseOf("cheese::mozzarella::low-moisture")).toBe("cheese");
  });
});

describe("matchIngredient — qualified id search term", () => {
  it("searches Kroger with the stored human phrase, not the raw `::` id", async () => {
    let searchedFor = "";
    const beef = cand({
      productId: "B1",
      brand: "Kroger",
      description: "80/20 Ground Beef",
      categories: ["Ground Beef"],
      price: { regular: 5.99, promo: 0 },
      fulfillment: { curbside: true, delivery: false, inStore: false },
    });
    const deps = makeDeps({
      aliases: { "80/20 ground beef": "ground beef::fat-80-20" },
      searchTerms: { "ground beef::fat-80-20": "80/20 ground beef" },
      brands: { "ground_beef::fat-80-20": [] }, // don't-care → resolves confidently
      search: async (term: string) => {
        searchedFor = term;
        return [beef];
      },
    });
    const res = await matchIngredient(deps, "80/20 ground beef");
    expect(searchedFor).toBe("80/20 ground beef"); // the phrase, not the id
    expect(res).toMatchObject({ resolved: true, sku: "B1" });
  });
});

describe("normalizePerishables", () => {
  it("normalizes, dedupes, and drops empties through the ingredient normalizer", () => {
    expect(normalizePerishables(["Cilantro", "cilantro", " Lime "], {})).toEqual(["cilantro", "lime"]);
  });

  it("applies aliases so surface variants collapse to one canonical entry", () => {
    expect(normalizePerishables(["scallions", "green onions"], { "green onions": "scallions" })).toEqual([
      "scallions",
    ]);
  });

  it("is idempotent on an already-normalized list", () => {
    expect(normalizePerishables(["cilantro", "lime"], {})).toEqual(["cilantro", "lime"]);
  });

  it("returns a non-array value unchanged for validation to reject", () => {
    expect(normalizePerishables("cilantro", {})).toBe("cilantro");
    expect(normalizePerishables(["cilantro", 5], {})).toEqual(["cilantro", 5]);
  });
});

describe("matchIngredient — cache lookup + revalidation", () => {
  it("returns a confident cache hit revalidated with fresh price", async () => {
    const fresh = cand({ productId: "S1", brand: "Simple Truth", size: "16.9 fl oz", price: { regular: 7.49, promo: 0 } });
    const deps = makeDeps({
      aliases: { "extra virgin olive oil": "olive oil" },
      cache: [{ ingredient: "olive oil", sku: "S1" }],
      byId: { S1: fresh },
      search: async () => {
        throw new Error("search should not be called on a healthy cache hit");
      },
    });
    const res = await matchIngredient(deps, "Extra Virgin Olive Oil");
    expect(res).toMatchObject({ resolved: true, sku: "S1", price: { regular: 7.49 }, reason: "cache hit (revalidated)" });
  });

  it("re-resolves when the cached SKU is no longer fulfillable", async () => {
    const dead = cand({ productId: "S1", fulfillment: { curbside: false, delivery: false, inStore: false } });
    const searchHit = cand({ productId: "S2", brand: "Store", description: "Store Olive Oil", price: { regular: 3.0, promo: 0 } });
    const deps = makeDeps({
      brands: { olive_oil: [] }, // don't-care so re-resolution is confident
      cache: [{ ingredient: "olive oil", sku: "S1" }],
      byId: { S1: dead },
      search: async () => [searchHit],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: true, sku: "S2" });
  });

  it("bypass_cache skips the cache and runs full search", async () => {
    const deps = makeDeps({
      brands: { olive_oil: [] },
      cache: [{ ingredient: "olive oil", sku: "S1" }],
      byId: { S1: cand({ productId: "S1" }) },
      search: async () => [cand({ productId: "S2", description: "Olive Oil", price: { regular: 4, promo: 0 } })],
    });
    const res = await matchIngredient(deps, "olive oil", {}, true);
    expect(res).toMatchObject({ resolved: true, sku: "S2" });
  });
});

describe("matchIngredient — shared, location-tagged cache (D7/§7.1)", () => {
  it("prefers the caller's-location entry and revalidates it before use", async () => {
    const here = cand({ productId: "HERE", price: { regular: 5, promo: 0 } });
    const deps = makeDeps({
      locationId: "L2",
      cache: [
        { ingredient: "olive oil", sku: "OTHER", locationId: "L1" },
        { ingredient: "olive oil", sku: "HERE", locationId: "L2" },
      ],
      byId: { HERE: here, OTHER: cand({ productId: "OTHER" }) },
      search: async () => {
        throw new Error("search should not run when a same-location hit revalidates");
      },
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: true, sku: "HERE", reason: "cache hit (revalidated)" });
  });

  it("uses another tenant's (cross-location) entry when it revalidates at the caller's store", async () => {
    // Entry was resolved at L1; caller is at L2. It is a candidate, revalidated at L2.
    const fresh = cand({ productId: "X", price: { regular: 6, promo: 0 } });
    const deps = makeDeps({
      locationId: "L2",
      cache: [{ ingredient: "olive oil", sku: "X", locationId: "L1" }],
      byId: { X: fresh },
      search: async () => {
        throw new Error("search should not run when the cross-location hit is available here");
      },
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({
      resolved: true,
      sku: "X",
      reason: "shared cache hit (revalidated at your store)",
    });
  });

  it("falls through to search when a cross-location entry is unavailable at the caller's store", async () => {
    const dead = cand({ productId: "X", fulfillment: { curbside: false, delivery: false, inStore: false } });
    const searchHit = cand({ productId: "Y", description: "Olive Oil", price: { regular: 3, promo: 0 } });
    const deps = makeDeps({
      locationId: "L2",
      brands: { olive_oil: [] }, // don't-care → re-resolution is confident
      cache: [{ ingredient: "olive oil", sku: "X", locationId: "L1" }],
      byId: { X: dead },
      search: async () => [searchHit],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: true, sku: "Y" });
  });

  it("treats an untagged (legacy) entry as same-location", async () => {
    const fresh = cand({ productId: "S1", price: { regular: 7, promo: 0 } });
    const deps = makeDeps({
      locationId: "L9",
      cache: [{ ingredient: "olive oil", sku: "S1" }], // no locationId
      byId: { S1: fresh },
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: true, sku: "S1", reason: "cache hit (revalidated)" });
  });
});

describe("matchIngredient — confidence gate", () => {
  it("absent brand key with no cache → ambiguous", async () => {
    const deps = makeDeps({
      search: async () => [
        cand({ productId: "A", brand: "Brand A", price: { regular: 5, promo: 0 } }),
        cand({ productId: "B", brand: "Brand B", price: { regular: 6, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
    if (res.resolved === false && "ambiguous" in res) {
      expect(res.candidates).toHaveLength(2);
    }
  });

  it("returns the FULL fulfillable set when ambiguous — no 5-item truncation", async () => {
    // 8 distinct fulfillable matches; the LLM should see all 8, not a capped handful.
    const search = async () =>
      Array.from({ length: 8 }, (_, i) =>
        cand({ productId: `P${i}`, description: "Frozen Pizza", price: { regular: 4 + i, promo: 0 } }),
      );
    const res = await matchIngredient(makeDeps({ search }), "frozen pizza");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
    if (res.resolved === false && "ambiguous" in res) {
      expect(res.candidates).toHaveLength(8);
    }
  });

  it("empty list [] → confident cheapest acceptable", async () => {
    const deps = makeDeps({
      brands: { yellow_onion: [] },
      search: async () => [
        cand({ productId: "cheap", description: "Yellow Onion", size: "2 lb", price: { regular: 1.5, promo: 0 } }),
        cand({ productId: "pricey", description: "Yellow Onion", size: "2 lb", price: { regular: 3.0, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "yellow onion");
    expect(res).toMatchObject({ resolved: true, sku: "cheap", reason: "don't-care: cheapest acceptable" });
  });

  it("commodity sizing picks smallest package covering the quantity_hint", async () => {
    const deps = makeDeps({
      brands: { rice: [] },
      search: async () => [
        cand({ productId: "small", description: "White Rice", size: "1 lb", price: { regular: 2, promo: 0 } }),
        cand({ productId: "mid", description: "White Rice", size: "3 lb", price: { regular: 5, promo: 0 } }),
        cand({ productId: "big", description: "White Rice", size: "5 lb", price: { regular: 7, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "rice", { quantity_hint: "2 lb" });
    expect(res).toMatchObject({ resolved: true, sku: "mid" });
  });

  it("ranked list honored by order (highest-ranked available brand wins)", async () => {
    const deps = makeDeps({
      brands: { olive_oil: ["Brand A", "Brand B"] },
      search: async () => [
        cand({ productId: "b", brand: "Brand B", description: "Brand B Olive Oil", price: { regular: 5, promo: 0 } }),
        cand({ productId: "a", brand: "Brand A", description: "Brand A Olive Oil", price: { regular: 9, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: true, sku: "a", reason: "preferred brand match" });
  });

  it("non-empty list whose brands are all unavailable → ambiguous", async () => {
    const deps = makeDeps({
      brands: { olive_oil: ["Brand A", "Brand B"] },
      search: async () => [cand({ productId: "c", brand: "Brand C", description: "Brand C Olive Oil", price: { regular: 5, promo: 0 } })],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
  });
});

describe("matchIngredient — availability + scoring", () => {
  it("nothing fulfillable → unavailable, no substitution", async () => {
    const deps = makeDeps({
      brands: { salmon: [] },
      search: async () => [cand({ productId: "x", fulfillment: { curbside: false, delivery: false, inStore: false } })],
    });
    const res = await matchIngredient(deps, "salmon");
    expect(res).toEqual({
      resolved: false,
      reason: "unavailable",
      message: "No candidate is fulfillable via curbside/delivery at the preferred location.",
    });
  });

  it("a missing preferred brand does not empty the candidate set (routes to ambiguous)", async () => {
    const deps = makeDeps({
      brands: { butter: ["Kerrygold"] },
      search: async () => [
        cand({ productId: "store", brand: "Kroger", description: "Kroger Butter", price: { regular: 3, promo: 0 } }),
        cand({ productId: "land", brand: "Land O Lakes", description: "Land O Lakes Butter", price: { regular: 4, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "butter");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
    if (res.resolved === false && "ambiguous" in res) expect(res.candidates.length).toBeGreaterThan(0);
  });
});

describe("matchIngredient — identity relevance gate", () => {
  // Modeled on the live pepper pool: the correct produce PLU is present but
  // pricier than the cheap unrelated Mexican-aisle items that recur across
  // every "X peppers" search.
  const anaheimPool = () => [
    cand({ productId: "0000000004677", description: "Fresh Anaheim Peppers", price: { regular: 2.69, promo: 0 } }),
    cand({ productId: "beans", brand: "Gebhardt", description: "Gebhardt Mexican Style Refried Beans", price: { regular: 1.49, promo: 0 } }),
    cand({ productId: "soda", brand: "Fanta", description: "Fanta Orange Mexico Soda Pop", price: { regular: 2.79, promo: 2 } }),
    cand({ productId: "salsa", brand: "La Costena", description: "La Costena Homestyle Medium Mexican Salsa", price: { regular: 1.39, promo: 0 } }),
  ];

  it("don't-care confidently picks the matching variety, not the cheaper unrelated item", async () => {
    const deps = makeDeps({ brands: { anaheim_peppers: [] }, search: async () => anaheimPool() });
    const res = await matchIngredient(deps, "anaheim peppers");
    // 4677 ($2.69, relevance 2) wins over cheaper beans/salsa ($1.39–1.49, relevance 0).
    expect(res).toMatchObject({ resolved: true, sku: "0000000004677" });
  });

  it("ambiguous surfaces the true variety ahead of cheaper unrelated candidates", async () => {
    const deps = makeDeps({ search: async () => anaheimPool() }); // absent brand key → ambiguous
    const res = await matchIngredient(deps, "anaheim peppers");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
    if (res.resolved === false && "ambiguous" in res) {
      expect(res.candidates[0].sku).toBe("0000000004677"); // relevance-ranked first despite higher price
    }
  });

  it("zero token overlap with a don't-care entry degrades to ambiguous, never confident-wrong", async () => {
    // Query shares no token with any candidate description → maxRelevance 0.
    const deps = makeDeps({ brands: { tofu: [] }, search: async () => anaheimPool() });
    const res = await matchIngredient(deps, "tofu");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
  });

  it("generic single-token query ties all matches at the top tier; price decides", async () => {
    const deps = makeDeps({
      brands: { peppers: [] },
      search: async () => [
        cand({ productId: "anaheim", description: "Fresh Anaheim Peppers", price: { regular: 2.69, promo: 0 } }),
        cand({ productId: "jalapeno", description: "Fresh Jalapeno Peppers", price: { regular: 1.89, promo: 0 } }),
        cand({ productId: "poblano", description: "Fresh Poblano Peppers", price: { regular: 2.49, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "peppers");
    // All three match "peppers" (relevance 1) → top tier is all → cheapest wins.
    expect(res).toMatchObject({ resolved: true, sku: "jalapeno" });
  });
});

describe("relevanceScore", () => {
  it("counts query tokens present in description + categories", () => {
    const c = cand({ productId: "x", description: "Fresh Anaheim Peppers", categories: ["Produce"] });
    expect(relevanceScore(c, ["anaheim", "peppers"])).toBe(2);
    expect(relevanceScore(c, ["anaheim"])).toBe(1);
    expect(relevanceScore(c, ["chiles"])).toBe(0);
    expect(relevanceScore(c, ["produce"])).toBe(1); // categories count
    expect(relevanceScore(c, [])).toBe(0);
  });
});

describe("tiebreak", () => {
  it("prefers on-sale over regular", () => {
    const onSale = cand({ productId: "sale", size: "16 oz", price: { regular: 5, promo: 3 } });
    const regular = cand({ productId: "reg", size: "16 oz", price: { regular: 2, promo: 0 } });
    expect(tiebreak([regular, onSale]).productId).toBe("sale");
  });

  it("breaks remaining ties by best unit price", () => {
    const a = cand({ productId: "a", size: "32 oz", price: { regular: 4, promo: 0 } });
    const b = cand({ productId: "b", size: "16 oz", price: { regular: 3, promo: 0 } });
    // a: 4/32 = 0.125/oz ; b: 3/16 = 0.1875/oz -> a is cheaper per unit
    expect(tiebreak([a, b]).productId).toBe("a");
  });
});

describe("aisleLocation pass-through (member-app-differentiators D5)", () => {
  const AISLE = { number: "11", description: "Meat & Seafood", side: "L" };

  it("a cache-revalidation confident match carries the fresh candidate's aisleLocation", async () => {
    const deps = makeDeps({
      cache: [{ ingredient: "milk", sku: "S1" }],
      byId: { S1: cand({ productId: "S1", aisleLocation: AISLE }) },
    });
    const res = await matchIngredient(deps, "milk");
    expect(res).toMatchObject({ resolved: true, sku: "S1", aisleLocation: AISLE });
  });

  it("a search-pick confident match carries its candidate's aisleLocation (null when absent)", async () => {
    const withAisle = cand({ productId: "A", description: "whole milk", size: "1 gal", price: { regular: 3, promo: 0 }, aisleLocation: AISLE });
    const res = await matchIngredient(makeDeps({ search: async () => [withAisle], brands: { milk: [] } }), "milk");
    expect(res).toMatchObject({ resolved: true, sku: "A", aisleLocation: AISLE });

    const noAisle = cand({ productId: "B", description: "whole milk", size: "1 gal", price: { regular: 3, promo: 0 } });
    const res2 = await matchIngredient(makeDeps({ search: async () => [noAisle], brands: { milk: [] } }), "milk");
    expect(res2).toMatchObject({ resolved: true, sku: "B", aisleLocation: null });
  });
});
