// runPlaceOrder — the extracted shared order operation (member-app-grocery D4/D8) over
// the REAL-SQLite env with fake wiring: the server-side plan-needs union (derived +
// caller + materialized row dedup to one line), the order-scoped `exclude`, preview
// writes nothing, `underived` rides the result, and the unchanged-baseline guarantee
// (no plan + no new params ⇒ exactly the pre-extraction tool behavior).
import { describe, it, expect } from "vitest";
import {
  runPlaceOrder,
  buildKrogerSendSnapshot,
  type OrderWiring,
  type PlaceOrderInput,
  type SnapshotContext,
} from "../src/order-tools.js";
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
      advanceInCart: async () => ({ inserted: [] }),
      rollbackInCart: async () => {},
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

  it("keep-on-null: a same-SKU/brand/size revalidation with no aisle leaves a captured placement untouched", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    seedSkuRow(h, {
      aisle_number: AISLE.number,
      aisle_description: AISLE.description,
      aisle_side: AISLE.side,
      aisle_captured_at: "2026-01-01",
    });
    // Same SKU/brand/size as the seeded row, but the fresh resolution's Kroger response
    // omitted aisleLocation entirely — must not clear the stored placement.
    const result = await run(h, {}, fakeWiring());
    expect(result.sku_cache.committed).toBe(true);
    expect(h.rows("sku_cache")).toEqual([
      expect.objectContaining({
        ingredient: "olive oil",
        sku: "SKU-olive oil",
        aisle_number: AISLE.number,
        aisle_description: AISLE.description,
        aisle_side: AISLE.side,
        aisle_captured_at: "2026-01-01",
        last_used: "2026-01-01", // untouched — no write happened
      }),
    ]);
  });

  it("keep-on-null: a genuine SKU change with no fresh aisle carries the prior placement forward", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    seedSkuRow(h, {
      aisle_number: AISLE.number,
      aisle_description: AISLE.description,
      aisle_side: AISLE.side,
      aisle_captured_at: "2026-01-01",
    });
    const wiring = fakeWiring({
      resolve: async (): Promise<MatchResult> => ({
        resolved: true,
        sku: "SKU-new-brand", // the SKU genuinely changed
        brand: "New Brand",
        size: null,
        price: { regular: 3.5, promo: 0 },
        on_sale: false,
        reason: "test",
        // no aisleLocation — the fresh response carried no placement
      }),
    });
    const result = await run(h, {}, wiring);
    expect(result.sku_cache.committed).toBe(true);
    expect(h.rows("sku_cache")).toEqual([
      expect.objectContaining({
        ingredient: "olive oil",
        sku: "SKU-new-brand",
        aisle_number: AISLE.number,
        aisle_description: AISLE.description,
        aisle_side: AISLE.side,
        aisle_captured_at: "2026-01-01", // carried forward, not re-stamped
        last_used: isoToday(),
      }),
    ]);
  });
});

