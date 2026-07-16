// The pure D3 walk + the shared cheap-half annotator (inline-substitution-hints
// D1/D3, factored out of member-app-differentiators' original `suggestSubstitutions`)
// over identity/edge fixtures — including the PRODUCTION cabbage and onion families
// the P4 spike surfaced — plus the now-ALTERNATIVES-ONLY `suggestSubstitutions` over
// the real-SQLite env with fake order wiring: the closed D2 reason vocabulary against
// `compareUnitPrice`, the 12-line budget with honest `remaining`, the no-location
// degradation, and the op-is-read-only guarantee. The pantry/flyer sibling
// annotations now live on `annotateSubstitutes` (tested here) and the enriched to-buy
// read (`to-buy.test.ts`), not on `suggestSubstitutions`.
import { describe, it, expect } from "vitest";
import { identitySiblings, annotateSubstitutes } from "../src/substitute-annotator.js";
import { suggestSubstitutions, MAX_SUBSTITUTION_LINES } from "../src/substitutions.js";
import { readIdentityNeighbors, emptyIngredientContext } from "../src/corpus-db.js";
import { readPantryNames, addGroceryRow } from "../src/session-db.js";
import type { OrderWiring } from "../src/order-tools.js";
import type { KrogerCandidate } from "../src/kroger.js";
import type { FlyerItem } from "../src/matching.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";

const T = "casey";
const TODAY = "2026-07-08";

// --- fixtures ---------------------------------------------------------------------

/** Seed identity nodes + edges (the production families are the acceptance fixtures). */
function seedGraph(
  h: SqliteEnv,
  nodes: { id: string; concrete?: boolean; representative?: string | null }[],
  edges: [from: string, to: string, kind: string][],
): void {
  for (const n of nodes) {
    h.raw
      .prepare(
        "INSERT INTO ingredient_identity (id, base, detail, concrete, representative, source, decided_at) VALUES (?, ?, ?, ?, ?, 'auto', 1)",
      )
      .run(
        n.id,
        n.id.includes("::") ? n.id.slice(0, n.id.indexOf("::")) : n.id,
        n.id.includes("::") ? n.id.slice(n.id.indexOf("::") + 2) : null,
        n.concrete === false ? 0 : 1,
        n.representative ?? null,
      );
  }
  for (const [from, to, kind] of edges) {
    h.raw
      .prepare("INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES (?, ?, ?, 'auto', 1)")
      .run(from, to, kind);
  }
}

/** The production cabbage family (spike fixture): three specializations, kind general. */
const CABBAGE_NODES = [
  { id: "cabbage" },
  { id: "cabbage::type-napa" },
  { id: "cabbage::color-green" },
  { id: "cabbage::color-red" },
];
const CABBAGE_EDGES: [string, string, string][] = [
  ["cabbage::type-napa", "cabbage", "general"],
  ["cabbage::color-green", "cabbage", "general"],
  ["cabbage::color-red", "cabbage", "general"],
];

function cand(over: Partial<KrogerCandidate> & { productId: string }): KrogerCandidate {
  return {
    brand: "Store Brand",
    description: over.productId,
    categories: [],
    size: null,
    price: { regular: 3, promo: 0 },
    fulfillment: { curbside: true, delivery: true, inStore: true },
    aisleLocation: null,
    ...over,
  };
}

/** Fake wiring: call-counting, injectable search/productById results. */
function fakeWiring(opts: {
  locationId?: string | null;
  byId?: Record<string, KrogerCandidate | null>;
  search?: Record<string, KrogerCandidate[]>;
} = {}) {
  const calls = { search: 0, productById: 0 };
  const wiring: OrderWiring = {
    resolve: async () => {
      throw new Error("the substitution read never enters the matcher");
    },
    revalidateSku: async () => null,
    getLocationId: async () => {
      if (opts.locationId === null) throw new Error("no preferred store location");
      return opts.locationId ?? "L1";
    },
    search: async (term) => {
      calls.search++;
      return opts.search?.[term] ?? [];
    },
    productById: async (sku) => {
      calls.productById++;
      return opts.byId?.[sku] ?? null;
    },
  };
  return { wiring, calls };
}

