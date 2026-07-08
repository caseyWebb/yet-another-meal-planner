// runPlaceOrder — the extracted shared order operation (member-app-grocery D4/D8) over
// the REAL-SQLite env with fake wiring: the server-side plan-needs union (derived +
// caller + materialized row dedup to one line), the order-scoped `exclude`, preview
// writes nothing, `underived` rides the result, and the unchanged-baseline guarantee
// (no plan + no new params ⇒ exactly the pre-extraction tool behavior).
import { describe, it, expect } from "vitest";
import { runPlaceOrder, type OrderWiring, type PlaceOrderInput } from "../src/order-tools.js";
import { computeToBuy, placeOrder, type PlaceOrderDeps } from "../src/order.js";
import { addGroceryRow, readGroceryList, readPantryNames } from "../src/session-db.js";
import { ingredientContext } from "../src/corpus-db.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import type { MatchResult } from "../src/matching.js";

const TODAY = "2026-07-08";
const T = "casey";

function seedRecipe(h: SqliteEnv, slug: string, full: string[] | null): void {
  h.raw
    .prepare("INSERT INTO recipes (slug, title, ingredients_full) VALUES (?, ?, ?)")
    .run(slug, slug, full ? JSON.stringify(full) : null);
}

function seedPlan(h: SqliteEnv, recipe: string): void {
  h.raw.prepare("INSERT INTO meal_plan (tenant, recipe, planned_for) VALUES (?, ?, NULL)").run(T, recipe);
}

/** Fake wiring: every name resolves confidently; SKUs are name-derived (assertable). */
function fakeWiring(overrides: Partial<OrderWiring> = {}): OrderWiring & { resolvedNames: string[] } {
  const resolvedNames: string[] = [];
  return {
    resolvedNames,
    resolve: async (name: string): Promise<MatchResult> => {
      resolvedNames.push(name);
      return {
        resolved: true,
        sku: `SKU-${name.toLowerCase()}`,
        brand: "Store Brand",
        size: null,
        price: { regular: 2.5, promo: 0 },
        on_sale: false,
        reason: "test",
      };
    },
    revalidateSku: async () => ({ brand: "Store Brand", size: null, price: { regular: 2.5, promo: 2.0 }, on_sale: true }),
    getLocationId: async () => "loc-1",
    search: async () => [],
    productById: async () => null,
    ...overrides,
  };
}

function run(h: SqliteEnv, input: PlaceOrderInput, wiring: OrderWiring) {
  return runPlaceOrder(h.env, T, input, wiring);
}

describe("runPlaceOrder — plan-needs union (D4)", () => {
  it("derives the plan's needs server-side; a caller duplicate and a materialized row dedup to ONE line", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken", "black beans"]);
    seedPlan(h, "stew");
    // A materialized row for chicken AND a caller-supplied duplicate — one line results.
    await addGroceryRow(h.env, T, { name: "chicken", source: "menu", for_recipes: ["stew"] }, TODAY);
    const wiring = fakeWiring();
    const result = await run(h, { preview: true, menu_needs: [{ name: "chicken", for_recipes: ["extra"] }] }, wiring);

    const names = result.resolved.map((l) => l.name).sort();
    expect(names).toEqual(["black beans", "chicken"]); // derived + stored + caller → 2 lines, not 3+
    expect(wiring.resolvedNames.sort()).toEqual(["black beans", "chicken"]); // resolved ONCE each
    expect(result.underived).toEqual([]);
  });

  it("reports underived planned recipes on the result instead of silently under-buying", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "derived", ["salmon"]);
    seedPlan(h, "derived");
    seedPlan(h, "not-yet"); // no recipes row at all
    const result = await run(h, { preview: true }, fakeWiring());
    expect(result.resolved.map((l) => l.name)).toEqual(["salmon"]);
    expect(result.underived).toEqual(["not-yet"]);
  });
});

