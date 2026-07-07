import { describe, it, expect } from "vitest";
import {
  readPantry,
  applyPantryRowOps,
  markPantryVerifiedRows,
  readPantryNames,
  readMealPlan,
  applyMealPlanRowOps,
  mealPlanDeleteStmt,
  readGroceryList,
  addGroceryRow,
  updateGroceryRow,
  removeGroceryRow,
  advanceInCartRows,
} from "../src/session-db.js";
import { fakeD1 } from "./fake-d1.js";

const TODAY = "2026-06-24";

describe("pantry → D1 rows", () => {
  it("read_pantry filters by category and prepared as WHERE clauses", async () => {
    const { env } = fakeD1({
      tables: {
        pantry: [
          { tenant: "everett", name: "Milk", normalized_name: "milk", category: "fridge", prepared_from: null },
          { tenant: "everett", name: "Garlic", normalized_name: "garlic", category: "pantry", prepared_from: null },
          { tenant: "everett", name: "Sofrito", normalized_name: "sofrito", category: "fridge", prepared_from: "batch" },
          { tenant: "other", name: "Eggs", normalized_name: "eggs", category: "fridge", prepared_from: null },
        ],
      },
    });
    expect((await readPantry(env, "everett")).map((i) => i.name).sort()).toEqual(["Garlic", "Milk", "Sofrito"]);
    expect((await readPantry(env, "everett", { category: "fridge" })).map((i) => i.name).sort()).toEqual(["Milk", "Sofrito"]);
    expect((await readPantry(env, "everett", { preparedOnly: true })).map((i) => i.name)).toEqual(["Sofrito"]);
  });

  it("add upserts one row (merge: keep added_at, refresh last_verified_at, merged:true)", async () => {
    const { env, tables } = fakeD1({
      tables: {
        pantry: [
          { tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "full", category: "fridge", prepared_from: null, added_at: "2026-01-01", last_verified_at: "2026-06-01" },
        ],
      },
    });
    const res = await applyPantryRowOps(env, "everett", [{ op: "add", item: { name: "Milk", quantity: "low" } }], TODAY);
    expect(res.applied).toEqual([{ op: "add", name: "Milk", merged: true }]);
    expect(tables.pantry).toHaveLength(1);
    const milk = tables.pantry[0];
    expect(milk.quantity).toBe("low");
    expect(milk.added_at).toBe("2026-01-01"); // preserved
    expect(milk.last_verified_at).toBe(TODAY); // refreshed
  });

  it("add inserts a new row when the normalized name is absent", async () => {
    const { env, tables } = fakeD1();
    const res = await applyPantryRowOps(env, "everett", [{ op: "add", item: { name: "Butter", category: "fridge" } }], TODAY);
    expect(res.applied).toEqual([{ op: "add", name: "Butter" }]);
    expect(tables.pantry).toHaveLength(1);
    expect(tables.pantry[0]).toMatchObject({ tenant: "everett", normalized_name: "butter", category: "fridge", added_at: TODAY });
  });

  it("remove deletes the row; a missing remove conflicts and writes nothing", async () => {
    const { env, tables } = fakeD1({
      tables: { pantry: [{ tenant: "everett", name: "Milk", normalized_name: "milk", prepared_from: null }] },
    });
    const res = await applyPantryRowOps(env, "everett", [
      { op: "remove", name: "milk" },
      { op: "remove", name: "ghost" },
    ], TODAY);
    expect(res.applied).toEqual([{ op: "remove", name: "milk" }]);
    expect(res.conflicts).toContainEqual({ op: "remove", name: "ghost", reason: "no pantry item with that name" });
    expect(tables.pantry).toHaveLength(0);
  });

  it("mark_pantry_verified refreshes last_verified_at and reports missing", async () => {
    const { env, tables } = fakeD1({
      tables: { pantry: [{ tenant: "everett", name: "Milk", normalized_name: "milk", prepared_from: null, added_at: "2026-01-01", last_verified_at: "2026-06-01" }] },
    });
    const res = await markPantryVerifiedRows(env, "everett", ["milk", "ghost"], TODAY);
    expect(res.verified).toEqual(["milk"]);
    expect(res.missing).toEqual(["ghost"]);
    expect(tables.pantry[0].last_verified_at).toBe(TODAY);
    expect(tables.pantry[0].added_at).toBe("2026-01-01");
  });

  it("readPantryNames returns the tenant's normalized names", async () => {
    const { env } = fakeD1({
      tables: { pantry: [
        { tenant: "everett", name: "Olive Oil", normalized_name: "olive oil", prepared_from: null },
        { tenant: "other", name: "Eggs", normalized_name: "eggs", prepared_from: null },
      ] },
    });
    expect([...(await readPantryNames(env, "everett"))]).toEqual(["olive oil"]);
  });

  it("a food pantry add stores the CANONICAL id as normalized_name (funnel via ingredient_alias)", async () => {
    // Seed the identity graph so "scallions" resolves to the survivor `green onion`; the add
    // must key the row under that canonical id, not normalizeName("scallions").
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "green onion", base: "green onion", representative: null }],
        ingredient_alias: [{ variant: "scallions", id: "green onion" }],
        novel_ingredient_terms: [],
      },
    });
    await applyPantryRowOps(env, "everett", [{ op: "add", item: { name: "Scallions" } }], TODAY);
    expect(tables.pantry).toHaveLength(1);
    expect(tables.pantry[0]).toMatchObject({ name: "Scallions", normalized_name: "green onion" });
  });

  it("a novel food pantry add captures the term into novel_ingredient_terms", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_identity: [], ingredient_alias: [], novel_ingredient_terms: [] },
    });
    await applyPantryRowOps(env, "everett", [{ op: "add", item: { name: "2 lb Gochujang" } }], TODAY);
    // normalizeIngredient strips the quantity → the canonical form keyed + captured.
    expect(tables.pantry[0].normalized_name).toBe("gochujang");
    expect(tables.novel_ingredient_terms.map((r) => r.term)).toEqual(["gochujang"]);
  });
});

