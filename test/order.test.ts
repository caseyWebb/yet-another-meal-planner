import { describe, it, expect } from "vitest";
import {
  computeToBuy,
  placeOrder,
  type PlaceOrderDeps,
  type ToBuyItem,
} from "../src/order.js";
import type { GroceryItem } from "../src/grocery.js";
import type { MatchResult } from "../src/matching.js";

function item(name: string, over: Partial<GroceryItem> = {}): GroceryItem {
  return {
    name,
    quantity: "1",
    kind: "grocery",
    domain: "grocery",
    status: "active",
    source: "ad_hoc",
    for_recipes: [],
    note: null,
    added_at: "2026-06-01",
    ordered_at: null,
    ...over,
  };
}

const confident = (sku: string): MatchResult => ({
  resolved: true,
  sku,
  brand: "Kroger",
  size: "1 ct",
  price: { regular: 1, promo: 0 },
  on_sale: false,
  reason: "test",
});

const ambiguous: MatchResult = {
  resolved: false,
  ambiguous: true,
  candidates: [],
  reason: "pick one",
};

const unavailable: MatchResult = {
  resolved: false,
  reason: "unavailable",
  message: "no fulfillable candidate",
};

describe("computeToBuy", () => {
  it("unions the list and menu needs, deduping by normalized name and merging for_recipes", () => {
    const list = [item("Milk", { for_recipes: ["a"] }), item("eggs")];
    const r = computeToBuy({
      list,
      menuNeeds: [{ name: "milk", for_recipes: ["b"] }, { name: "flour" }],
      pantryNames: new Set(),
    });
    const names = r.to_buy.map((t) => t.name.toLowerCase()).sort();
    expect(names).toEqual(["eggs", "flour", "milk"]);
    const milk = r.to_buy.find((t) => t.name.toLowerCase() === "milk")!;
    expect(milk.for_recipes.sort()).toEqual(["a", "b"]);
  });

  it("excludes only `active` items (in_cart/ordered are already in flight)", () => {
    const list = [item("milk", { status: "in_cart" }), item("eggs")];
    const r = computeToBuy({ list, pantryNames: new Set() });
    expect(r.to_buy.map((t) => t.name)).toEqual(["eggs"]);
  });

  it("drops pantry-present items to `partials` rather than auto-buying them", () => {
    const r = computeToBuy({
      list: [item("olive oil"), item("eggs")],
      pantryNames: new Set(["olive oil"]),
    });
    expect(r.to_buy.map((t) => t.name)).toEqual(["eggs"]);
    expect(r.partials.map((p) => p.name)).toEqual(["olive oil"]);
  });

  it("keeps a pantry-present item when the user confirmed it via include_partials", () => {
    const r = computeToBuy({
      list: [item("olive oil")],
      pantryNames: new Set(["olive oil"]),
      includePartials: new Set(["olive oil"]),
    });
    expect(r.to_buy.map((t) => t.name)).toEqual(["olive oil"]);
    expect(r.partials).toEqual([]);
  });

  it("defaults quantity to 1 and honors per-name overrides", () => {
    const r = computeToBuy({
      list: [item("milk"), item("eggs")],
      pantryNames: new Set(),
      quantities: { milk: 3 },
    });
    expect(r.to_buy.find((t) => t.name === "milk")!.quantity).toBe(3);
    expect(r.to_buy.find((t) => t.name === "eggs")!.quantity).toBe(1);
  });

  it("honors menu_needs[].quantity as the package count", () => {
    const r = computeToBuy({
      list: [],
      menuNeeds: [{ name: "anaheim peppers", quantity: 4 }],
      pantryNames: new Set(),
    });
    const line = r.to_buy.find((t) => t.name === "anaheim peppers")!;
    expect(line.quantity).toBe(4);
    expect(line.assumed_quantity).toBe(false);
  });

  it("the quantities map overrides menu_needs[].quantity", () => {
    const r = computeToBuy({
      list: [],
      menuNeeds: [{ name: "anaheim peppers", quantity: 4 }],
      pantryNames: new Set(),
      quantities: { "anaheim peppers": 6 },
    });
    const line = r.to_buy.find((t) => t.name === "anaheim peppers")!;
    expect(line.quantity).toBe(6);
    expect(line.assumed_quantity).toBe(false);
  });

  it("flags a defaulted line as assumed_quantity", () => {
    const r = computeToBuy({
      list: [item("tomatillos")],
      pantryNames: new Set(),
    });
    const line = r.to_buy.find((t) => t.name === "tomatillos")!;
    expect(line.quantity).toBe(1);
    expect(line.assumed_quantity).toBe(true);
  });

  it("takes the max when two menu needs merge to one name", () => {
    const r = computeToBuy({
      list: [],
      menuNeeds: [
        { name: "anaheim peppers", quantity: 2, for_recipes: ["chile-verde"] },
        { name: "Anaheim Peppers", quantity: 5, for_recipes: ["arroz-caldo"] },
      ],
      pantryNames: new Set(),
    });
    const line = r.to_buy.find((t) => t.name.toLowerCase() === "anaheim peppers")!;
    expect(line.quantity).toBe(5);
    expect(line.assumed_quantity).toBe(false);
  });
});

