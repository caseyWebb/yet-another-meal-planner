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