describe("meal plan → D1 rows", () => {
  it("read returns rows with parsed sides", async () => {
    const { env } = fakeD1({
      tables: { meal_plan: [
        { tenant: "everett", recipe: "salmon", planned_for: "2026-06-25", sides: JSON.stringify(["rice"]) },
        { tenant: "everett", recipe: "tacos", planned_for: null, sides: null },
      ] },
    });
    const plan = await readMealPlan(env, "everett");
    expect(plan).toContainEqual({ recipe: "salmon", planned_for: "2026-06-25", sides: ["rice"] });
    expect(plan).toContainEqual({ recipe: "tacos", planned_for: null });
  });

  it("add upserts by recipe; remove deletes; missing remove conflicts", async () => {
    const { env, tables } = fakeD1({
      tables: { meal_plan: [{ tenant: "everett", recipe: "salmon", planned_for: "2026-06-10", sides: null }] },
    });
    const res = await applyMealPlanRowOps(env, "everett", [
      { op: "add", recipe: "salmon", planned_for: "2026-06-12", sides: ["broccoli"] },
      { op: "add", recipe: "tacos", planned_for: "2026-06-13" },
      { op: "remove", recipe: "ghost" },
    ]);
    expect(res.conflicts).toContainEqual({ op: "remove", recipe: "ghost", reason: "no planned row for that recipe" });
    const salmon = tables.meal_plan.find((r) => r.recipe === "salmon")!;
    expect(salmon.planned_for).toBe("2026-06-12");
    expect(JSON.parse(salmon.sides as string)).toEqual(["broccoli"]);
    expect(tables.meal_plan.find((r) => r.recipe === "tacos")).toBeTruthy();
  });

  it("remove drops the row", async () => {
    const { env, tables } = fakeD1({
      tables: { meal_plan: [{ tenant: "everett", recipe: "salmon", planned_for: null, sides: null }] },
    });
    await applyMealPlanRowOps(env, "everett", [{ op: "remove", recipe: "salmon" }]);
    expect(tables.meal_plan).toHaveLength(0);
  });

  it("mealPlanDeleteStmt builds a tenant+recipe delete", async () => {
    const { env, tables } = fakeD1({
      tables: { meal_plan: [{ tenant: "everett", recipe: "salmon", planned_for: null, sides: null }] },
    });
    await env.DB.batch([mealPlanDeleteStmt(env, "everett", "salmon")]);
    expect(tables.meal_plan).toHaveLength(0);
  });
});