describe("runPlaceOrder — in-flight suppression", () => {
  it("does not re-resolve a derived line the last order already carted", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken", "black beans"]);
    seedPlan(h, "stew");
    // Simulate the prior order's advance: an in_cart row for the derived chicken line.
    await addGroceryRow(h.env, T, { name: "chicken", source: "menu" }, TODAY);
    h.raw.prepare("UPDATE grocery_list SET status = 'in_cart' WHERE tenant = ? AND normalized_name = 'chicken'").run(T);

    const wiring = fakeWiring();
    const result = await run(h, { preview: true }, wiring);
    expect(result.resolved.map((l) => l.name)).toEqual(["black beans"]); // no chicken re-buy
    expect(wiring.resolvedNames).toEqual(["black beans"]);
  });
});

describe("runPlaceOrder — exclude (order-scoped opt-out)", () => {
  it("drops an excluded line BEFORE resolution — not resolved, not checkpointed, not carted", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "salmon-dinner", ["salmon", "mustard"]);
    seedPlan(h, "salmon-dinner");
    const wiring = fakeWiring();
    const result = await run(h, { preview: true, exclude: ["salmon"] }, wiring);
    expect(result.resolved.map((l) => l.name)).toEqual(["mustard"]);
    expect(result.checkpoint).toEqual([]);
    expect(wiring.resolvedNames).toEqual(["mustard"]); // salmon never hit the matcher
    // Nothing persisted the exclusion: the plan row and grocery list are untouched.
    expect(h.rows("grocery_list")).toHaveLength(0);
  });
});

describe("runPlaceOrder — preview writes nothing", () => {
  it("resolves and reports without touching sku_cache or the list", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken"]);
    seedPlan(h, "stew");
    const result = await run(h, { preview: true }, fakeWiring());
    expect(result.preview).toBe(true);
    expect(result.resolved).toHaveLength(1);
    expect(result.sku_cache.committed).toBe(false);
    expect(result.cart.written).toBe(false);
    expect(h.rows("sku_cache")).toHaveLength(0);
    expect(h.rows("grocery_list")).toHaveLength(0); // the derived line was never materialized
  });
});

describe("runPlaceOrder — commit paths", () => {
  it("reports the cart honestly when no Kroger link exists (reauth_required), list NOT advanced", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    const result = await run(h, {}, fakeWiring());
    // No stored refresh token → the user client throws ReauthRequiredError before any fetch.
    expect(result.cart.written).toBe(false);
    expect(result.cart.code).toBe("reauth_required");
    expect(result.list.advanced).toBe(false);
    // SKU-cache commit is independent best-effort and DID land (with the wiring's location).
    expect(result.sku_cache.committed).toBe(true);
    expect(h.rows<{ location_id: string }>("sku_cache")[0].location_id).toBe("loc-1");
    // The row stays active to retry next order.
    expect(h.rows<{ status: string }>("grocery_list")[0].status).toBe("active");
  });
});

describe("runPlaceOrder — unchanged baseline (no plan, no new params)", () => {
  it("deep-equals the pre-extraction composition (computeToBuy + placeOrder + partials)", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    await addGroceryRow(h.env, T, { name: "scallions", quantity: "2" }, TODAY);
    h.raw
      .prepare("INSERT INTO pantry (tenant, name, normalized_name, added_at) VALUES (?, 'Scallions', 'scallions', ?)")
      .run(T, TODAY);

    const wiring = fakeWiring();
    const result = await run(h, { preview: true, quantities: { "olive oil": 2 } }, wiring);

    // Reproduce today's (pre-extraction) closure body directly over the same inputs.
    const list = await readGroceryList(h.env, T);
    const pantryNames = await readPantryNames(h.env, T);
    const ctx = await ingredientContext(h.env);
    const { to_buy, partials } = computeToBuy({
      list,
      pantryNames,
      quantities: { [ctx.resolve("olive oil")]: 2 },
      includePartials: new Set(),
      resolve: (n) => ctx.resolve(n),
    });
    const deps: PlaceOrderDeps = {
      resolve: (name) => fakeWiring().resolve(name),
      revalidateSku: async () => null,
      normalize: (n) => n,
      commitSkuCache: async () => null,
      cartAdd: async () => {},
      advanceInCart: async () => {},
    };
    const expected = await placeOrder(deps, to_buy, { preview: true, resolveKey: (n) => ctx.resolve(n) });

    expect(result).toEqual({ ...expected, partials, underived: [] });
  });
});

