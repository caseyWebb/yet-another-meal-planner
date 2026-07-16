// The derived to-buy view op (member-app-grocery D1/D3) over the REAL-SQLite env:
// deriveMenuNeeds (plan × projected ingredients_full) and computeToBuyView (the unchanged
// computeToBuy algebra post-partitioned into origin: list | plan | both, with the
// pantry-coverage metadata join, the in_cart stale-cart section, underived honesty, and
// the no-materialization guarantee).
import { describe, it, expect } from "vitest";
import { deriveMenuNeeds, computeToBuyView } from "../src/to-buy.js";
import { addGroceryRow, updateGroceryRow } from "../src/session-db.js";
import { normalizeName } from "../src/grocery.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";
import type { FlyerRollup } from "../src/flyer-warm.js";

const TODAY = "2026-07-08";
const T = "casey";

/** Insert a projected `recipes` row carrying (or lacking) ingredients_full. */
function seedRecipe(h: SqliteEnv, slug: string, full: string[] | null): void {
  h.raw
    .prepare("INSERT INTO recipes (slug, title, ingredients_full) VALUES (?, ?, ?)")
    .run(slug, slug, full ? JSON.stringify(full) : null);
}

function seedPlan(h: SqliteEnv, recipe: string, sides: string[] = []): void {
  h.raw
    .prepare("INSERT INTO meal_plan (tenant, id, recipe, planned_for, sides) VALUES (?, lower(hex(randomblob(16))), ?, NULL, ?)")
    .run(T, recipe, JSON.stringify(sides));
}

function seedPantry(h: SqliteEnv, name: string, key: string, extra: { quantity?: string; category?: string; last_verified_at?: string } = {}): void {
  h.raw
    .prepare(
      "INSERT INTO pantry (tenant, name, normalized_name, quantity, category, added_at, last_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(T, name, key, extra.quantity ?? null, extra.category ?? null, TODAY, extra.last_verified_at ?? null);
}

/** Seed one identity node (a live survivor) so an add-by-id accepts its id and `idLabel` can
 *  resolve a curated `display_name` (or synthesize one) at read. */
function seedNode(h: SqliteEnv, id: string, display: string | null = null): void {
  const base = id.includes("::") ? id.slice(0, id.indexOf("::")) : id;
  const detail = id.includes("::") ? id.slice(id.indexOf("::") + 2) : null;
  h.raw
    .prepare("INSERT INTO ingredient_identity (id, base, detail, display_name, concrete, source) VALUES (?, ?, ?, ?, 1, 'auto')")
    .run(id, base, detail, display);
}

/** Register the scallions ≡ green-onion alias so canonical-id merges are exercised. */
function seedAlias(h: SqliteEnv): void {
  h.raw
    .prepare("INSERT INTO ingredient_identity (id, base, concrete, source) VALUES ('green-onion', 'green onion', 1, 'auto')")
    .run();
  h.raw
    .prepare("INSERT INTO ingredient_alias (variant, id, source, confidence) VALUES ('scallions', 'green-onion', 'auto', 0.95)")
    .run();
}

describe("deriveMenuNeeds", () => {
  it("derives one need per canonical id, merging for_recipes across planned recipes", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken", "black beans", "cilantro"]);
    seedRecipe(h, "salmon", ["salmon", "cilantro"]);
    seedPlan(h, "stew");
    seedPlan(h, "salmon");
    const { needs, underived } = await deriveMenuNeeds(h.env, T);
    expect(underived).toEqual([]);
    const cilantro = needs.find((n) => n.name === "cilantro")!;
    expect(cilantro.for_recipes!.sort()).toEqual(["salmon", "stew"]);
    expect(needs.map((n) => n.name).sort()).toEqual(["black beans", "chicken", "cilantro", "salmon"]);
    // Presence-only: no quantities derived.
    expect(needs.every((n) => n.quantity === undefined)).toBe(true);
  });

  it("reports a planned slug with no index row, a NULL facet, or an empty facet as underived", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "null-facet", null);
    seedRecipe(h, "empty-facet", []);
    seedPlan(h, "null-facet");
    seedPlan(h, "empty-facet");
    seedPlan(h, "no-row"); // planned but never projected
    const { needs, underived } = await deriveMenuNeeds(h.env, T);
    expect(needs).toEqual([]);
    expect(underived.sort()).toEqual(["empty-facet", "no-row", "null-facet"]);
  });

  it("ignores open-world sides (they have no recipe to derive from)", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken"]);
    seedPlan(h, "stew", ["roasted broccoli"]);
    const { needs, underived } = await deriveMenuNeeds(h.env, T);
    expect(needs.map((n) => n.name)).toEqual(["chicken"]);
    expect(underived).toEqual([]); // a side string is not an underived recipe
  });

  it("derives nothing for an empty plan", async () => {
    const h = sqliteEnv([T]);
    expect(await deriveMenuNeeds(h.env, T)).toEqual({ needs: [], underived: [] });
  });
});