describe("grocery list → D1 rows", () => {
  it("read filters by status as a WHERE clause", async () => {
    const { env } = fakeD1({
      tables: { grocery_list: [
        { tenant: "everett", name: "Milk", normalized_name: "milk", status: "active", for_recipes: "[]" },
        { tenant: "everett", name: "Eggs", normalized_name: "eggs", status: "in_cart", for_recipes: "[]" },
      ] },
    });
    expect((await readGroceryList(env, "everett")).map((i) => i.name).sort()).toEqual(["Eggs", "Milk"]);
    expect((await readGroceryList(env, "everett", "active")).map((i) => i.name)).toEqual(["Milk"]);
  });

  it("add inserts a new row; re-add merges (dedup by normalized name)", async () => {
    const { env, tables } = fakeD1();
    const first = await addGroceryRow(env, "everett", { name: "Olive Oil", for_recipes: ["pasta"] }, TODAY);
    expect(first.merged).toBe(false);
    expect(tables.grocery_list).toHaveLength(1);
    const second = await addGroceryRow(env, "everett", { name: "olive oil", for_recipes: ["risotto"], quantity: "2" }, TODAY);
    expect(second.merged).toBe(true);
    expect(tables.grocery_list).toHaveLength(1);
    const row = tables.grocery_list[0];
    expect(JSON.parse(row.for_recipes as string).sort()).toEqual(["pasta", "risotto"]);
    expect(row.quantity).toBe("2");
  });

  it("update patches an existing item; absent name → not_found", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null }] },
    });
    const item = await updateGroceryRow(env, "everett", "milk", { status: "in_cart" });
    expect(item.status).toBe("in_cart");
    expect(tables.grocery_list[0].status).toBe("in_cart");
    await expect(updateGroceryRow(env, "everett", "ghost", { status: "ordered" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("remove deletes a present item; reports not found otherwise", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", status: "active", for_recipes: "[]" }] },
    });
    expect((await removeGroceryRow(env, "everett", "ghost")).found).toBe(false);
    expect(tables.grocery_list).toHaveLength(1);
    expect((await removeGroceryRow(env, "everett", "Milk")).found).toBe(true);
    expect(tables.grocery_list).toHaveLength(0);
  });

  it("a food grocery add keys normalized_name on the canonical id; a re-add via an alias merges", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "green onion", base: "green onion", representative: null }],
        ingredient_alias: [
          { variant: "scallions", id: "green onion" },
          { variant: "green onions", id: "green onion" },
        ],
        novel_ingredient_terms: [],
      },
    });
    const first = await addGroceryRow(env, "everett", { name: "Scallions", for_recipes: ["stir-fry"] }, TODAY);
    expect(first.merged).toBe(false);
    expect(tables.grocery_list[0].normalized_name).toBe("green onion");
    // A different surface form of the SAME food merges into the one row.
    const second = await addGroceryRow(env, "everett", { name: "green onions", for_recipes: ["soup"] }, TODAY);
    expect(second.merged).toBe(true);
    expect(tables.grocery_list).toHaveLength(1);
    expect(JSON.parse(tables.grocery_list[0].for_recipes as string).sort()).toEqual(["soup", "stir-fry"]);
  });

  it("a non-food grocery add stays on normalizeName and never captures", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_identity: [], ingredient_alias: [], novel_ingredient_terms: [] },
    });
    await addGroceryRow(env, "everett", { name: "AA Batteries", kind: "household" }, TODAY);
    expect(tables.grocery_list[0].normalized_name).toBe("aa batteries"); // normalizeName, not a captured id
    expect(tables.novel_ingredient_terms).toHaveLength(0); // non-food never enters the graph
  });

  it("remove deletes a food row addressed by an alias surface form (dual-key delete)", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "green onion", base: "green onion", representative: null }],
        ingredient_alias: [
          { variant: "scallions", id: "green onion" },
          { variant: "green onions", id: "green onion" },
        ],
        grocery_list: [
          { tenant: "everett", name: "Scallions", normalized_name: "green onion", status: "active", kind: "grocery", domain: "grocery", for_recipes: "[]" },
        ],
        novel_ingredient_terms: [],
      },
    });
    // Remove by a DIFFERENT surface form — must resolve to the same canonical id and delete the row.
    const res = await removeGroceryRow(env, "everett", "green onions");
    expect(res.found).toBe(true);
    expect(tables.grocery_list).toHaveLength(0);
  });

  it("W3: active → ordered is rejected (validation_failed, {from,to}), row unchanged", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null }] },
    });
    await expect(updateGroceryRow(env, "everett", "milk", { status: "ordered" })).rejects.toMatchObject({
      code: "validation_failed",
      context: { name: "Milk", from: "active", to: "ordered" },
    });
    expect(tables.grocery_list[0].status).toBe("active");
    expect(tables.grocery_list[0].ordered_at).toBeNull();
  });

  it("W3: in_cart → ordered (the user-asserted advance) is accepted and stamps ordered_at", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "in_cart", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null }] },
    });
    const item = await updateGroceryRow(env, "everett", "milk", { status: "ordered" }, TODAY);
    expect(item.status).toBe("ordered");
    expect(item.ordered_at).toBe(TODAY);
    expect(tables.grocery_list[0].status).toBe("ordered");
    expect(tables.grocery_list[0].ordered_at).toBe(TODAY);
  });

  it("W3: active ⇄ in_cart stays freely writable both ways; ordered → active re-lists", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null }] },
    });
    expect((await updateGroceryRow(env, "everett", "milk", { status: "in_cart" })).status).toBe("in_cart");
    expect((await updateGroceryRow(env, "everett", "milk", { status: "active" })).status).toBe("active");
    // Walk it legally to ordered, then re-list back to active (canceled order).
    await updateGroceryRow(env, "everett", "milk", { status: "in_cart" });
    await updateGroceryRow(env, "everett", "milk", { status: "ordered" }, TODAY);
    expect((await updateGroceryRow(env, "everett", "milk", { status: "active" })).status).toBe("active");
    expect(tables.grocery_list[0].status).toBe("active");
  });

  it("W3: a non-status patch on an ordered row passes the guard untouched", async () => {
    const { env } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "ordered", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: "2026-06-02" }] },
    });
    const item = await updateGroceryRow(env, "everett", "milk", { quantity: "2" });
    expect(item.quantity).toBe("2");
    expect(item.status).toBe("ordered");
    expect(item.ordered_at).toBe("2026-06-02"); // untouched — not re-stamped
  });

  it("advanceInCartRows advances existing items and inserts unseen ones", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null }] },
    });
    await advanceInCartRows(env, "everett", [{ name: "Milk" }, { name: "Flour" }], TODAY);
    expect(tables.grocery_list.find((r) => r.normalized_name === "milk")!.status).toBe("in_cart");
    const flour = tables.grocery_list.find((r) => r.normalized_name === "flour")!;
    expect(flour.status).toBe("in_cart");
    expect(flour.source).toBe("menu");
  });
});