// A deps factory recording cart/commit calls, with injectable resolution + failures.
function makeDeps(
  resolutions: Record<string, MatchResult>,
  opts: {
    skuCacheThrows?: boolean;
    cartThrows?: Error;
    advanceThrows?: boolean;
  } = {},
) {
  const calls = { sku: 0, cart: 0, advance: 0, cartLines: [] as unknown[] };
  const deps: PlaceOrderDeps = {
    resolve: async (name) => resolutions[name.toLowerCase()] ?? unavailable,
    commitSkuCache: async () => {
      calls.sku++;
      if (opts.skuCacheThrows) throw new Error("commit failed");
      return "sku-sha";
    },
    cartAdd: async (lines) => {
      calls.cart++;
      calls.cartLines = lines;
      if (opts.cartThrows) throw opts.cartThrows;
    },
    advanceInCart: async () => {
      calls.advance++;
      if (opts.advanceThrows) throw new Error("advance failed");
    },
  };
  return { deps, calls };
}

const toBuy = (...names: string[]): ToBuyItem[] =>
  names.map((name) => ({ name, quantity: 1, for_recipes: [], assumed_quantity: true }));

describe("placeOrder", () => {
  it("resolves, commits the cache, writes the cart, then advances the list", async () => {
    const { deps, calls } = makeDeps({ milk: confident("S1"), eggs: confident("S2") });
    const res = await placeOrder(deps, toBuy("milk", "eggs"));

    expect(res.resolved.map((r) => r.sku)).toEqual(["S1", "S2"]);
    expect(res.checkpoint).toEqual([]);
    expect(res.sku_cache).toEqual({ committed: true });
    expect(res.cart).toEqual({ written: true, count: 2 });
    expect(res.list).toEqual({ advanced: true });
    expect(calls).toMatchObject({ sku: 1, cart: 1, advance: 1 });
  });

  it("batches ambiguous/unavailable into the checkpoint and never carts them", async () => {
    const { deps, calls } = makeDeps({ milk: confident("S1"), cheese: ambiguous, saffron: unavailable });
    const res = await placeOrder(deps, toBuy("milk", "cheese", "saffron"));

    expect(res.resolved.map((r) => r.name)).toEqual(["milk"]);
    expect(res.checkpoint.map((c) => [c.name, c.kind])).toEqual([
      ["cheese", "ambiguous"],
      ["saffron", "unavailable"],
    ]);
    // Only the resolved item reached the cart.
    expect(calls.cartLines).toHaveLength(1);
  });

  it("honest partial: cart fails but cache committed → cart not reported populated", async () => {
    const { deps } = makeDeps({ milk: confident("S1") }, { cartThrows: new Error("upstream 503") });
    const res = await placeOrder(deps, toBuy("milk"));

    expect(res.sku_cache.committed).toBe(true);
    expect(res.cart.written).toBe(false);
    expect(res.cart.error).toContain("upstream 503");
    // List is NOT advanced when the cart write failed (items stay retryable).
    expect(res.list.advanced).toBe(false);
  });

  it("honest partial: cache commit fails but cart write succeeds", async () => {
    const { deps } = makeDeps({ milk: confident("S1") }, { skuCacheThrows: true });
    const res = await placeOrder(deps, toBuy("milk"));

    expect(res.sku_cache.committed).toBe(false);
    expect(res.sku_cache.error).toContain("commit failed");
    expect(res.cart.written).toBe(true);
    expect(res.list.advanced).toBe(true);
  });

  it("surfaces a structured error code from a cart failure (e.g. reauth_required)", async () => {
    const reauth = Object.assign(new Error("re-auth"), { code: "reauth_required" });
    const { deps } = makeDeps({ milk: confident("S1") }, { cartThrows: reauth });
    const res = await placeOrder(deps, toBuy("milk"));
    expect(res.cart.code).toBe("reauth_required");
  });

  it("applies overrides for previously-ambiguous items without re-resolving", async () => {
    const { deps, calls } = makeDeps({ cheese: ambiguous });
    const overrides = new Map([["cheese", { sku: "PICK", brand: "Tillamook", size: "8 oz" }]]);
    const res = await placeOrder(deps, toBuy("cheese"), { overrides });

    expect(res.resolved).toEqual([
      { name: "cheese", sku: "PICK", brand: "Tillamook", size: "8 oz", quantity: 1, assumed_quantity: true },
    ]);
    expect(res.checkpoint).toEqual([]);
    expect(calls.cart).toBe(1);
  });

  it("carries assumed_quantity from the to-buy line onto the resolved line", async () => {
    const { deps } = makeDeps({ peppers: confident("S1"), milk: confident("S2") });
    const lines: ToBuyItem[] = [
      { name: "peppers", quantity: 1, for_recipes: [], assumed_quantity: true },
      { name: "milk", quantity: 2, for_recipes: [], assumed_quantity: false },
    ];
    const res = await placeOrder(deps, lines, { preview: true });
    const byName = Object.fromEntries(res.resolved.map((r) => [r.name, r.assumed_quantity]));
    expect(byName).toEqual({ peppers: true, milk: false });
  });

  it("preview resolves and reports without writing anything", async () => {
    const { deps, calls } = makeDeps({ milk: confident("S1") });
    const res = await placeOrder(deps, toBuy("milk"), { preview: true });

    expect(res.preview).toBe(true);
    expect(res.resolved).toHaveLength(1);
    expect(res.cart.written).toBe(false);
    expect(calls).toMatchObject({ sku: 0, cart: 0, advance: 0 });
  });

  it("does nothing to the cart when there is nothing resolved", async () => {
    const { deps, calls } = makeDeps({ saffron: unavailable });
    const res = await placeOrder(deps, toBuy("saffron"));
    expect(res.checkpoint).toHaveLength(1);
    expect(calls).toMatchObject({ sku: 0, cart: 0, advance: 0 });
  });
});