describe("to-buy snapshot freshness", () => {
  it("returns an opaque digest on plain and enriched reads and changes with row state", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "Milk" }, TODAY);
    const plain = await computeToBuyView(h.env, T);
    const enriched = await computeToBuyView(h.env, T, { enrich: true });
    expect(plain.snapshot_version).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(enriched.snapshot_version).toMatch(/^sha256:[a-f0-9]{64}$/);
    await updateGroceryRow(h.env, T, "Milk", { note: "two cartons" });
    expect((await computeToBuyView(h.env, T)).snapshot_version).not.toBe(plain.snapshot_version);
  });
  it("propagates decision storage failures instead of silently changing shopping truth", async () => {
    const h = sqliteEnv([T]);
    h.raw.exec("DROP TABLE grocery_substitution_decisions");
    await expect(computeToBuyView(h.env, T)).rejects.toMatchObject({ code: "storage_error" });
  });
});

describe("computeToBuyView", () => {
  it("partitions lines into origin plan / list / both and unions for_recipes on both", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken", "black beans"]);
    seedPlan(h, "stew");
    await addGroceryRow(h.env, T, { name: "paper towels", kind: "household" }, TODAY); // list-only
    await addGroceryRow(h.env, T, { name: "chicken", source: "menu", for_recipes: ["old-note"], quantity: "2" }, TODAY); // materialized

    const view = await computeToBuyView(h.env, T);
    const byName = new Map(view.to_buy.map((l) => [l.name, l]));
    expect(byName.get("black beans")!.origin).toBe("plan");
    expect(byName.get("black beans")!.for_recipes).toEqual(["stew"]);
    expect(byName.get("black beans")!.assumed_quantity).toBe(true);
    expect(byName.get("black beans")!.quantity).toBe(1);
    expect(byName.get("paper towels")!.origin).toBe("list");
    expect(byName.get("paper towels")!.kind).toBe("household");
    const both = byName.get("chicken")!;
    expect(both.origin).toBe("both");
    expect(both.for_recipes.sort()).toEqual(["old-note", "stew"]); // stored ∪ derived
    expect(view.underived).toEqual([]);
  });

  it("merges a derived need with a stored row across surface forms (canonical-id join)", async () => {
    const h = sqliteEnv([T]);
    seedAlias(h);
    seedRecipe(h, "soup", ["green-onion"]); // the projected facet carries the canonical id
    seedPlan(h, "soup");
    await addGroceryRow(h.env, T, { name: "Scallions" }, TODAY); // stored under the alias's id

    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy).toHaveLength(1);
    expect(view.to_buy[0].origin).toBe("both");
    expect(view.to_buy[0].key).toBe("green-onion");
  });

  it("a pantry item covers a derived need across surface forms, with verify metadata joined", async () => {
    const h = sqliteEnv([T]);
    seedAlias(h);
    seedRecipe(h, "soup", ["green-onion", "chicken"]);
    seedPlan(h, "soup");
    seedPantry(h, "Green onion", "green-onion", { quantity: "1 bunch", category: "produce", last_verified_at: "2026-06-20" });

    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy.map((l) => l.name)).toEqual(["chicken"]); // green-onion diverted to coverage
    expect(view.pantry_covered).toHaveLength(1);
    expect(view.pantry_covered[0].for_recipes).toEqual(["soup"]);
    expect(view.pantry_covered[0].on_hand).toEqual({
      quantity: "1 bunch",
      category: "produce",
      last_verified_at: "2026-06-20",
    });
  });

  it("suppresses a derived need whose row is IN FLIGHT (no re-buy after a carted order)", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken", "black beans"]);
    seedPlan(h, "stew");
    // The last order carted chicken: its row is in_cart. The derived need must NOT
    // re-surface it as to-buy — it rides the in_cart section instead.
    await addGroceryRow(h.env, T, { name: "chicken", source: "menu" }, TODAY);
    await updateGroceryRow(h.env, T, "chicken", { status: "in_cart" }, TODAY);

    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy.map((l) => l.name)).toEqual(["black beans"]);
    expect(view.in_cart.map((i) => i.name)).toEqual(["chicken"]);
    // Re-listing the row to active brings the merged line back (a canceled order).
    await updateGroceryRow(h.env, T, "chicken", { status: "active" }, TODAY);
    const again = await computeToBuyView(h.env, T);
    expect(again.to_buy.find((l) => l.name === "chicken")?.origin).toBe("both");
  });

  it("suppresses a derived need whose row has advanced to ORDERED, and un-suppresses on re-list to active", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken", "black beans"]);
    seedPlan(h, "stew");
    await addGroceryRow(h.env, T, { name: "chicken", source: "menu" }, TODAY);
    await updateGroceryRow(h.env, T, "chicken", { status: "in_cart" }, TODAY);
    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);

    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy.map((l) => l.name)).toEqual(["black beans"]);
    // Re-listing the row to active (a canceled/undone order) brings the merged line back.
    await updateGroceryRow(h.env, T, "chicken", { status: "active" }, TODAY);
    const again = await computeToBuyView(h.env, T);
    expect(again.to_buy.find((l) => l.name === "chicken")?.origin).toBe("both");
  });

  it("returns the in_cart rows (the stale-cart signal) without them entering to_buy", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    await updateGroceryRow(h.env, T, "olive oil", { status: "in_cart" }, TODAY);
    await addGroceryRow(h.env, T, { name: "salt" }, TODAY);

    const view = await computeToBuyView(h.env, T);
    expect(view.in_cart).toEqual([{ name: "olive oil", key: "olive oil", added_at: TODAY, row_version: 2, sent_in: null, quantity: "1" }]);
    expect(view.to_buy.map((l) => l.name)).toEqual(["salt"]);
  });

  it("writes NOTHING: repeated reads return the same lines and leave every table untouched", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken", "mystery leaf"]);
    seedPlan(h, "stew");
    await addGroceryRow(h.env, T, { name: "salt" }, TODAY);

    const snapshot = (table: string) => JSON.stringify(h.rows(table));
    const before = {
      grocery: snapshot("grocery_list"),
      pantry: snapshot("pantry"),
      plan: snapshot("meal_plan"),
      novel: snapshot("novel_ingredient_terms"),
    };
    const a = await computeToBuyView(h.env, T);
    const b = await computeToBuyView(h.env, T);
    expect(b).toEqual(a);
    expect(snapshot("grocery_list")).toBe(before.grocery);
    expect(snapshot("pantry")).toBe(before.pantry);
    expect(snapshot("meal_plan")).toBe(before.plan);
    // Resolve-only context: even the novel "mystery leaf" term is NOT captured by a read.
    expect(snapshot("novel_ingredient_terms")).toBe(before.novel);
  });

  it("keeps a non-food row on its normalizeName key (never the capture funnel)", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "AA Batteries", kind: "household" }, TODAY);
    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy[0].key).toBe(normalizeName("AA Batteries"));
    expect(view.to_buy[0].origin).toBe("list");
  });

  it("still serves the view when the resolver read degrades (empty context)", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "stew", ["chicken"]);
    seedPlan(h, "stew");
    // Break ONLY the resolver tables' read; session tables keep working.
    const realPrepare = (h.env.DB as D1Database).prepare.bind(h.env.DB as D1Database);
    const env = {
      ...h.env,
      DB: {
        prepare(sql: string) {
          if (/ingredient_identity|ingredient_alias/.test(sql)) throw new Error("D1_ERROR: blip");
          return realPrepare(sql);
        },
        batch: (h.env.DB as D1Database).batch.bind(h.env.DB as D1Database),
      },
    } as unknown as Env;
    const view = await computeToBuyView(env, T);
    expect(view.to_buy.map((l) => l.name)).toEqual(["chicken"]);
  });
});

