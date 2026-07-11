import { describe, it, expect } from "vitest";
import {
  readPantry,
  applyPantryRowOps,
  markPantryVerifiedRows,
  readPantryNames,
  readMealPlan,
  applyMealPlanRowOps,
  mealPlanDeleteByIdStmt,
  readGroceryList,
  readGroceryListReified,
  addGroceryRow,
  updateGroceryRow,
  removeGroceryRow,
  advanceInCartRows,
  advanceOrderedRows,
  rollbackInCartRows,
} from "../src/session-db.js";
import { fakeD1 } from "./fake-d1.js";

const TODAY = "2026-06-24";

describe("pantry → D1 rows", () => {
  it("read_pantry filters by category, location, and prepared as WHERE clauses", async () => {
    const { env } = fakeD1({
      tables: {
        pantry: [
          { tenant: "everett", name: "Milk", normalized_name: "milk", category: "dairy", location: "fridge", prepared_from: null },
          { tenant: "everett", name: "Garlic", normalized_name: "garlic", category: "produce", location: "pantry", prepared_from: null },
          { tenant: "everett", name: "Sofrito", normalized_name: "sofrito", category: null, location: "fridge", prepared_from: "batch" },
          { tenant: "other", name: "Eggs", normalized_name: "eggs", category: "dairy", location: "fridge", prepared_from: null },
        ],
      },
    });
    expect((await readPantry(env, "everett")).map((i) => i.name).sort()).toEqual(["Garlic", "Milk", "Sofrito"]);
    expect((await readPantry(env, "everett", { category: "dairy" })).map((i) => i.name)).toEqual(["Milk"]);
    expect((await readPantry(env, "everett", { location: "fridge" })).map((i) => i.name).sort()).toEqual(["Milk", "Sofrito"]);
    expect((await readPantry(env, "everett", { preparedOnly: true })).map((i) => i.name)).toEqual(["Sofrito"]);
    // Items include both orthogonal fields (either may be absent — NULL reads as unassigned).
    const milk = (await readPantry(env, "everett")).find((i) => i.name === "Milk")!;
    expect(milk).toMatchObject({ category: "dairy", location: "fridge" });
  });

  it("a legacy location-flavored category filter maps onto the location filter (D21 window)", async () => {
    const { env } = fakeD1({
      tables: {
        pantry: [
          { tenant: "everett", name: "Peas", normalized_name: "peas", category: "frozen", location: "freezer", prepared_from: null },
          { tenant: "everett", name: "Milk", normalized_name: "milk", category: "dairy", location: "fridge", prepared_from: null },
        ],
      },
    });
    // category:"freezer" is no longer a category value — behaves as location:"freezer".
    expect((await readPantry(env, "everett", { category: "freezer" })).map((i) => i.name)).toEqual(["Peas"]);
    // "spices" maps onto spice_rack, not a category equality.
    const spiced = fakeD1({
      tables: {
        pantry: [{ tenant: "everett", name: "Cumin", normalized_name: "cumin", category: "spices", location: "spice_rack", prepared_from: null }],
      },
    });
    expect((await readPantry(spiced.env, "everett", { category: "spices" })).map((i) => i.name)).toEqual(["Cumin"]);
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

  it("add inserts a new row when the normalized name is absent (legacy category → location)", async () => {
    const { env, tables } = fakeD1();
    const res = await applyPantryRowOps(env, "everett", [{ op: "add", item: { name: "Butter", category: "fridge" } }], TODAY);
    expect(res.applied).toEqual([{ op: "add", name: "Butter" }]);
    expect(res.warnings).toContainEqual(expect.objectContaining({ op: "add", name: "Butter", field: "category" }));
    expect(tables.pantry).toHaveLength(1);
    expect(tables.pantry[0]).toMatchObject({
      tenant: "everett",
      normalized_name: "butter",
      category: null,
      location: "fridge",
      added_at: TODAY,
    });
  });

  it("location round-trips through the upsert and read", async () => {
    const { env } = fakeD1();
    await applyPantryRowOps(
      env,
      "everett",
      [{ op: "add", item: { name: "Flour", category: "baking", location: "cabinet" } }],
      TODAY,
    );
    const items = await readPantry(env, "everett");
    expect(items[0]).toMatchObject({ name: "Flour", category: "baking", location: "cabinet" });
    expect((await readPantry(env, "everett", { location: "cabinet" })).map((i) => i.name)).toEqual(["Flour"]);
    expect(await readPantry(env, "everett", { location: "fridge" })).toEqual([]);
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

  it("dispose(waste) deletes the row and inserts one waste event in the same batch", async () => {
    const { env, tables, batches } = fakeD1({
      tables: {
        pantry: [
          { tenant: "everett", name: "Cilantro", normalized_name: "cilantro", quantity: "1 bunch", category: "produce", location: "fridge", prepared_from: null },
        ],
      },
    });
    const res = await applyPantryRowOps(
      env,
      "everett",
      [{ op: "dispose", name: "cilantro", disposition: "waste", reason: "over_ripe", occurred_at: "2026-06-20" }],
      TODAY,
    );
    expect(res.applied).toEqual([{ op: "dispose", name: "cilantro", disposition: "waste" }]);
    expect(tables.pantry).toHaveLength(0);
    expect(tables.waste_events).toHaveLength(1);
    const event = tables.waste_events[0];
    expect(event).toMatchObject({
      tenant: "everett",
      name: "Cilantro",
      item_id: "cilantro",
      department: "produce", // the row's in-vocab category (D5 step 2)
      reason: "over_ripe",
      occurred_at: "2026-06-20",
    });
    expect(String(event.id)).toMatch(/^[A-Za-z0-9_-]{1,64}$/); // server-minted when absent
    expect(String(event.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The DELETE and the INSERT ride ONE batch (atomic — design D3).
    const last = batches[batches.length - 1];
    expect(last.some((s) => /DELETE FROM pantry/.test(s.sql))).toBe(true);
    expect(last.some((s) => /INSERT INTO waste_events/.test(s.sql))).toBe(true);
  });

  it("dispose(used) is pure removal — no waste event", async () => {
    const { env, tables } = fakeD1({
      tables: {
        pantry: [{ tenant: "everett", name: "Eggs", normalized_name: "eggs", prepared_from: null }],
      },
    });
    const res = await applyPantryRowOps(env, "everett", [{ op: "dispose", name: "eggs", disposition: "used" }], TODAY);
    expect(res.applied).toEqual([{ op: "dispose", name: "eggs", disposition: "used" }]);
    expect(tables.pantry).toHaveLength(0);
    expect(tables.waste_events).toHaveLength(0);
  });

  it("a replayed event_id short-circuits to applied with exactly one event row and NO row write", async () => {
    const { env, tables } = fakeD1({
      tables: {
        pantry: [{ tenant: "everett", name: "Cilantro", normalized_name: "cilantro", category: "produce", prepared_from: null }],
      },
    });
    const op = { op: "dispose" as const, name: "cilantro", disposition: "waste" as const, reason: "forgot", event_id: "01JREPLAY", occurred_at: "2026-06-20" };
    const first = await applyPantryRowOps(env, "everett", [op], TODAY);
    expect(first.applied).toEqual([{ op: "dispose", name: "cilantro", disposition: "waste" }]);
    expect(tables.waste_events).toHaveLength(1);
    expect(tables.waste_events[0].id).toBe("01JREPLAY");

    // Replay after the row is gone: applied (never a conflict), still exactly one event.
    const replay = await applyPantryRowOps(env, "everett", [op], TODAY);
    expect(replay.applied).toEqual([{ op: "dispose", name: "cilantro", disposition: "waste" }]);
    expect(replay.conflicts).toHaveLength(0);
    expect(tables.waste_events).toHaveLength(1);

    // Replay after the item was RE-ADDED: the new row must not be deleted by the stale replay.
    await applyPantryRowOps(env, "everett", [{ op: "add", item: { name: "Cilantro" } }], TODAY);
    expect(tables.pantry).toHaveLength(1);
    const replay2 = await applyPantryRowOps(env, "everett", [op], TODAY);
    expect(replay2.applied).toEqual([{ op: "dispose", name: "cilantro", disposition: "waste" }]);
    expect(tables.pantry).toHaveLength(1); // untouched
    expect(tables.waste_events).toHaveLength(1);
  });

  it("a waste dispose of an absent row with an UNKNOWN event_id stays a per-op conflict", async () => {
    const { env, tables } = fakeD1();
    const res = await applyPantryRowOps(
      env,
      "everett",
      [{ op: "dispose", name: "ghost", disposition: "waste", reason: "forgot", event_id: "01JNEVER" }],
      TODAY,
    );
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts).toContainEqual({ op: "dispose", name: "ghost", reason: "no pantry item with that name" });
    expect(tables.waste_events).toHaveLength(0);
  });

  it("shape violations are a whole-call validation_failed ToolError (shared tool + /api posture)", async () => {
    const { env, tables } = fakeD1({
      tables: { pantry: [{ tenant: "everett", name: "Milk", normalized_name: "milk", prepared_from: null }] },
    });
    await expect(
      applyPantryRowOps(env, "everett", [{ op: "dispose", name: "milk" }], TODAY),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      applyPantryRowOps(env, "everett", [{ op: "dispose", name: "milk", disposition: "waste", reason: "not-a-reason" }], TODAY),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      applyPantryRowOps(
        env,
        "everett",
        [{ op: "dispose", name: "milk", disposition: "waste", reason: "forgot", event_id: "bad id!" }],
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      applyPantryRowOps(
        env,
        "everett",
        [{ op: "dispose", name: "milk", disposition: "waste", reason: "forgot", occurred_at: "20-06-2026" }],
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(tables.pantry).toHaveLength(1); // nothing written on any of them
    expect(tables.waste_events).toHaveLength(0);
  });

  it("department stamping precedence: leftovers → row category → identity memo → NULL pending", async () => {
    const { env, tables } = fakeD1({
      tables: {
        pantry: [
          // 1. prepared_from wins regardless of category.
          { tenant: "everett", name: "Cooked rice", normalized_name: "cooked rice", category: "grains", prepared_from: "salmon-with-rice" },
          // 2. else the row's in-vocab category.
          { tenant: "everett", name: "Cheddar", normalized_name: "cheddar", category: "dairy", prepared_from: null },
          // 3. else the identity memo (the stored canonical key resolved through the funnel).
          { tenant: "everett", name: "Scallions", normalized_name: "green onion", category: null, prepared_from: null },
          // 4. else NULL = pending (the cron fills it).
          { tenant: "everett", name: "Mystery jar", normalized_name: "mystery jar", category: null, prepared_from: null },
        ],
        ingredient_identity: [
          { id: "green onion", base: "green onion", representative: null, category: "produce" },
        ],
        // The dispose NAME arrives as a different surface form; the funnel resolves it
        // onto the stored key, and the memo reads that key's identity category.
        ingredient_alias: [{ variant: "green onions", id: "green onion" }],
        novel_ingredient_terms: [],
      },
    });
    await applyPantryRowOps(
      env,
      "everett",
      [
        { op: "dispose", name: "cooked rice", disposition: "waste", reason: "forgot" },
        { op: "dispose", name: "cheddar", disposition: "waste", reason: "moldy" },
        { op: "dispose", name: "green onions", disposition: "waste", reason: "spoiled" },
        { op: "dispose", name: "mystery jar", disposition: "waste", reason: "expired" },
      ],
      TODAY,
    );
    const byItem = new Map(tables.waste_events.map((e) => [e.item_id, e]));
    expect(byItem.get("cooked rice")!.department).toBe("leftovers");
    expect(byItem.get("cheddar")!.department).toBe("dairy");
    expect(byItem.get("green onion")!.department).toBe("produce");
    expect(byItem.get("mystery jar")!.department).toBeNull(); // pending — never a guess
  });

  it("warnings surface through applyPantryRowOps and occurred_at defaults to today", async () => {
    const { env, tables } = fakeD1({
      tables: { pantry: [{ tenant: "everett", name: "Basil", normalized_name: "basil", prepared_from: null }] },
    });
    const res = await applyPantryRowOps(
      env,
      "everett",
      [
        { op: "add", item: { name: "Mystery", category: "weird stuff" } },
        { op: "dispose", name: "basil", disposition: "waste", reason: "spoiled" },
      ],
      TODAY,
    );
    expect(res.warnings).toContainEqual(expect.objectContaining({ op: "add", name: "Mystery", field: "category" }));
    expect(tables.waste_events[0].occurred_at).toBe(TODAY);
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
        { tenant: "everett", id: "mp-salmon-001", recipe: "salmon", meal: "dinner", planned_for: "2026-06-25", sides: JSON.stringify(["rice"]) },
        { tenant: "everett", id: "mp-tacos-0001", recipe: "tacos", meal: "dinner", planned_for: null, sides: null },
      ] },
    });
    const plan = await readMealPlan(env, "everett");
    expect(plan).toContainEqual({ id: "mp-salmon-001", recipe: "salmon", meal: "dinner", planned_for: "2026-06-25", sides: ["rice"] });
    expect(plan).toContainEqual({ id: "mp-tacos-0001", recipe: "tacos", meal: "dinner", planned_for: null });
  });

  it("add upserts by recipe; remove deletes; missing remove conflicts", async () => {
    const { env, tables } = fakeD1({
      tables: { meal_plan: [{ tenant: "everett", id: "mp-salmon-001", recipe: "salmon", meal: "dinner", planned_for: "2026-06-10", sides: null }] },
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
      tables: { meal_plan: [{ tenant: "everett", id: "mp-salmon-001", recipe: "salmon", meal: "dinner", planned_for: null, sides: null }] },
    });
    await applyMealPlanRowOps(env, "everett", [{ op: "remove", recipe: "salmon" }]);
    expect(tables.meal_plan).toHaveLength(0);
  });

  it("mealPlanDeleteByIdStmt builds a tenant+id delete", async () => {
    const { env, tables } = fakeD1({
      tables: { meal_plan: [{ tenant: "everett", id: "mp-salmon-001", recipe: "salmon", meal: "dinner", planned_for: null, sides: null }] },
    });
    await env.DB.batch([mealPlanDeleteByIdStmt(env, "everett", "mp-salmon-001")]);
    expect(tables.meal_plan).toHaveLength(0);
  });
});

describe("meal plan set → D1 rows", () => {
  it("a set persists via the upsert and preserves from_vibe", async () => {
    const { env, tables } = fakeD1({
      tables: { meal_plan: [{ tenant: "everett", id: "mp-miso-00001", recipe: "miso-salmon", meal: "dinner", planned_for: "2026-06-12", sides: '["white rice","roasted broccoli"]', from_vibe: "weeknight-fish" }] },
    });
    const res = await applyMealPlanRowOps(env, "everett", [
      { op: "set", recipe: "miso-salmon", sides: ["white rice"], planned_for: null },
    ]);
    expect(res.applied).toEqual([{ op: "set", id: "mp-miso-00001", recipe: "miso-salmon", meal: "dinner" }]);
    const row = tables.meal_plan[0];
    expect(row.planned_for).toBeNull();
    expect(JSON.parse(row.sides as string)).toEqual(["white rice"]);
    expect(row.from_vibe).toBe("weeknight-fish"); // preserved through the full-row upsert
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

  it("W3: active ⇄ in_cart stays freely writable both ways; ordered → active re-lists and clears the stamp, a later re-advance re-stamps", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null }] },
    });
    expect((await updateGroceryRow(env, "everett", "milk", { status: "in_cart" })).status).toBe("in_cart");
    expect((await updateGroceryRow(env, "everett", "milk", { status: "active" })).status).toBe("active");
    // Walk it legally to ordered, then re-list back to active (canceled order).
    await updateGroceryRow(env, "everett", "milk", { status: "in_cart" });
    const advanced = await updateGroceryRow(env, "everett", "milk", { status: "ordered" }, TODAY);
    expect(advanced.ordered_at).toBe(TODAY); // advance to ordered stamps
    const relisted = await updateGroceryRow(env, "everett", "milk", { status: "active" });
    expect(relisted.status).toBe("active");
    expect(relisted.ordered_at).toBeNull(); // re-list to active clears the stale stamp
    expect(tables.grocery_list[0].status).toBe("active");
    expect(tables.grocery_list[0].ordered_at).toBeNull();
    // Walk it to ordered again, on a later day — the re-advance re-stamps fresh.
    await updateGroceryRow(env, "everett", "milk", { status: "in_cart" });
    const readvanced = await updateGroceryRow(env, "everett", "milk", { status: "ordered" }, "2026-06-05");
    expect(readvanced.ordered_at).toBe("2026-06-05"); // re-advance re-stamps
    expect(tables.grocery_list[0].ordered_at).toBe("2026-06-05");
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

  it("advanceInCartRows advances existing items, inserts unseen ones, and reports what it inserted", async () => {
    const { env, tables } = fakeD1({
      tables: { grocery_list: [{ tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null }] },
    });
    const { inserted } = await advanceInCartRows(env, "everett", [{ name: "Milk" }, { name: "Flour" }], TODAY);
    expect(tables.grocery_list.find((r) => r.normalized_name === "milk")!.status).toBe("in_cart");
    const flour = tables.grocery_list.find((r) => r.normalized_name === "flour")!;
    expect(flour.status).toBe("in_cart");
    expect(flour.source).toBe("menu");
    // The receipt: only the minted row is reported, keyed canonically — the rollback's
    // delete-vs-flip discriminator.
    expect(inserted).toEqual(["flour"]);
  });

  it("rollbackInCartRows reverts pre-existing in_cart rows to active; update-only and status-guarded", async () => {
    const { env, tables } = fakeD1({
      tables: {
        grocery_list: [
          { tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "in_cart", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null },
          { tenant: "everett", name: "Eggs", normalized_name: "eggs", quantity: "1", kind: "grocery", domain: "grocery", status: "ordered", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: "2026-06-02" },
        ],
      },
    });
    await rollbackInCartRows(env, "everett", [{ name: "Milk" }, { name: "Eggs" }, { name: "Flour" }]);
    // The compensated in_cart row reverts; the ordered row is left alone (only the
    // advance being compensated is undone); the unknown line is never inserted.
    expect(tables.grocery_list.find((r) => r.normalized_name === "milk")!.status).toBe("active");
    expect(tables.grocery_list.find((r) => r.normalized_name === "eggs")!.status).toBe("ordered");
    expect(tables.grocery_list.find((r) => r.normalized_name === "flour")).toBeUndefined();
  });

  it("advances/rolls back an add-by-id row keyed on its STORED id, not resolve(name) (coupling #2)", async () => {
    // An add-by-id row: name "Red cabbage", stored key "cabbage::color-red". resolve("Red cabbage")
    // is "red cabbage" (≠ the key), so keying existing rows on a re-derivation of the display would
    // MISS this row and mint a duplicate. The advance/rollback must key on the stored id.
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "cabbage::color-red", base: "cabbage", detail: "color-red", representative: null, display_name: "Red cabbage", source: "auto" },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
        grocery_list: [
          { tenant: "everett", name: "Red cabbage", normalized_name: "cabbage::color-red", display_name: "Red cabbage", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "menu", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null },
        ],
      },
    });
    // The pipeline hands the advance the canonical id as the line name.
    const { inserted } = await advanceInCartRows(env, "everett", [{ name: "cabbage::color-red" }], TODAY);
    expect(inserted).toEqual([]); // matched the stored key → advanced in place, no duplicate minted
    expect(tables.grocery_list.filter((r) => r.tenant === "everett")).toHaveLength(1);
    expect(tables.grocery_list[0].status).toBe("in_cart");
    expect(tables.grocery_list[0].name).toBe("Red cabbage"); // display untouched

    // Roll it back to active by the stored key.
    await rollbackInCartRows(env, "everett", [{ name: "cabbage::color-red" }]);
    expect(tables.grocery_list.filter((r) => r.tenant === "everett")).toHaveLength(1);
    expect(tables.grocery_list.find((r) => r.normalized_name === "cabbage::color-red")!.status).toBe("active");

    // active → in_cart → ordered, the ordered advance also keying on the stored id.
    await advanceInCartRows(env, "everett", [{ name: "cabbage::color-red" }], TODAY);
    await advanceOrderedRows(env, "everett", [{ name: "cabbage::color-red" }], TODAY);
    const row = tables.grocery_list.find((r) => r.normalized_name === "cabbage::color-red")!;
    expect(row.status).toBe("ordered");
    expect(row.ordered_at).toBe(TODAY);
    expect(tables.grocery_list.filter((r) => r.tenant === "everett")).toHaveLength(1);
  });

  it("rollbackInCartRows deletes advance-inserted rows and flips only pre-existing ones", async () => {
    const { env, tables } = fakeD1({
      tables: {
        grocery_list: [
          { tenant: "everett", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: null },
          { tenant: "everett", name: "Eggs", normalized_name: "eggs", quantity: "1", kind: "grocery", domain: "grocery", status: "ordered", source: "ad_hoc", for_recipes: "[]", note: null, added_at: "2026-06-01", ordered_at: "2026-06-02" },
        ],
      },
    });
    // Full advance → rollback round-trip: Flour is menu-derived (no row), so the
    // advance mints it and the rollback must DELETE it — flipping it to active would
    // strand a grocery item the member never listed.
    const lines = [{ name: "Milk" }, { name: "Flour" }];
    const { inserted } = await advanceInCartRows(env, "everett", lines, TODAY);
    await rollbackInCartRows(env, "everett", lines, inserted);

    expect(tables.grocery_list.find((r) => r.normalized_name === "milk")!.status).toBe("active");
    expect(tables.grocery_list.find((r) => r.normalized_name === "flour")).toBeUndefined(); // deleted, not stranded
    expect(tables.grocery_list.find((r) => r.normalized_name === "eggs")!.status).toBe("ordered"); // unrelated row untouched
    expect(tables.grocery_list).toHaveLength(2);
  });
});