function seedProfile(h: SqliteEnv, stores: Record<string, unknown>): void {
  h.raw.prepare("INSERT INTO profile (tenant, stores) VALUES (?, ?)").run(T, JSON.stringify(stores));
}

function seedSku(h: SqliteEnv, ingredient: string, locationId: string, sku: string): void {
  h.raw
    .prepare("INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used) VALUES (?, ?, ?, 'B', NULL, ?)")
    .run(ingredient, locationId, sku, TODAY);
}

/** Count write-shaped statements reaching D1 (the op-is-read-only counter). */
function guardWrites(h: SqliteEnv): { count: () => number } {
  let writes = 0;
  const real = h.env.DB;
  const wrapped = {
    prepare(sql: string) {
      if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) writes++;
      return real.prepare(sql);
    },
    batch(stmts: unknown[]) {
      writes += stmts.length;
      return real.batch(stmts as never);
    },
  };
  (h.env as unknown as { DB: unknown }).DB = wrapped;
  return { count: () => writes };
}

// --- the pure walk (D3) -------------------------------------------------------------

describe("identitySiblings — the D3 walk over the persisted graph", () => {
  it("the production cabbage family: general-kind siblings labeled via cabbage, then the concrete generalization", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    const neighbors = await readIdentityNeighbors(h.env, ["cabbage::type-napa"]);
    const out = identitySiblings(neighbors.get("cabbage::type-napa")!);
    expect(out).toEqual([
      { id: "cabbage::color-green", label: "cabbage (color-green)", relation: { role: "sibling", kind: "general", via: "cabbage" } },
      { id: "cabbage::color-red", label: "cabbage (color-red)", relation: { role: "sibling", kind: "general", via: "cabbage" } },
      { id: "cabbage", label: "cabbage", relation: { role: "generalization", kind: "general" } },
    ]);
  });

  it("the production onion family: co-children of one shared parent, same kind on both edges", async () => {
    const h = sqliteEnv([T]);
    seedGraph(
      h,
      [{ id: "onion" }, { id: "onion::color-white-or-yellow" }, { id: "onion::color-green" }, { id: "onion::color-red" }],
      [
        ["onion::color-white-or-yellow", "onion", "general"],
        ["onion::color-green", "onion", "general"],
        ["onion::color-red", "onion", "general"],
      ],
    );
    const neighbors = await readIdentityNeighbors(h.env, ["onion::color-red"]);
    const out = identitySiblings(neighbors.get("onion::color-red")!);
    expect(out.map((s) => s.id)).toEqual(["onion::color-green", "onion::color-white-or-yellow", "onion"]);
  });

  it("satisfies (in-edges, any kind) leads the precedence and never reverses direction", async () => {
    const h = sqliteEnv([T]);
    seedGraph(
      h,
      [{ id: "mushrooms" }, { id: "oyster mushrooms" }],
      [["oyster mushrooms", "mushrooms", "general"]],
    );
    const neighbors = await readIdentityNeighbors(h.env, ["mushrooms", "oyster mushrooms"]);
    // oyster satisfies mushrooms: a `mushrooms` line suggests oyster as SATISFIES...
    expect(identitySiblings(neighbors.get("mushrooms")!)).toEqual([
      { id: "oyster mushrooms", label: "oyster mushrooms", relation: { role: "satisfies", kind: "general" } },
    ]);
    // ...and the oyster line suggests mushrooms only as a GENERALIZATION (out-edge).
    expect(identitySiblings(neighbors.get("oyster mushrooms")!)).toEqual([
      { id: "mushrooms", label: "mushrooms", relation: { role: "generalization", kind: "general" } },
    ]);
  });

  it("membership co-children rank last, carry their class parent in via, and the class itself is never suggested", async () => {
    const h = sqliteEnv([T]);
    seedGraph(
      h,
      [{ id: "carrot" }, { id: "potato" }, { id: "vegetables", concrete: false }],
      [
        ["carrot", "vegetables", "membership"],
        ["potato", "vegetables", "membership"],
      ],
    );
    const neighbors = await readIdentityNeighbors(h.env, ["carrot"]);
    const out = identitySiblings(neighbors.get("carrot")!);
    // The membership parent is a class, not a purchase — excluded from generalization
    // (kind gate) AND concept (concrete-target filter). The co-child is labeled.
    expect(out).toEqual([
      { id: "potato", label: "potato", relation: { role: "sibling", kind: "membership", via: "vegetables" } },
    ]);
  });

  it("membership siblings only surface within the cap, after every higher tier", async () => {
    const h = sqliteEnv([T]);
    seedGraph(
      h,
      [
        { id: "flour" },
        { id: "flour::bread" },
        { id: "flour::cake" },
        { id: "flour::rye" },
        { id: "baking", concrete: false },
        { id: "sugar" },
        { id: "yeast" },
      ],
      [
        ["flour::bread", "flour", "general"],
        ["flour::cake", "flour", "general"],
        ["flour::rye", "flour", "general"],
        ["flour::bread", "baking", "membership"],
        ["sugar", "baking", "membership"],
        ["yeast", "baking", "membership"],
      ],
    );
    const neighbors = await readIdentityNeighbors(h.env, ["flour::bread"]);
    const out = identitySiblings(neighbors.get("flour::bread")!);
    expect(out.map((s) => s.id)).toEqual([
      "flour::cake", // general-kind siblings first (lexicographic)
      "flour::rye",
      "flour", // then the generalization
      "sugar", // membership co-children LAST, and the cap (4) cuts yeast
    ]);
    expect(out[3].relation).toEqual({ role: "sibling", kind: "membership", via: "baking" });
  });

  it("merged nodes resolve to the survivor before walking — a merged-away id is never suggested", async () => {
    const h = sqliteEnv([T]);
    seedGraph(
      h,
      [{ id: "green onion" }, { id: "scallion", representative: "green onion" }, { id: "chives" }, { id: "allium", concrete: false }],
      [
        // The edge is stored against the LOSER — resolution must chase it.
        ["scallion", "allium", "membership"],
        ["chives", "allium", "membership"],
      ],
    );
    const neighbors = await readIdentityNeighbors(h.env, ["chives"]);
    const out = identitySiblings(neighbors.get("chives")!);
    expect(out.map((s) => s.id)).toEqual(["green onion"]); // the survivor, never "scallion"
    // And querying BY the merged-away id walks the survivor's neighborhood.
    const merged = await readIdentityNeighbors(h.env, ["scallion"]);
    expect(merged.get("scallion")!.id).toBe("green onion");
    expect(identitySiblings(merged.get("scallion")!).map((s) => s.id)).toEqual(["chives"]);
  });

  it("dedups across tiers first-relation-wins and drops non-concrete targets", async () => {
    const h = sqliteEnv([T]);
    seedGraph(
      h,
      [{ id: "kale" }, { id: "spinach" }, { id: "greens", concrete: false }, { id: "leafy-mix", concrete: false }],
      [
        ["spinach", "kale", "general"], // spinach satisfies kale (tier 1)
        ["kale", "greens", "membership"],
        ["spinach", "greens", "membership"], // spinach ALSO a membership co-child (tier 5)
        ["leafy-mix", "kale", "general"], // a concept satisfying kale — concrete filter drops it
      ],
    );
    const neighbors = await readIdentityNeighbors(h.env, ["kale"]);
    const out = identitySiblings(neighbors.get("kale")!);
    expect(out).toEqual([
      { id: "spinach", label: "spinach", relation: { role: "satisfies", kind: "general" } },
    ]);
  });

  it("a sibling reachable through two same-kind parents gets a STABLE via, independent of edge scan order", async () => {
    const h = sqliteEnv([T]);
    // "x" and "sib" both satisfy TWO shared general-kind parents. The edges are
    // inserted with the "p2" relation before "p1" for BOTH nodes, so a scan-order-
    // dependent walk would attach `via: "p2"` — but "p1" sorts first lexicographically
    // and must win regardless of insertion order.
    seedGraph(
      h,
      [{ id: "x" }, { id: "sib" }, { id: "p1" }, { id: "p2" }],
      [
        ["x", "p2", "general"],
        ["x", "p1", "general"],
        ["sib", "p2", "general"],
        ["sib", "p1", "general"],
      ],
    );
    const neighbors = await readIdentityNeighbors(h.env, ["x"]);
    const out = identitySiblings(neighbors.get("x")!);
    const sib = out.find((s) => s.id === "sib")!;
    expect(sib.relation).toEqual({ role: "sibling", kind: "general", via: "p1" });
  });

  it("excludes the caller's to-buy set and the line itself", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    const neighbors = await readIdentityNeighbors(h.env, ["cabbage::type-napa"]);
    const out = identitySiblings(neighbors.get("cabbage::type-napa")!, new Set(["cabbage::color-red", "cabbage"]));
    expect(out.map((s) => s.id)).toEqual(["cabbage::color-green"]);
  });

  it("a line with no graph neighbors fabricates nothing", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, [{ id: "saffron" }], []);
    const neighbors = await readIdentityNeighbors(h.env, ["saffron"]);
    expect(identitySiblings(neighbors.get("saffron")!)).toEqual([]);
  });

  it("surfaces PROMOTED substitution edges as a labeled relation, AFTER factual relations (D6/D7)", async () => {
    const h = sqliteEnv([T]);
    seedGraph(
      h,
      [
        { id: "buttermilk" },
        { id: "buttermilk::cultured" }, // a factual sibling (in-edge) — must rank ahead
        { id: "yogurt::plain" },
        { id: "sour-cream" },
        { id: "milk::whole" }, // a CANDIDATE substitute (weight 1) — must NOT surface
        { id: "cream-cheese" }, // a transitive target hung off yogurt — must NOT be walked
      ],
      // One factual satisfies edge; the rest are substitution edges seeded below with weights.
      [["buttermilk::cultured", "buttermilk", "general"]],
    );
    const sub = (from: string, to: string, weight: number, qualifier: string | null): void => {
      h.raw
        .prepare(
          "INSERT INTO ingredient_edge (from_id, to_id, kind, weight, qualifier, source, decided_at) VALUES (?, ?, 'substitution', ?, ?, 'auto', 1)",
        )
        .run(from, to, weight, qualifier);
    };
    sub("buttermilk", "yogurt::plain", 3, "1:1 thinned"); // promoted, qualified
    sub("buttermilk", "sour-cream", 2, null); // promoted, no qualifier (still surfaces)
    sub("buttermilk", "milk::whole", 1, null); // candidate — below the promote threshold
    sub("yogurt::plain", "cream-cheese", 5, null); // y's own out-edge — never followed from x

    const neighbors = await readIdentityNeighbors(h.env, ["buttermilk"]);
    const out = identitySiblings(neighbors.get("buttermilk")!);

    // Factual satisfies FIRST, then the promoted substitutes (lexicographic by id: sour-cream <
    // yogurt::plain). The weight-1 candidate and the transitive cream-cheese never appear.
    expect(out).toEqual([
      { id: "buttermilk::cultured", label: "buttermilk (cultured)", relation: { role: "satisfies", kind: "general" } },
      { id: "sour-cream", label: "sour-cream", relation: { role: "substitution", kind: "substitution", weight: 2 } },
      {
        id: "yogurt::plain",
        label: "yogurt (plain)",
        relation: { role: "substitution", kind: "substitution", weight: 3, qualifier: "1:1 thinned" },
      },
    ]);
  });
});