describe("computeToBuyView — add-by-id rows (reify-ingredient-display-names blocker regression)", () => {
  // A REAL add-by-id row: `name` is the human DISPLAY ("Red cabbage") and `normalized_name` is the
  // canonical id ("cabbage::color-red"), the two stored SEPARATELY. Because the display does NOT
  // resolve back to the id (no alias), the set-algebra MUST key on the STORED id (`storedGroceryKey`)
  // — re-deriving `groceryKey(name)` would mint a garbage key ("red cabbage") and miss the row,
  // causing a double-buy / a missed pantry subtraction / a duplicate plan line. These regressions
  // exercise a real add-by-id row end to end and MUST fail if the key threading is removed. They also
  // assert the row renders its clean display, never a raw `::` id.

  it("(a) a pantry row on the same canonical id cancels an add-by-id row — pantry_covered, not to_buy", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "cabbage::color-red", "Red cabbage");
    await addGroceryRow(h.env, T, { id: "cabbage::color-red", name: "Red cabbage" }, TODAY);
    seedPantry(h, "Red cabbage", "cabbage::color-red");

    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy).toHaveLength(0); // the pantry on the SAME id (keys on cabbage::color-red) subtracts it
    expect(view.pantry_covered.map((l) => l.name)).toEqual(["Red cabbage"]); // renders the display
    expect(view.pantry_covered[0].name).not.toContain("::");
  });

  it("(b) a plan need on the same id MERGES with an add-by-id row into one line (no duplicate)", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "cabbage::color-red", "Red cabbage");
    seedRecipe(h, "slaw", ["cabbage::color-red"]);
    seedPlan(h, "slaw");
    await addGroceryRow(h.env, T, { id: "cabbage::color-red", name: "Red cabbage" }, TODAY);

    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy).toHaveLength(1); // one merged line, never a duplicate
    expect(view.to_buy[0].key).toBe("cabbage::color-red"); // keyed on the STORED id
    expect(view.to_buy[0].origin).toBe("both"); // stored row ∪ derived need
    expect(view.to_buy[0].name).toBe("Red cabbage"); // renders the display
    expect(view.to_buy[0].name).not.toContain("::");
  });

  it("(c) an in-flight (in_cart) add-by-id row suppresses its derived need — no double-buy", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "cabbage::color-red", "Red cabbage");
    seedRecipe(h, "slaw", ["cabbage::color-red", "carrot"]);
    seedPlan(h, "slaw");
    await addGroceryRow(h.env, T, { id: "cabbage::color-red", name: "Red cabbage" }, TODAY);
    // The row keys on the id, so the update finds it by the id (its display does not resolve back).
    await updateGroceryRow(h.env, T, "cabbage::color-red", { status: "in_cart" }, TODAY);

    const view = await computeToBuyView(h.env, T);
    expect(view.to_buy.map((l) => l.key)).toEqual(["carrot"]); // the cabbage need is suppressed (keyed on the id)
    expect(view.in_cart.map((i) => i.name)).toEqual(["Red cabbage"]); // renders the display
    expect(view.in_cart[0].name).not.toContain("::");
  });
});