describe("grocery list add-by-id → D1 rows (reify-ingredient-display-names)", () => {
  it("a valid id keys the row on the id but names it with the node's idLabel (display_name null); a second add-by-id dedups", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "cabbage::color-red", base: "cabbage", detail: "color-red", representative: null, display_name: "Red cabbage", source: "auto" },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
      },
    });
    // No posted name → the row's display is the node's curated idLabel ("Red cabbage"), never the id.
    const first = await addGroceryRow(env, "everett", { id: "cabbage::color-red" }, TODAY);
    expect(first.merged).toBe(false);
    expect(tables.grocery_list).toHaveLength(1);
    const row = tables.grocery_list[0];
    expect(row.normalized_name).toBe("cabbage::color-red"); // the validated id is the key, NOT resolve(name)
    expect(row.name).toBe("Red cabbage"); // the node's idLabel — a clean display, never the raw id
    expect(row.name).not.toContain("::");
    expect(row.display_name).toBeNull(); // no explicit override — the row's `name` carries the display

    // A second add-by-id dedups on the STORED id (not a re-derivation of the surface form); keep-first
    // preserves the surviving display.
    const second = await addGroceryRow(env, "everett", { id: "cabbage::color-red", name: "Ruby cabbage" }, TODAY);
    expect(second.merged).toBe(true);
    expect(tables.grocery_list).toHaveLength(1);
    expect(tables.grocery_list[0].name).toBe("Red cabbage"); // keep-first — the first display survives
    expect(tables.grocery_list[0].normalized_name).toBe("cabbage::color-red");
  });

  it("a posted name is stored as the add-by-id row's DISPLAY (the id remains the key)", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "cabbage::color-red", base: "cabbage", detail: "color-red", representative: null, display_name: "Red cabbage", source: "auto" },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
      },
    });
    const res = await addGroceryRow(env, "everett", { id: "cabbage::color-red", name: "Red cabbage" }, TODAY);
    expect(res.merged).toBe(false);
    expect(tables.grocery_list[0].name).toBe("Red cabbage"); // the posted display
    expect(tables.grocery_list[0].name).not.toContain("::");
    expect(tables.grocery_list[0].normalized_name).toBe("cabbage::color-red"); // still keyed on the id
    expect(tables.grocery_list[0].display_name).toBeNull();
  });

  it("a well-formed but NON-SURVIVOR id (no live node) is rejected: falls back to name, else validation_failed", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "cabbage::color-red", base: "cabbage", detail: "color-red", representative: null, display_name: "Red cabbage", source: "auto" },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
      },
    });
    // Well-formed id but no live node backs it (a never-minted or merged-away-loser id) → with a
    // name, drop the id and key on the name; the non-survivor id is never a stored key.
    const res = await addGroceryRow(env, "everett", { id: "kale::color-purple", name: "Purple kale" }, TODAY);
    expect(res.merged).toBe(false);
    expect(tables.grocery_list[0].normalized_name).toBe("purple kale");
    expect(tables.grocery_list[0].normalized_name).not.toBe("kale::color-purple");

    // The same non-survivor id with NO name is a structured validation_failed — never store an unbacked key.
    await expect(addGroceryRow(env, "everett", { id: "kale::color-purple" }, TODAY)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(tables.grocery_list).toHaveLength(1); // only the fallback row above
  });

  it("a malformed id WITH a name falls back to the name path and never persists an unresolvable key", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_identity: [], ingredient_alias: [], novel_ingredient_terms: [] },
    });
    const res = await addGroceryRow(env, "everett", { id: "Cabbage (Red)", name: "Red cabbage" }, TODAY);
    expect(res.merged).toBe(false);
    expect(tables.grocery_list).toHaveLength(1);
    // The unresolvable id is dropped: the row keys on the name, never the invalid id.
    expect(tables.grocery_list[0].normalized_name).toBe("red cabbage");
    expect(tables.grocery_list[0].normalized_name).not.toBe("Cabbage (Red)");
  });

  it("an invalid id with NO name is a structured validation_failed and stores nothing", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_identity: [], ingredient_alias: [], novel_ingredient_terms: [] },
    });
    await expect(addGroceryRow(env, "everett", { id: "dates (pitted)" }, TODAY)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(tables.grocery_list).toHaveLength(0);
  });

  it("the id-absent path is unchanged: keyed on resolve(name), display_name null", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_identity: [], ingredient_alias: [], novel_ingredient_terms: [] },
    });
    await addGroceryRow(env, "everett", { name: "Olive Oil" }, TODAY);
    expect(tables.grocery_list[0].normalized_name).toBe("olive oil");
    expect(tables.grocery_list[0].display_name).toBeNull();
  });
});