describe("runPlaceOrder — the send-record snapshot (spend-telemetry)", () => {
  function seedIdentity(h: SqliteEnv, id: string, category: string | null): void {
    h.raw
      .prepare("INSERT INTO ingredient_identity (id, base, category) VALUES (?, ?, ?)")
      .run(id, id.split("::")[0], category);
  }

  it("preview writes no send record", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await run(h, { preview: true }, fakeWiring());
    expect(h.rows("order_sends")).toHaveLength(0);
    expect(h.rows("order_send_lines")).toHaveLength(0);
  });

  it("a rolled-back flush (cart failure) leaves no phantom send and no linkage", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    // No Kroger link → cartAdd throws reauth_required AFTER the advance+snapshot batch;
    // the rollback deletes the send record alongside its row compensation.
    const result = await run(h, {}, fakeWiring());
    expect(result.cart.code).toBe("reauth_required");
    expect(result.list).toMatchObject({ advanced: false, rolled_back: true });
    expect(result.send.recorded).toBe(false);
    expect(result.send.error).toContain("rolled back");
    expect(h.rows("order_sends")).toHaveLength(0);
    expect(h.rows("order_send_lines")).toHaveLength(0);
    expect(h.rows<{ status: string; sent_in: string | null }>("grocery_list")[0]).toMatchObject({
      status: "active",
      sent_in: null,
    });
  });

  it("a snapshot-build failure (location resolve) degrades to a bare advance — send honest, flush intact", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    const wiring = fakeWiring({
      getLocationId: async () => {
        throw new Error("no location resolvable");
      },
    });
    const result = await run(h, {}, wiring);
    // The advance still ran (bare); the send reports the failure honestly.
    expect(result.send.recorded).toBe(false);
    expect(result.send.error).toContain("no location resolvable");
    expect(h.rows("order_sends")).toHaveLength(0);
    // The cart write still failed (no Kroger link) and rolled the bare advance back —
    // groceries were never blocked by telemetry.
    expect(result.cart.code).toBe("reauth_required");
    expect(h.rows<{ status: string }>("grocery_list")[0].status).toBe("active");
  });

  it("buildKrogerSendSnapshot maps provenance across the four line origins (design D6)", async () => {
    const h = sqliteEnv([T]);
    seedIdentity(h, "chicken", "meat");
    const ctx: SnapshotContext = {
      getLocationId: async () => "loc-1",
      toBuyByKey: new Map([
        ["chicken", { name: "chicken", key: "chicken", quantity: 1, for_recipes: [], assumed_quantity: true }],
        ["black beans", { name: "black beans", key: "black beans", quantity: 1, for_recipes: [], assumed_quantity: true }],
        ["parsley", { name: "parsley", key: "parsley", quantity: 1, for_recipes: ["side"], assumed_quantity: true }],
        ["gum", { name: "gum", key: "gum", quantity: 1, for_recipes: [], assumed_quantity: true }],
      ]),
      storedByKey: new Map([["chicken", { kind: "grocery", domain: "grocery" }]]),
      storedKeys: new Set(["chicken"]), // a stored ad_hoc list row
      planKeys: new Set(["black beans"]), // a server-derived plan need
      // parsley: a menu_needs side carrying for_recipes; gum: a bare caller extra.
    };
    const line = (key: string) => ({
      name: key,
      key,
      sku: `SKU-${key}`,
      brand: "B",
      size: null,
      quantity: 1,
      assumed_quantity: true,
      price: { regular: 2, promo: 0 },
      on_sale: false,
    });
    const { send, snapLines } = await buildKrogerSendSnapshot(
      h.env,
      T,
      [line("chicken"), line("black beans"), line("parsley"), line("gum")],
      ctx,
    );
    expect(send).toMatchObject({ store: "kroger", locationId: "loc-1", fulfillment: "kroger_online", orderListId: null });
    const byKey = Object.fromEntries(snapLines.map((l) => [l.lineKey, l.provenance]));
    expect(byKey).toEqual({ chicken: "planned", "black beans": "planned", parsley: "planned", gum: "impulse" });
  });

  it("buildKrogerSendSnapshot stamps departments: household immediate, memo hit, cold id NULL-pending", async () => {
    const h = sqliteEnv([T]);
    seedIdentity(h, "tomatillos", "produce"); // memoized
    // "brand new thing" has no identity row — cold, pending.
    const ctx: SnapshotContext = {
      getLocationId: async () => "loc-1",
      toBuyByKey: new Map(),
      storedByKey: new Map([
        ["paper towels", { kind: "household", domain: "grocery" }],
        ["2x4 lumber", { kind: "grocery", domain: "home-improvement" }],
      ]),
      storedKeys: new Set(["paper towels", "2x4 lumber", "tomatillos", "brand new thing"]),
      planKeys: new Set(),
    };
    const line = (key: string) => ({
      name: key,
      key,
      sku: `SKU-${key}`,
      brand: "B",
      size: null,
      quantity: 1,
      assumed_quantity: true,
      price: { regular: 4.99, promo: 3.99 },
      on_sale: true,
    });
    const { snapLines } = await buildKrogerSendSnapshot(
      h.env,
      T,
      [line("paper towels"), line("2x4 lumber"), line("tomatillos"), line("brand new thing")],
      ctx,
    );
    const byKey = Object.fromEntries(snapLines.map((l) => [l.lineKey, l.department]));
    expect(byKey).toEqual({
      "paper towels": "household", // kind override — immediate, never pending
      "2x4 lumber": "household", // non-grocery domain — the SCHEMAS.md fixture row
      tomatillos: "produce", // identity memo hit
      "brand new thing": null, // cold id — NULL = pending classification
    });
    // The quote fields ride the resolution: effective price is the promo when on sale.
    expect(snapLines[2].unitPrice).toBe(3.99);
    expect(snapLines[2].savings).toBe(1.0);
    expect(snapLines[2].estimated).toBe(0);
  });
});