describe("computeToBuyView — enrich (member-app-differentiators D6, generalized by inline-substitution-hints D2)", () => {
  function seedProfile(h: SqliteEnv, stores: Record<string, unknown>): void {
    h.raw.prepare("INSERT INTO profile (tenant, stores) VALUES (?, ?)").run(T, JSON.stringify(stores));
  }
  function seedSkuAisle(
    h: SqliteEnv,
    ingredient: string,
    locationId: string,
    aisle: { number?: string; description?: string; side?: string } | null,
  ): void {
    h.raw
      .prepare(
        "INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used, aisle_number, aisle_description, aisle_side, aisle_captured_at) VALUES (?, ?, 'S1', 'B', NULL, '2026-07-01', ?, ?, ?, ?)",
      )
      .run(ingredient, locationId, aisle?.number ?? null, aisle?.description ?? null, aisle?.side ?? null, aisle ? "2026-07-01" : null);
  }
  function seedDeptGraph(h: SqliteEnv): void {
    // flour --membership--> baking (concept): the department-shaped parent.
    h.raw.prepare("INSERT INTO ingredient_identity (id, base, concrete, source) VALUES ('flour', 'flour', 1, 'auto')").run();
    h.raw.prepare("INSERT INTO ingredient_identity (id, base, concrete, source) VALUES ('baking', 'baking', 0, 'auto')").run();
    h.raw.prepare("INSERT INTO ingredient_identity (id, base, concrete, source) VALUES ('powders', 'powders', 0, 'auto')").run();
    h.raw
      .prepare("INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES ('flour', 'baking', 'membership', 'auto', 1)")
      .run();
    // A general parent too — membership must win the precedence.
    h.raw
      .prepare("INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES ('flour', 'powders', 'general', 'auto', 1)")
      .run();
  }
  /** The production cabbage family (P4's spike fixture, reused): three general-kind
   *  specializations of "cabbage" — the same shape `substitutions.test.ts` seeds. */
  function seedSiblingGraph(h: SqliteEnv): void {
    for (const id of ["cabbage", "cabbage::type-napa", "cabbage::color-green", "cabbage::color-red"]) {
      h.raw
        .prepare("INSERT INTO ingredient_identity (id, base, detail, concrete, source) VALUES (?, ?, ?, 1, 'auto')")
        .run(
          id,
          id.includes("::") ? id.slice(0, id.indexOf("::")) : id,
          id.includes("::") ? id.slice(id.indexOf("::") + 2) : null,
        );
    }
    for (const from of ["cabbage::type-napa", "cabbage::color-green", "cabbage::color-red"]) {
      h.raw
        .prepare("INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES (?, 'cabbage', 'general', 'auto', 1)")
        .run(from);
    }
  }
  async function kvPutRollup(h: SqliteEnv, key: string, rollup: FlyerRollup): Promise<void> {
    await (h.env.KROGER_KV as unknown as { put(k: string, v: string): Promise<void> }).put(key, JSON.stringify(rollup));
  }

  it("the DEFAULT read carries concurrency/check state but no placement, location, or Kroger read", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    seedSkuAisle(h, "flour", "03500520", { number: "12", description: "Baking" });
    const view = await computeToBuyView(h.env, T);
    expect(view).toEqual(
      {
        to_buy: [
          {
            name: "flour",
            quantity: 1,
            assumed_quantity: true,
            for_recipes: [],
            origin: "list",
            key: "flour",
            kind: "grocery",
            domain: "grocery",
            checked_at: null,
            row_version: 1,
            updated_at: expect.any(String),
          },
        ],
        checked: [],
        pantry_covered: [],
        in_cart: [],
        underived: [],
        snapshot_version: expect.stringMatching(/^sha256:/),
      },
    );
  });

  it("a cached line carries its captured aisle; an uncaptured one falls back to the graph department", async () => {
    const h = sqliteEnv([T]);
    // A whitespace-free preferred_location is a pre-resolved locationId (the client
    // short-circuit) — the one Locations resolve costs zero network here.
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    seedDeptGraph(h);
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    await addGroceryRow(h.env, T, { name: "saffron" }, TODAY);
    seedSkuAisle(h, "flour", "03500520", { number: "12", description: "Baking", side: "L" });
    const view = await computeToBuyView(h.env, T, { enrich: true });
    expect(view.location).toEqual({ id: "03500520" });
    const byKey = new Map(view.to_buy.map((l) => [l.key, l]));
    // Captured aisle + the membership department (precedence over the general parent).
    expect(byKey.get("flour")!.placement).toEqual({
      aisle_number: "12",
      aisle_description: "Baking",
      aisle_side: "L",
      department: "baking",
      department_label: "baking",
    });
    // No sku row, no graph parent → an honest null placement (never a fake aisle).
    expect(byKey.get("saffron")!.placement).toBeNull();
  });

  it("checking a line changes only its partition, not enrichment or non-food display guards", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    seedDeptGraph(h);
    seedNode(h, "paper towels", "Graph-owned label");
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    await addGroceryRow(h.env, T, { name: "paper towels", kind: "household" }, TODAY);
    seedSkuAisle(h, "flour", "03500520", { number: "12", description: "Baking" });
    const unchecked = await computeToBuyView(h.env, T, { enrich: true });
    const before = new Map(unchecked.to_buy.map((line) => [line.key, line]));
    h.raw.prepare("UPDATE grocery_list SET checked_at='2026-07-12T12:00:00Z',row_version=row_version+1 WHERE tenant=?").run(T);
    const checked = await computeToBuyView(h.env, T, { enrich: true });
    const after = new Map(checked.checked.map((line) => [line.key, line]));
    expect(after.get("flour")?.placement).toEqual(before.get("flour")?.placement);
    expect(after.get("flour")?.display_name).toBe(before.get("flour")?.display_name);
    expect(after.get("flour")?.substitutes).toEqual(before.get("flour")?.substitutes);
    expect(after.get("paper towels")?.display_name).toBe("paper towels");
  });

  it("the legacy untagged '' row is the fallback when no location-tagged row exists", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    seedSkuAisle(h, "flour", "", { number: "9", description: "Legacy" });
    // A row tagged with ANOTHER location never contributes a placement.
    seedSkuAisle(h, "flour", "99999999", { number: "1", description: "Elsewhere" });
    const view = await computeToBuyView(h.env, T, { enrich: true });
    expect(view.to_buy[0].placement).toMatchObject({ aisle_number: "9", aisle_description: "Legacy" });
  });

  it("no resolvable Kroger location: location null, placements carry department only", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "aldi", preferred_location: "aldi east" });
    seedDeptGraph(h);
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    seedSkuAisle(h, "flour", "03500520", { number: "12", description: "Baking" });
    const view = await computeToBuyView(h.env, T, { enrich: true });
    expect(view.location).toBeNull();
    expect(view.to_buy[0].placement).toEqual({ department: "baking", department_label: "baking" });
  });

  it("carries substitutes[] (siblings + in_pantry + on_sale_hint) and flyer_as_of alongside placement (inline-substitution-hints D1-D3/D8)", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    seedSiblingGraph(h);
    await addGroceryRow(h.env, T, { name: "cabbage::type-napa" }, TODAY);
    seedPantry(h, "Red cabbage", "cabbage::color-red");
    await kvPutRollup(h, "flyer:kroger:03500520", {
      sweep_id: "1",
      as_of: Date.now() - 60_000,
      items: [
        { sku: "K1", brand: "Kroger", description: "Green Cabbage", size: "10 oz", price: { regular: 2.5, promo: 2 }, savings: 0.5, categories: [], matched_terms: ["cabbage"] },
      ],
    });

    const view = await computeToBuyView(h.env, T, { enrich: true });
    const line = view.to_buy.find((l) => l.key === "cabbage::type-napa")!;
    expect(line.substitutes?.map((s) => s.id)).toEqual(["cabbage", "cabbage::color-green", "cabbage::color-red"]);
    expect(line.substitutes?.find((s) => s.id === "cabbage::color-red")!.in_pantry).toBe(true);
    expect(line.substitutes?.find((s) => s.id === "cabbage::color-green")!.on_sale_hint).toMatchObject({ sku: "K1" });
    expect(line.substitutes?.find((s) => s.id === "cabbage")!.in_pantry).toBe(false);
    expect(view.flyer_as_of).not.toBeNull();
  });

  it("a line with no graph neighbors gets an empty substitutes[], never omitted", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    await addGroceryRow(h.env, T, { name: "saffron" }, TODAY);
    const view = await computeToBuyView(h.env, T, { enrich: true });
    expect(view.to_buy[0].substitutes).toEqual([]);
    expect(view.flyer_as_of).toBeNull();
  });

  it("a walk/satellite primary still gets in_pantry + a label-keyed on_sale_hint with zero Kroger calls", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "aldi", preferred_location: "aldi east" });
    seedSiblingGraph(h);
    await addGroceryRow(h.env, T, { name: "cabbage::type-napa" }, TODAY);
    seedPantry(h, "Red cabbage", "cabbage::color-red");
    await kvPutRollup(h, "flyer:aldi:aldi east", {
      sweep_id: "scan-1",
      as_of: Date.now() - 60_000,
      store: "aldi",
      location_id: "aldi east",
      items: [
        { sku: "F1", brand: "", description: "Green Cabbage", size: null, price: { regular: 2, promo: 1.5 }, savings: 0.5, categories: [], matched_terms: [] },
      ],
    });

    const view = await computeToBuyView(h.env, T, { enrich: true });
    expect(view.location).toBeNull(); // no Kroger placement source
    const line = view.to_buy.find((l) => l.key === "cabbage::type-napa")!;
    expect(line.substitutes?.find((s) => s.id === "cabbage::color-red")!.in_pantry).toBe(true);
    expect(line.substitutes?.find((s) => s.id === "cabbage::color-green")!.on_sale_hint).toMatchObject({ sku: "F1" });
    expect(view.flyer_as_of).not.toBeNull();
  });

  it("two interchangeable active-list lines surface each other as on_list consolidation nudges (scope-substitution-suggestions)", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    seedSiblingGraph(h);
    // Both siblings are ACTIVE grocery-list lines; no pantry, no flyer.
    await addGroceryRow(h.env, T, { name: "cabbage::type-napa" }, TODAY);
    await addGroceryRow(h.env, T, { name: "cabbage::color-green" }, TODAY);
    const view = await computeToBuyView(h.env, T, { enrich: true });
    const napa = view.to_buy.find((l) => l.key === "cabbage::type-napa")!;
    const green = view.to_buy.find((l) => l.key === "cabbage::color-green")!;
    // Each surfaces ONLY the other (both on the list); red + the generalization are non-actionable.
    expect(napa.substitutes?.map((s) => s.id)).toEqual(["cabbage::color-green"]);
    expect(napa.substitutes?.[0].on_list).toBe(true);
    expect(green.substitutes?.map((s) => s.id)).toEqual(["cabbage::type-napa"]);
    expect(green.substitutes?.[0].on_list).toBe(true);
  });

  it("a plan-derived (virtual) sibling stays filtered out — being a to-buy need is not, on its own, actionable", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    seedSiblingGraph(h);
    await addGroceryRow(h.env, T, { name: "cabbage::type-napa" }, TODAY);
    // color-red is only a PLAN need (virtual line), never on the list, in the cart, the pantry, or on sale.
    seedRecipe(h, "slaw", ["cabbage::color-red"]);
    seedPlan(h, "slaw");
    const view = await computeToBuyView(h.env, T, { enrich: true });
    const napa = view.to_buy.find((l) => l.key === "cabbage::type-napa")!;
    // red is a to-buy line but ONLY a plan need — not on the list/cart/pantry/sale — so it never
    // surfaces as napa's substitute (the old to-buy-set exclusion is gone; the filter does this now).
    expect(napa.substitutes).toEqual([]);
    // The asymmetry that proves the point: red's OWN virtual line DOES surface napa, because napa
    // genuinely is an active list line (an on_list consolidation nudge). Possession/acquisition —
    // not mere to-buy membership — is the gate, so the virtual side stays empty while the real one nudges.
    const red = view.to_buy.find((l) => l.key === "cabbage::color-red")!;
    expect(red.substitutes?.map((s) => s.id)).toEqual(["cabbage::type-napa"]);
    expect(red.substitutes?.[0].on_list).toBe(true);
  });

  it("display fields ride only on the enriched read — the default omits display_name/via_label/department_label on every line type (reify-ingredient-display-names)", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    seedDeptGraph(h); // flour → baking (membership): a department_label source
    seedSiblingGraph(h); // cabbage family: substitutes carrying a via/via_label
    seedAlias(h); // green-onion + the scallions alias: for pantry coverage
    // A pantry sibling makes the napa line's `cabbage::color-red` co-child actionable, so a
    // via-bearing suggestion survives the actionability filter (scope-substitution-suggestions).
    seedPantry(h, "Red cabbage", "cabbage::color-red");

    // to_buy lines
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    await addGroceryRow(h.env, T, { name: "cabbage::type-napa" }, TODAY);
    // an in_cart line
    await addGroceryRow(h.env, T, { name: "olive oil" }, TODAY);
    await updateGroceryRow(h.env, T, "olive oil", { status: "in_cart" }, TODAY);
    // a pantry_covered line: a planned need the pantry covers
    seedRecipe(h, "soup", ["green-onion"]);
    seedPlan(h, "soup");
    seedPantry(h, "Green onion", "green-onion", { quantity: "1 bunch" });

    // DEFAULT read: no display fields anywhere.
    const def = await computeToBuyView(h.env, T);
    expect(def.to_buy.length).toBeGreaterThan(0);
    for (const l of def.to_buy) {
      expect("display_name" in l).toBe(false);
      expect("placement" in l).toBe(false); // department_label lives inside placement
      expect("substitutes" in l).toBe(false); // via_label lives inside substitutes
    }
    expect(def.pantry_covered.length).toBeGreaterThan(0);
    for (const l of def.pantry_covered) expect("display_name" in l).toBe(false);
    expect(def.in_cart.length).toBeGreaterThan(0);
    for (const l of def.in_cart) expect("display_name" in l).toBe(false);

    // ENRICHED read: display fields present on every line type, and NEVER a raw `::` id (an
    // id-named line resolves through `idLabel`, so a leak of the bare canonical id fails here).
    const rich = await computeToBuyView(h.env, T, { enrich: true });
    for (const l of rich.to_buy) {
      expect(typeof l.display_name).toBe("string");
      expect(l.display_name).not.toContain("::");
    }
    for (const l of rich.pantry_covered) {
      expect(typeof l.display_name).toBe("string");
      expect(l.display_name).not.toContain("::");
    }
    for (const l of rich.in_cart) {
      expect(typeof l.display_name).toBe("string");
      expect(l.display_name).not.toContain("::");
    }
    // department_label rides on the flour line's placement (membership department "baking").
    expect(rich.to_buy.find((l) => l.key === "flour")!.placement?.department_label).toBe("baking");
    // via_label rides on a cabbage sibling suggestion (co-child via the "cabbage" parent).
    const napa = rich.to_buy.find((l) => l.key === "cabbage::type-napa")!;
    const withVia = napa.substitutes?.find((s) => s.relation.via !== undefined);
    expect(withVia?.relation.via_label).toBeDefined();
  });

  it("reifies an id-named row's label from the node's curated display (never a raw id) across to_buy / pantry_covered / in_cart", async () => {
    const h = sqliteEnv([T]);
    seedProfile(h, { primary: "kroger", preferred_location: "03500520" });
    // Curated nodes whose display_name differs from the id — so a raw-id leak is observable.
    seedNode(h, "cabbage::color-red", "Red cabbage");
    seedNode(h, "cabbage::color-green", "Green cabbage");
    seedNode(h, "onion::color-yellow", "Yellow onion");

    // to_buy: a PLAN-derived virtual line — its `name` IS the canonical id (name === key), so the
    // enriched read reifies it via idLabel to the node's curated label (never the raw id).
    seedRecipe(h, "slaw", ["cabbage::color-red"]);
    seedPlan(h, "slaw");
    // in_cart: a LEGACY id-named row (name === normalized_name === the id, display_name null) advanced
    // in flight — the enriched read reifies its label from the node, converging without a row edit.
    h.raw
      .prepare(
        "INSERT INTO grocery_list (tenant, name, normalized_name, display_name, quantity, kind, domain, status, source, for_recipes, note, added_at, ordered_at) " +
          "VALUES (?, 'cabbage::color-green', 'cabbage::color-green', NULL, '1', 'grocery', 'grocery', 'in_cart', 'menu', '[]', NULL, ?, NULL)",
      )
      .run(T, TODAY);
    // pantry_covered: a plan need on a curated id the pantry covers (also name === key).
    seedRecipe(h, "soup", ["onion::color-yellow"]);
    seedPlan(h, "soup");
    seedPantry(h, "onion::color-yellow", "onion::color-yellow");

    const rich = await computeToBuyView(h.env, T, { enrich: true });

    const toBuy = rich.to_buy.find((l) => l.key === "cabbage::color-red")!;
    expect(toBuy.display_name).toBe("Red cabbage"); // the curated node label, not the raw id
    expect(toBuy.display_name).not.toContain("::");

    const inCart = rich.in_cart.find((l) => l.name === "cabbage::color-green")!;
    expect(inCart.display_name).toBe("Green cabbage");
    expect(inCart.display_name).not.toContain("::");

    const covered = rich.pantry_covered.find((l) => l.name === "onion::color-yellow")!;
    expect(covered.display_name).toBe("Yellow onion");
    expect(covered.display_name).not.toContain("::");
  });
});