describe("runPlaceOrder — SKU-cache aisle capture (member-app-differentiators D5)", () => {
  const AISLE = { number: "11", description: "Meat & Seafood", side: "L" };
  const isoToday = () => new Date().toISOString().slice(0, 10);

  function seedSkuRow(h: SqliteEnv, over: Record<string, unknown> = {}): void {
    const row = {
      ingredient: "olive oil",
      location_id: "loc-1",
      sku: "SKU-olive oil",
      brand: "Store Brand",
      size: null,
      last_used: "2026-01-01",
      aisle_number: null,
      aisle_description: null,
      aisle_side: null,
      aisle_captured_at: null,
      ...over,
    };
    h.raw
      .prepare(
        "INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used, aisle_number, aisle_description, aisle_side, aisle_captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(...Object.values(row));
  }

  it("skips an already-cached row whose learned fields (SKU/brand/size/aisle) are identical", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    seedSkuRow(h); // identical to what the fake wiring resolves (no aisle either side)
    const result = await run(h, {}, fakeWiring());
    expect(result.sku_cache.committed).toBe(true);
    // No write churn: the row is untouched (last_used keeps its old stamp).
    expect(h.rows<{ last_used: string }>("sku_cache")).toEqual([
      expect.objectContaining({ ingredient: "olive oil", sku: "SKU-olive oil", last_used: "2026-01-01" }),
    ]);
  });

  it("refreshes a cache-hit row in place when the fresh resolution carries a differing aisle", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    seedSkuRow(h); // cached, but no placement yet
    const wiring = fakeWiring({
      resolve: async (name: string): Promise<MatchResult> => ({
        resolved: true,
        sku: `SKU-${name.toLowerCase()}`,
        brand: "Store Brand",
        size: null,
        price: { regular: 2.5, promo: 0 },
        on_sale: false,
        reason: "cache hit (revalidated)",
        aisleLocation: AISLE,
      }),
    });
    const result = await run(h, {}, wiring);
    expect(result.sku_cache.committed).toBe(true);
    // The SAME (ingredient, location) row gained the placement + a fresh last_used.
    expect(h.rows("sku_cache")).toEqual([
      expect.objectContaining({
        ingredient: "olive oil",
        location_id: "loc-1",
        sku: "SKU-olive oil",
        aisle_number: "11",
        aisle_description: "Meat & Seafood",
        aisle_side: "L",
        aisle_captured_at: isoToday(),
        last_used: isoToday(),
      }),
    ]);
  });

  it("a newly-learned mapping lands with its aisle placement and capture stamp", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "salmon" }, TODAY);
    const wiring = fakeWiring({
      resolve: async (name: string): Promise<MatchResult> => ({
        resolved: true,
        sku: `SKU-${name.toLowerCase()}`,
        brand: "Store Brand",
        size: "1 lb",
        price: { regular: 9, promo: 0 },
        on_sale: false,
        reason: "test",
        aisleLocation: { number: "15", description: "Seafood" },
      }),
    });
    await run(h, {}, wiring);
    expect(h.rows("sku_cache")).toEqual([
      expect.objectContaining({
        ingredient: "salmon",
        aisle_number: "15",
        aisle_description: "Seafood",
        aisle_side: null,
        aisle_captured_at: isoToday(),
      }),
    ]);
  });

  it("a resolution with NO aisle data writes NULL placement and no capture stamp", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "salmon" }, TODAY);
    await run(h, {}, fakeWiring());
    expect(h.rows("sku_cache")).toEqual([
      expect.objectContaining({
        ingredient: "salmon",
        aisle_number: null,
        aisle_description: null,
        aisle_captured_at: null,
      }),
    ]);
  });
});