// --- the shared cheap-half annotator (D1/D3, inline-substitution-hints) -------------

describe("annotateSubstitutes — actionable-only (scope-substitution-suggestions)", () => {
  /** No possession context — the default for tests that drive actionability via one reason. */
  const NONE = { inCart: new Set<string>(), onList: new Set<string>() };

  it("keeps siblings actionable by pantry or sale, labeled + annotated, zero Kroger calls", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    h.raw
      .prepare("INSERT INTO pantry (tenant, name, normalized_name, added_at) VALUES (?, 'Red cabbage', 'cabbage::color-red', ?)")
      .run(T, TODAY);
    const pantry = await readPantryNames(h.env, T);
    const saleItems: FlyerItem[] = [
      { sku: "K1", brand: "Kroger", description: "Shredded Cabbage Mix", size: "10 oz", price: { regular: 2.5, promo: 2 }, savings: 0.5, categories: [], matched_terms: ["cabbage"] },
      { sku: "K2", brand: "Kroger", description: "Napa-adjacent", size: null, price: { regular: 4, promo: 3 }, savings: 1, categories: [], matched_terms: ["bok choy"] },
    ];
    const ctx = emptyIngredientContext(h.env); // search_term falls back to the flattened base

    const out = await annotateSubstitutes(h.env, ["cabbage::type-napa"], { pantry, saleItems, ctx, ...NONE });
    const siblings = out.get("cabbage::type-napa")!;
    // All three survive: red via pantry, green + cabbage via the "cabbage" (shared BASE) sale match.
    expect(siblings.map((s) => s.id)).toEqual(["cabbage::color-green", "cabbage::color-red", "cabbage"]);
    expect(siblings.find((s) => s.id === "cabbage::color-red")!.in_pantry).toBe(true);
    expect(siblings.find((s) => s.id === "cabbage::color-green")!.in_pantry).toBe(false);
    // on_sale_hint: element match on "cabbage" — the K1 row, NOT the K2 "bok choy" row.
    const expectedHint = { sku: "K1", description: "Shredded Cabbage Mix", price: { regular: 2.5, promo: 2 }, savings: 0.5 };
    expect(siblings.find((s) => s.id === "cabbage::color-green")!.on_sale_hint).toEqual(expectedHint);
    expect(siblings.find((s) => s.id === "cabbage::color-red")!.on_sale_hint).toEqual(expectedHint);
    expect(siblings.find((s) => s.id === "cabbage")!.on_sale_hint).toEqual(expectedHint);
  });

  it("drops every neighbor the member neither has, is carting, has listed, nor can deal on", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    // No pantry, no cart, no list, no sale → nothing is actionable.
    const out = await annotateSubstitutes(h.env, ["cabbage::type-napa"], { pantry: new Set(), saleItems: [], ctx: emptyIngredientContext(h.env), ...NONE });
    expect(out.get("cabbage::type-napa")).toEqual([]);
  });

  it("on-sale is an INDEPENDENT reason — an unowned neighbor surfaces solely because it is on sale", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    const saleItems: FlyerItem[] = [
      { sku: "K1", brand: "Kroger", description: "Shredded Cabbage Mix", size: "10 oz", price: { regular: 2.5, promo: 2 }, savings: 0.5, categories: [], matched_terms: ["cabbage"] },
    ];
    const out = await annotateSubstitutes(h.env, ["cabbage::type-napa"], { pantry: new Set(), saleItems, ctx: emptyIngredientContext(h.env), ...NONE });
    const siblings = out.get("cabbage::type-napa")!;
    expect(siblings.map((s) => s.id)).toEqual(["cabbage::color-green", "cabbage::color-red", "cabbage"]);
    for (const s of siblings) {
      expect(s.in_pantry).toBe(false);
      expect(s.in_cart).toBeUndefined();
      expect(s.on_list).toBeUndefined();
      expect(s.on_sale_hint).toMatchObject({ sku: "K1" });
    }
  });

  it("an in_cart neighbor surfaces flagged in_cart; a non-cart sibling is dropped", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    const out = await annotateSubstitutes(h.env, ["cabbage::type-napa"], {
      pantry: new Set(),
      saleItems: [],
      ctx: emptyIngredientContext(h.env),
      inCart: new Set(["cabbage::color-green"]),
      onList: new Set(),
    });
    const siblings = out.get("cabbage::type-napa")!;
    expect(siblings.map((s) => s.id)).toEqual(["cabbage::color-green"]);
    expect(siblings[0].in_cart).toBe(true);
    expect(siblings[0].in_pantry).toBe(false);
    expect(siblings[0].on_list).toBeUndefined();
  });

  it("an active-list neighbor surfaces flagged on_list — a consolidation nudge (the old to-buy-set exclusion is gone)", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    const out = await annotateSubstitutes(h.env, ["cabbage::type-napa", "cabbage::color-red"], {
      pantry: new Set(),
      saleItems: [],
      ctx: emptyIngredientContext(h.env),
      inCart: new Set(),
      onList: new Set(["cabbage::color-red"]), // red is itself an active list line
    });
    // napa's walk no longer excludes a same-batch id: red surfaces BECAUSE it is on the list.
    const siblings = out.get("cabbage::type-napa")!;
    expect(siblings.map((s) => s.id)).toEqual(["cabbage::color-red"]);
    expect(siblings[0].on_list).toBe(true);
  });

  it("filters BEFORE the cap — an actionable neighbor ranked past the raw SIBLINGS_CAP still surfaces", async () => {
    const h = sqliteEnv([T]);
    // Seven general-kind specializations: six siblings of "chile::a", the last (chile::g) the only
    // owned one. A cap-then-filter walk would keep b,c,d,e (the raw cap of 4) and filter to empty.
    const ids = ["chile", "chile::a", "chile::b", "chile::c", "chile::d", "chile::e", "chile::f", "chile::g"];
    seedGraph(
      h,
      ids.map((id) => ({ id })),
      ids.filter((id) => id !== "chile").map((id) => [id, "chile", "general"] as [string, string, string]),
    );
    h.raw
      .prepare("INSERT INTO pantry (tenant, name, normalized_name, added_at) VALUES (?, 'Chile G', 'chile::g', ?)")
      .run(T, TODAY);
    const pantry = await readPantryNames(h.env, T);
    const out = await annotateSubstitutes(h.env, ["chile::a"], { pantry, saleItems: [], ctx: emptyIngredientContext(h.env), ...NONE });
    const siblings = out.get("chile::a")!;
    expect(siblings.map((s) => s.id)).toEqual(["chile::g"]); // survives despite ranking 6th in the raw walk
    expect(siblings[0].in_pantry).toBe(true);
  });

  it("caps the SURVIVORS at SIBLINGS_CAP when more than four are actionable", async () => {
    const h = sqliteEnv([T]);
    const ids = ["chile", "chile::a", "chile::b", "chile::c", "chile::d", "chile::e", "chile::f"];
    seedGraph(
      h,
      ids.map((id) => ({ id })),
      ids.filter((id) => id !== "chile").map((id) => [id, "chile", "general"] as [string, string, string]),
    );
    // Every sibling on sale (shared base "chile") → all actionable; the cap still bounds the output.
    const saleItems: FlyerItem[] = [
      { sku: "S1", brand: "", description: "Chiles", size: null, price: { regular: 3, promo: 2 }, savings: 1, categories: [], matched_terms: ["chile"] },
    ];
    const out = await annotateSubstitutes(h.env, ["chile::a"], { pantry: new Set(), saleItems, ctx: emptyIngredientContext(h.env), ...NONE });
    expect(out.get("chile::a")!.length).toBe(4); // SIBLINGS_CAP
  });

  it("a no-edge line yields an empty array, never omitted", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, [{ id: "saffron" }], []);
    const out = await annotateSubstitutes(h.env, ["saffron"], { pantry: new Set(), saleItems: [], ctx: emptyIngredientContext(h.env), ...NONE });
    expect(out.get("saffron")).toEqual([]);
  });

  it("a satellite rollup's label-keyed match (matched_terms empty by contract) still hints via the description substring", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    const saleItems: FlyerItem[] = [
      { sku: "F1", brand: "", description: "Green Cabbage", size: null, price: { regular: 2, promo: 1.5 }, savings: 0.5, categories: [], matched_terms: [] },
    ];
    const ctx = emptyIngredientContext(h.env);
    const out = await annotateSubstitutes(h.env, ["cabbage::type-napa"], { pantry: new Set(), saleItems, ctx, ...NONE });
    const green = out.get("cabbage::type-napa")!.find((s) => s.id === "cabbage::color-green")!;
    expect(green.on_sale_hint).toEqual({ sku: "F1", description: "Green Cabbage", price: { regular: 2, promo: 1.5 }, savings: 0.5 });
  });

  it("batches ONE readIdentityNeighbors call for the whole key set (no per-line N+1)", async () => {
    const h = sqliteEnv([T]);
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    const real = h.env.DB as unknown as { prepare(sql: string): unknown };
    let identityQueries = 0;
    const wrapped = {
      prepare(sql: string) {
        if (/FROM ingredient_identity/.test(sql)) identityQueries++;
        return real.prepare(sql);
      },
    };
    (h.env as unknown as { DB: unknown }).DB = wrapped;
    const ctx = emptyIngredientContext(h.env);
    const keys = ["cabbage::type-napa", "cabbage::color-green", "cabbage::color-red"];
    await annotateSubstitutes(h.env, keys, { pantry: new Set(), saleItems: [], ctx, ...NONE });
    expect(identityQueries).toBe(1); // one batched call, not one per key
  });
});