describe("readGroceryListReified — legacy id-named rows (reify-ingredient-display-names Move D)", () => {
  it("reifies a legacy row (name === normalized_name) to the curated node label; leaves a typed row and an override untouched", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "cabbage::color-red", base: "cabbage", detail: "color-red", representative: null, display_name: "Red cabbage", source: "auto" },
          { id: "kale::type-lacinato", base: "kale", detail: "type-lacinato", representative: null, display_name: null, source: "auto" },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
        grocery_list: [
          // A legacy id-named row (name IS the raw id) with a curated node → reify to "Red cabbage".
          { tenant: "everett", name: "cabbage::color-red", normalized_name: "cabbage::color-red", display_name: null, quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "menu", for_recipes: "[]", note: null, added_at: TODAY, ordered_at: null },
          // A legacy id-named row with NO curated display → the deterministic base/detail synthesis.
          { tenant: "everett", name: "kale::type-lacinato", normalized_name: "kale::type-lacinato", display_name: null, quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "menu", for_recipes: "[]", note: null, added_at: TODAY, ordered_at: null },
          // A typed row (member phrasing) — its name is not an id, so it is untouched.
          { tenant: "everett", name: "Olive Oil", normalized_name: "olive oil", display_name: null, quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: TODAY, ordered_at: null },
          // An id-named row that ALSO carries an explicit override — the override wins, never overwritten.
          { tenant: "everett", name: "carrot", normalized_name: "carrot", display_name: "Rainbow carrots", quantity: "1", kind: "grocery", domain: "grocery", status: "active", source: "menu", for_recipes: "[]", note: null, added_at: TODAY, ordered_at: null },
        ],
      },
    });
    const items = await readGroceryListReified(env, "everett");
    const byKey = new Map(items.map((it) => [it.normalized_name, it]));
    // Legacy id-named rows: display resolved from the node (curated, else synthesis), never a raw id.
    expect(byKey.get("cabbage::color-red")!.display_name).toBe("Red cabbage");
    expect(byKey.get("kale::type-lacinato")!.display_name).toBe("kale (type-lacinato)");
    for (const it of items) expect(it.display_name ?? "").not.toContain("::");
    // A typed row (name ≠ id) is a no-op — its member phrasing renders directly, display_name stays null.
    expect(byKey.get("olive oil")!.display_name).toBeNull();
    expect(byKey.get("olive oil")!.name).toBe("Olive Oil");
    // An explicit override is preserved, never re-derived.
    expect(byKey.get("carrot")!.display_name).toBe("Rainbow carrots");
  });

  it("is a no-op passthrough when no row is id-named (a NEW add-by-id row already carries a display name)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "cabbage::color-red", base: "cabbage", detail: "color-red", representative: null, display_name: "Red cabbage", source: "auto" },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
      },
    });
    // A real add-by-id write stores the display as `name` (name ≠ normalized_name), so the reify pass
    // leaves it null — the row already renders its own clean `name`.
    await addGroceryRow(env, "everett", { id: "cabbage::color-red", name: "Red cabbage" }, TODAY);
    const items = await readGroceryListReified(env, "everett");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Red cabbage");
    expect(items[0].display_name).toBeNull(); // not reified — name already carries the display
  });

  it("does NOT reify a non-food row whose name collides with a food id (the identity graph is food-only)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "sage", base: "sage", detail: null, representative: null, display_name: "Fresh sage", source: "auto" },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
        grocery_list: [
          // A non-food "sage" (a scent/cleaner) — its normalizeName key == its name, colliding with the
          // food id "sage", but a non-food row must never render a food label.
          { tenant: "everett", name: "sage", normalized_name: "sage", display_name: null, quantity: "1", kind: "other", domain: "grocery", status: "active", source: "ad_hoc", for_recipes: "[]", note: null, added_at: TODAY, ordered_at: null },
        ],
      },
    });
    const items = await readGroceryListReified(env, "everett");
    expect(items[0].display_name).toBeNull(); // not reified (non-food)
    expect(items[0].name).toBe("sage"); // renders the member's phrasing, not "Fresh sage"
  });
});
