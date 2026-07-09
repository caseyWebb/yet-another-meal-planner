import { describe, it, expect } from "vitest";
import {
  computeToBuy,
  placeOrder,
  type PlaceOrderDeps,
  type RevalidatedSku,
  type ToBuyItem,
} from "../src/order.js";
import { packageCount } from "../src/order-tools.js";
import type { GroceryItem } from "../src/grocery.js";
import { normalizeIngredient, type MatchResult } from "../src/matching.js";

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

describe("place_order package-count schema", () => {
  // The guard that keeps a fractional/oversized count out of the real Kroger cart.
  it("accepts a positive integer within bounds", () => {
    expect(packageCount.safeParse(1).success).toBe(true);
    expect(packageCount.safeParse(99).success).toBe(true);
  });

  it("rejects fractional, zero, negative, and oversized counts", () => {
    expect(packageCount.safeParse(1.5).success).toBe(false);
    expect(packageCount.safeParse(0).success).toBe(false);
    expect(packageCount.safeParse(-3).success).toBe(false);
    expect(packageCount.safeParse(100000).success).toBe(false);
  });
});

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

  it("cancels a grocery item against its pantry counterpart across surface forms (food resolve)", () => {
    // A grocery "scallions" and a pantry "green onion" are the same food. With a resolver
    // mapping both to `green onion` and pantryNames holding the canonical id, the grocery line
    // subtracts to a partial — the surface-form pantry cancellation the funnel exists to enable.
    const resolve = (n: string): string =>
      ({ scallions: "green onion", "green onions": "green onion" })[n.trim().toLowerCase()] ?? n.trim().toLowerCase();
    const r = computeToBuy({
      list: [item("scallions"), item("eggs")],
      pantryNames: new Set(["green onion"]),
      resolve,
    });
    expect(r.to_buy.map((t) => t.name)).toEqual(["eggs"]);
    expect(r.partials.map((p) => p.name)).toEqual(["scallions"]);
  });

  it("an add-by-id-shaped row keys on its stored id and emits its display as the line name (pull-list source)", () => {
    // A row whose `name` is a display and `normalized_name` is the canonical id: computeToBuy keys on
    // the STORED id (`storedGroceryKey`), and the emitted line carries the display `name` + the id
    // `key` — exactly what the satellite pull-list turns into { name, item_id }. Re-deriving
    // groceryKey("Red cabbage") would mint "red cabbage" and misfile the line.
    const r = computeToBuy({
      list: [item("Red cabbage", { normalized_name: "cabbage::color-red" })],
      pantryNames: new Set(),
    });
    expect(r.to_buy).toHaveLength(1);
    expect(r.to_buy[0].key).toBe("cabbage::color-red"); // the stored id, not resolve("Red cabbage")
    expect(r.to_buy[0].name).toBe("Red cabbage"); // the display rides as the line name
    expect(r.to_buy[0].name).not.toContain("::");
  });

  it("keeps a non-food item on normalizeName even when a resolver is injected", () => {
    // A household item must NOT be resolved: its key stays normalizeName, so a food resolver
    // that would collapse it is bypassed and it is bought normally.
    const resolve = (n: string): string =>
      ({ "aa batteries": "battery" })[n.trim().toLowerCase()] ?? n.trim().toLowerCase();
    const r = computeToBuy({
      list: [item("AA batteries", { kind: "household", domain: "grocery" })],
      pantryNames: new Set(["battery"]), // would cancel IF it were resolved — but it isn't
      resolve,
    });
    expect(r.to_buy.map((t) => t.name)).toEqual(["AA batteries"]);
    expect(r.partials).toEqual([]);
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
    rollbackThrows?: boolean;
    /** The inserted-keys receipt advanceInCart reports (menu-derived lines it minted). */
    advanceInserted?: string[];
    /** Per-SKU revalidation results; absent SKUs default to fulfillable. */
    revalidations?: Record<string, RevalidatedSku | null>;
  } = {},
) {
  const calls = {
    sku: 0,
    cart: 0,
    advance: 0,
    rollback: 0,
    reval: 0,
    /** Write-leg invocation order, for advance-before-cart assertions. */
    order: [] as string[],
    cartLines: [] as unknown[],
    mappings: [] as { ingredient: string }[],
    /** The advance receipt placeOrder handed to rollbackInCart (receipt threading). */
    rollbackAdvance: null as { inserted: string[] } | null,
  };
  const fulfillable: RevalidatedSku = { brand: "Kroger", size: null, price: { regular: 1, promo: 0 }, on_sale: false };
  const deps: PlaceOrderDeps = {
    resolve: async (name) => resolutions[name.toLowerCase()] ?? unavailable,
    revalidateSku: async (sku) => {
      calls.reval++;
      if (opts.revalidations && sku in opts.revalidations) return opts.revalidations[sku];
      return fulfillable;
    },
    // The real canonical-id normalizer (empty alias map) so a quantity-prefixed line caches
    // under the key the matcher reads it back by — see the "canonical id" test below.
    normalize: (name) => normalizeIngredient(name, {}),
    commitSkuCache: async (mappings) => {
      calls.sku++;
      calls.order.push("sku");
      calls.mappings = mappings;
      if (opts.skuCacheThrows) throw new Error("commit failed");
      return "sku-sha";
    },
    cartAdd: async (lines) => {
      calls.cart++;
      calls.order.push("cart");
      calls.cartLines = lines;
      if (opts.cartThrows) throw opts.cartThrows;
    },
    advanceInCart: async () => {
      calls.advance++;
      calls.order.push("advance");
      if (opts.advanceThrows) throw new Error("advance failed");
      return { inserted: opts.advanceInserted ?? [] };
    },
    rollbackInCart: async (_lines, advance) => {
      calls.rollback++;
      calls.order.push("rollback");
      calls.rollbackAdvance = advance;
      if (opts.rollbackThrows) throw new Error("rollback failed");
    },
  };
  return { deps, calls };
}