// --- the composed read (D1/D2) -------------------------------------------------------

describe("suggestSubstitutions — reasons against compareUnitPrice (D2)", () => {
  async function setup(opts: { currentAvailable?: boolean } = {}) {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "Kroger - 45219" });
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    seedSku(h, "olive oil", "L1", "CUR");
    const current = cand({
      productId: "CUR",
      size: "16 oz",
      price: { regular: 6.72, promo: 0 }, // $0.42/oz
      fulfillment: { curbside: opts.currentAvailable !== false, delivery: false, inStore: true },
    });
    const cheaper = cand({ productId: "ALT-CHEAP", size: "32 oz", price: { regular: 9.92, promo: 0 } }); // $0.31/oz
    const onSale = cand({ productId: "ALT-SALE", size: "16 oz", price: { regular: 8, promo: 7.2 } }); // $0.45/oz promo
    const unparseable = cand({ productId: "ALT-ODD", size: "Family Size", price: { regular: 1, promo: 0 } });
    const { wiring, calls } = fakeWiring({
      byId: { CUR: current },
      search: { "olive oil": [cheaper, onSale, unparseable, current] },
    });
    return { h, wiring, calls };
  }

  it("cheaper is a strict unit-price inequality, only when BOTH ranked comparable — with real numbers", async () => {
    const { h, wiring, calls } = await setup();
    const res = await suggestSubstitutions(h.env, T, {}, wiring);
    expect(res.location).toEqual({ id: "L1" });
    const line = res.suggestions[0];
    expect(line.for).toEqual({ name: "olive oil", key: "olive oil", origin: "list" });
    expect(line.status).toBe("ok");
    expect(line.current).toMatchObject({ sku: "CUR", unit_price: 0.0148, base_unit: "g", available: true });

    const bySku = new Map(line.alternatives.map((a) => [a.sku, a]));
    // The current SKU is excluded from alternatives even when the search returns it.
    expect(bySku.has("CUR")).toBe(false);
    expect(bySku.get("ALT-CHEAP")).toMatchObject({ reasons: ["cheaper"], unit_price: 0.0109, base_unit: "g" });
    // On sale but NOT cheaper (0.45 > 0.42): promo drives on_sale, unit price gates cheaper.
    expect(bySku.get("ALT-SALE")).toMatchObject({ reasons: ["on_sale"], unit_price: 0.0159 });
    // Unparseable size → incomparable → never `cheaper`, no unit_price, listed after ranked.
    expect(bySku.get("ALT-ODD")!.reasons).toEqual([]);
    expect(bySku.get("ALT-ODD")!.unit_price).toBeUndefined();
    expect(line.alternatives.map((a) => a.sku)).toEqual(["ALT-CHEAP", "ALT-SALE", "ALT-ODD"]);
    // Budget: exactly one revalidation + one search for the one line.
    expect(calls).toEqual({ search: 1, productById: 1 });
  });

  it("an unavailable current pick yields current_unavailable and in_stock alternatives", async () => {
    const { h, wiring } = await setup({ currentAvailable: false });
    const res = await suggestSubstitutions(h.env, T, {}, wiring);
    const line = res.suggestions[0];
    expect(line.status).toBe("current_unavailable");
    expect(line.current).toMatchObject({ sku: "CUR", available: false });
    for (const alt of line.alternatives) expect(alt.reasons).toContain("in_stock");
    // cheaper still applies alongside (both comparable, strictly lower).
    expect(line.alternatives.find((a) => a.sku === "ALT-CHEAP")!.reasons).toEqual(["cheaper", "in_stock"]);
  });

  it("no cached pick degrades honestly: no current, no cheaper (nothing to compare against)", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "Kroger - 45219" });
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    const cheap = cand({ productId: "A", size: "32 oz", price: { regular: 9.92, promo: 0 } });
    const { wiring, calls } = fakeWiring({ search: { "olive oil": [cheap] } });
    const res = await suggestSubstitutions(h.env, T, {}, wiring);
    const line = res.suggestions[0];
    expect(line.status).toBe("no_cached_pick");
    expect(line.current).toBeNull();
    expect(line.alternatives).toHaveLength(1);
    expect(line.alternatives[0].reasons).toEqual([]); // no cheaper, no on_sale, current not unavailable
    expect(calls).toEqual({ search: 1, productById: 0 }); // no mapping → no revalidation
  });

  it("unfulfillable candidates never surface as alternatives", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "Kroger - 45219" });
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    const out = cand({ productId: "OUT", fulfillment: { curbside: false, delivery: false, inStore: true } });
    const { wiring } = fakeWiring({ search: { "olive oil": [out] } });
    const res = await suggestSubstitutions(h.env, T, {}, wiring);
    expect(res.suggestions[0].alternatives).toEqual([]);
  });
});

describe("suggestSubstitutions — budget, degradation, read-only (D1/D2/D4)", () => {
  it("processes at most 12 lines and returns the rest in remaining, in order", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "Kroger - 45219" });
    const names = Array.from({ length: 20 }, (_, i) => `item-${String(i).padStart(2, "0")}`);
    const { wiring, calls } = fakeWiring({});
    const res = await suggestSubstitutions(h.env, T, { names }, wiring);
    expect(MAX_SUBSTITUTION_LINES).toBe(12);
    expect(res.suggestions).toHaveLength(12);
    expect(res.remaining).toEqual(names.slice(12));
    expect(calls.search).toBe(12); // one search per PROCESSED line only
    // max_lines is capped at 12, never raised.
    const wide = await suggestSubstitutions(h.env, T, { names, max_lines: 50 }, fakeWiring({}).wiring);
    expect(wide.suggestions).toHaveLength(12);
  });

  it("a walk-store tenant gets NOTHING from this op (location: null, no alternatives) — the sibling/pantry/flyer half now lives on read_to_buy's enrich", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "aldi", preferred_location: "aldi east" });
    await addGroceryRow(h.env, T, { name: "cabbage::type-napa" }, TODAY);
    const { wiring, calls } = fakeWiring({ locationId: null });
    const res = await suggestSubstitutions(h.env, T, {}, wiring);
    expect(res.location).toBeNull();
    const line = res.suggestions[0];
    expect(line.status).toBe("no_cached_pick");
    expect(line.current).toBeNull();
    expect(line.alternatives).toEqual([]);
    expect(calls).toEqual({ search: 0, productById: 0 }); // no Kroger product call issued
    // Slimmed: no `siblings` field on the line, no `flyer_as_of` on the result.
    expect("siblings" in line).toBe(false);
    expect("flyer_as_of" in res).toBe(false);
  });

  it("the op is READ-ONLY: zero write statements reach D1 and nothing is enqueued", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "Kroger - 45219" });
    seedGraph(h, CABBAGE_NODES, CABBAGE_EDGES);
    await addGroceryRow(h.env, T, { name: "cabbage::type-napa" }, TODAY);
    seedSku(h, "cabbage::type-napa", "L1", "CUR");
    const guard = guardWrites(h);
    const { wiring } = fakeWiring({
      byId: { CUR: cand({ productId: "CUR", size: "1 lb", price: { regular: 2, promo: 0 } }) },
      search: { "cabbage type-napa": [cand({ productId: "A", size: "1 lb", price: { regular: 1.5, promo: 0 } })] },
    });
    // A NOVEL name rides along — even it must not enqueue (capture-off funnel).
    const res = await suggestSubstitutions(h.env, T, { names: ["cabbage::type-napa", "dragonfruit salsa"] }, wiring);
    expect(res.suggestions).toHaveLength(2);
    expect(guard.count()).toBe(0);
    expect(h.rows("novel_ingredient_terms")).toEqual([]);
  });
});