const toBuy = (...names: string[]): ToBuyItem[] =>
  names.map((name) => ({ name, key: name, quantity: 1, for_recipes: [], assumed_quantity: true }));

describe("placeOrder", () => {
  it("resolves, commits the cache, advances the list, then writes the cart (advance-first)", async () => {
    const { deps, calls } = makeDeps({ milk: confident("S1"), eggs: confident("S2") });
    const res = await placeOrder(deps, toBuy("milk", "eggs"));

    expect(res.resolved.map((r) => r.sku)).toEqual(["S1", "S2"]);
    expect(res.checkpoint).toEqual([]);
    expect(res.sku_cache).toEqual({ committed: true });
    expect(res.cart).toEqual({ written: true, count: 2 });
    expect(res.list).toEqual({ advanced: true });
    expect(calls).toMatchObject({ sku: 1, cart: 1, advance: 1, rollback: 0 });
    // The double-add guard: the in_cart advance strictly precedes the cart write.
    expect(calls.order).toEqual(["sku", "advance", "cart"]);
  });

  it("caches the learned mapping under the line's CANONICAL key (the stored normalized_name), not the display name", async () => {
    // The to-buy line's `key` IS the stored canonical id (quantity-stripped at storage by the
    // resolver), so the SKU-cache write keys on it directly — a leading quantity in the display `name`
    // never fragments the shared cache the matcher reads back by.
    const { deps, calls } = makeDeps({ "2 lb ground beef": confident("S9") });
    await placeOrder(deps, [
      { name: "2 lb ground beef", key: "ground beef", quantity: 1, for_recipes: [], assumed_quantity: true },
    ]);
    expect(calls.mappings.map((m) => m.ingredient)).toEqual(["ground beef"]);
  });

  it("an add-by-id line carries the DISPLAY name on the resolved line and caches under the canonical id", async () => {
    // An add-by-id line: `name` is the human display ("Red cabbage"), `key` is the canonical id
    // ("cabbage::color-red"). The resolved line renders the display; the SKU-cache append keys on the
    // id (de-fragmenting the cache onto the matcher's read key), never the display.
    const { deps, calls } = makeDeps({ "red cabbage": confident("S7") });
    const res = await placeOrder(deps, [
      { name: "Red cabbage", key: "cabbage::color-red", quantity: 1, for_recipes: [], assumed_quantity: true },
    ]);
    expect(res.resolved[0].name).toBe("Red cabbage"); // the display, never the raw id
    expect(res.resolved[0].name).not.toContain("::");
    expect(res.resolved[0].key).toBe("cabbage::color-red"); // the canonical id rides the resolved line
    expect(calls.mappings.map((m) => m.ingredient)).toEqual(["cabbage::color-red"]); // cache keyed on the id
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

  it("honest partial: cart fails but cache committed → cart not reported populated, advance rolled back", async () => {
    const { deps, calls } = makeDeps(
      { milk: confident("S1") },
      // milk is a menu-derived line with no stored row — the advance minted it.
      { cartThrows: new Error("upstream 503"), advanceInserted: ["milk"] },
    );
    const res = await placeOrder(deps, toBuy("milk"));

    expect(res.sku_cache.committed).toBe(true);
    expect(res.cart.written).toBe(false);
    expect(res.cart.error).toContain("upstream 503");
    // The pre-write advance is rolled back to active (items stay retryable).
    expect(calls.rollback).toBe(1);
    expect(res.list).toEqual({ advanced: false, rolled_back: true });
    // The advance receipt reached the rollback, so the compensation can DELETE the
    // rows the advance inserted rather than stranding them as active items.
    expect(calls.rollbackAdvance).toEqual({ inserted: ["milk"] });
  });

  it("advance failure skips the cart write entirely (nothing carted, safe to retry)", async () => {
    const { deps, calls } = makeDeps({ milk: confident("S1") }, { advanceThrows: true });
    const res = await placeOrder(deps, toBuy("milk"));

    expect(calls.cart).toBe(0); // the cart write never happened
    expect(calls.rollback).toBe(0); // nothing advanced, nothing to roll back
    expect(res.cart.written).toBe(false);
    expect(res.cart.error).toContain("skipped");
    expect(res.list.advanced).toBe(false);
    expect(res.list.error).toContain("advance failed");
  });

  it("a failed rollback is surfaced, not thrown: list reports advanced without a cart write", async () => {
    const { deps, calls } = makeDeps(
      { milk: confident("S1") },
      { cartThrows: new Error("upstream 503"), rollbackThrows: true },
    );
    const res = await placeOrder(deps, toBuy("milk"));

    expect(calls.order).toEqual(["sku", "advance", "cart", "rollback"]);
    expect(res.cart.written).toBe(false);
    // Items are marked in_cart with NO cart write — visible to the agent, and a
    // retried order won't re-add them (in_cart is filtered from computeToBuy).
    expect(res.list).toEqual({ advanced: true, rolled_back: false, error: "rollback failed" });
  });

  it("never double-adds across a retry when the first order failed after advancing", async () => {
    // Shared list state across the two invocations, as D1 would hold it.
    const list = [item("milk")];
    let cartAdds = 0;
    let cartFails = true;
    const deps: PlaceOrderDeps = {
      resolve: async () => confident("S1"),
      revalidateSku: async () => null,
      normalize: (name) => normalizeIngredient(name, {}),
      commitSkuCache: async () => null,
      cartAdd: async () => {
        cartAdds++;
        if (cartFails) throw new Error("kroger 503");
      },
      advanceInCart: async (lines) => {
        for (const l of lines) {
          const row = list.find((it) => it.name === l.name);
          if (row) row.status = "in_cart";
        }
        return { inserted: [] }; // milk pre-existed — nothing minted
      },
      rollbackInCart: async () => {
        throw new Error("d1 unavailable"); // the worst leg: rollback fails too
      },
    };

    // First order: advance lands, the cart write fails, and so does the rollback —
    // the row is left in_cart with no cart write.
    const first = await placeOrder(deps, computeToBuy({ list, pantryNames: new Set() }).to_buy);
    expect(cartAdds).toBe(1);
    expect(first.cart.written).toBe(false);
    expect(first.list).toEqual({ advanced: true, rolled_back: false, error: "d1 unavailable" });

    // Retried order: the in_cart row is filtered out of the to-buy set, so the
    // (additive, unreadable) Kroger cart is never written a second time.
    cartFails = false;
    const retryLines = computeToBuy({ list, pantryNames: new Set() }).to_buy;
    expect(retryLines).toEqual([]);
    await placeOrder(deps, retryLines);
    expect(cartAdds).toBe(1); // exactly one cart write attempt across both orders
  });

  it("rollback deletes an advance-inserted (menu-derived) line instead of stranding it active", async () => {
    // Shared list state, as D1 would hold it: milk pre-exists; flour is a
    // menu-derived need with NO stored row — the advance mints its in_cart row.
    const list = [item("milk")];
    const deps: PlaceOrderDeps = {
      resolve: async (name) => confident(name === "milk" ? "S1" : "S2"),
      revalidateSku: async () => null,
      normalize: (name) => normalizeIngredient(name, {}),
      commitSkuCache: async () => null,
      cartAdd: async () => {
        throw new Error("kroger 503");
      },
      advanceInCart: async (lines) => {
        const inserted: string[] = [];
        for (const l of lines) {
          const row = list.find((it) => it.name === l.name);
          if (row) {
            row.status = "in_cart";
          } else {
            list.push(item(l.name, { status: "in_cart", source: "menu" }));
            inserted.push(l.name);
          }
        }
        return { inserted };
      },
      rollbackInCart: async (lines, advance) => {
        // The compensation semantics rollbackInCartRows implements: delete what the
        // advance inserted, flip pre-existing in_cart rows back to active.
        const insertedKeys = new Set(advance.inserted);
        for (const l of lines) {
          const idx = list.findIndex((it) => it.name === l.name && it.status === "in_cart");
          if (idx < 0) continue;
          if (insertedKeys.has(l.name)) list.splice(idx, 1);
          else list[idx].status = "active";
        }
      },
    };

    const lines = computeToBuy({
      list,
      menuNeeds: [{ name: "flour" }],
      pantryNames: new Set(),
    }).to_buy;
    const res = await placeOrder(deps, lines);

    expect(res.cart.written).toBe(false);
    expect(res.list).toEqual({ advanced: false, rolled_back: true });
    // The pre-existing row is back to active; the menu-derived line did NOT
    // survive the rollback as an orphaned active grocery item.
    expect(list.map((it) => [it.name, it.status])).toEqual([["milk", "active"]]);
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

  it("applies overrides without re-resolving, carting the forced SKU with FRESH revalidated price/on_sale", async () => {
    const { deps, calls } = makeDeps(
      { cheese: ambiguous },
      { revalidations: { PICK: { brand: "Tillamook", size: "8 oz", price: { regular: 5, promo: 3.5 }, on_sale: true } } },
    );
    const overrides = new Map([["cheese", { sku: "PICK", brand: "stale", size: "stale" }]]);
    const res = await placeOrder(deps, toBuy("cheese"), { overrides });

    // Brand/size/price come from revalidation, not the caller-supplied (stale) override fields.
    // aisleLocation rides the revalidation too (D5) — null when the recheck carries none.
    expect(res.resolved).toEqual([
      {
        name: "cheese",
        key: "cheese",
        sku: "PICK",
        brand: "Tillamook",
        size: "8 oz",
        quantity: 1,
        assumed_quantity: true,
        price: { regular: 5, promo: 3.5 },
        on_sale: true,
        aisleLocation: null,
      },
    ]);
    expect(res.checkpoint).toEqual([]);
    expect(calls.reval).toBe(1);
    expect(calls.cart).toBe(1);
  });

  it("checkpoints an override whose SKU went unavailable instead of blind-carting it", async () => {
    const { deps, calls } = makeDeps({}, { revalidations: { GONE: null } });
    const overrides = new Map([["trout", { sku: "GONE" }]]);
    const res = await placeOrder(deps, toBuy("trout"), { overrides });

    expect(res.resolved).toEqual([]);
    expect(res.checkpoint.map((c) => [c.name, c.kind])).toEqual([["trout", "unavailable"]]);
    // Nothing resolved → no cart write at all.
    expect(calls).toMatchObject({ cart: 0, sku: 0, advance: 0 });
  });

  it("surfaces a lapsed promo on the resolved line (on_sale:false) rather than dropping it", async () => {
    const { deps, calls } = makeDeps(
      {},
      { revalidations: { LAPSED: { brand: "Kroger", size: "1 lb", price: { regular: 8, promo: 0 }, on_sale: false } } },
    );
    const overrides = new Map([["trout", { sku: "LAPSED" }]]);
    const res = await placeOrder(deps, toBuy("trout"), { overrides });

    expect(res.checkpoint).toEqual([]);
    expect(res.resolved).toHaveLength(1);
    expect(res.resolved[0]).toMatchObject({ name: "trout", sku: "LAPSED", on_sale: false });
    // Still carted — the user chose it; we don't auto-drop a lapsed deal.
    expect(calls.cart).toBe(1);
  });

  it("carries assumed_quantity from the to-buy line onto the resolved line", async () => {
    const { deps } = makeDeps({ peppers: confident("S1"), milk: confident("S2") });
    const lines: ToBuyItem[] = [
      { name: "peppers", key: "peppers", quantity: 1, for_recipes: [], assumed_quantity: true },
      { name: "milk", key: "milk", quantity: 2, for_recipes: [], assumed_quantity: false },
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
