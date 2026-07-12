import { describe, expect, it } from "vitest";
import { grocerySnapshotText, readGrocerySnapshot } from "../src/grocery-snapshot.js";
import { addGroceryRow, updateGroceryRow } from "../src/session-db.js";
import { sqliteEnv } from "./sqlite-d1.js";

const T = "casey";
const NOW = new Date("2026-07-12T12:00:00Z");

describe("readGrocerySnapshot", () => {
  it("groups current send membership while retaining the immutable sent quote", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-10");
    await updateGroceryRow(h.env, T, "milk", { status: "in_cart" });
    h.raw.prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at) VALUES ('s1',?,'kroger','kroger_online','2026-07-08T00:00:00Z')").run(T);
    h.raw.prepare("INSERT INTO order_send_lines (send_id,line_key,name,quantity,unit_price,savings,provenance) VALUES ('s1','milk','Milk',2,3.5,1,'planned')").run();
    h.raw.prepare("UPDATE grocery_list SET sent_in='s1' WHERE tenant=? AND normalized_name='milk'").run(T);
    const data = await readGrocerySnapshot(h.env, T, NOW);
    expect(data.counts).toMatchObject({ to_buy: 0, checked: 0, in_carts: 1 });
    expect(data.in_cart_groups[0]).toMatchObject({ send_id: "s1", estimated_total: 7, flyer_savings: 2, awaiting_confirmation: true, can_mark_placed: true });
  });

  it("changes the opaque digest for grocery, plan, pantry, decision, and send membership sources", async () => {
    const h = sqliteEnv([T]);
    const versions: string[] = [];
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    await addGroceryRow(h.env, T, { name: "salt" }, "2026-07-12");
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    h.raw.prepare("INSERT INTO recipes (slug,title,ingredients_full) VALUES ('soup','Soup','[\"onion\"]')").run();
    h.raw.prepare("INSERT INTO meal_plan (tenant,id,recipe,meal,planned_for) VALUES (?,'p1','soup','dinner','2026-07-13')").run(T);
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,added_at,last_verified_at,category) VALUES (?,'Onion','onion','2026-07-12','2026-07-12','produce')").run(T);
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    h.raw.prepare("INSERT INTO grocery_coverage_decisions (tenant,line_key,created_at,updated_at) VALUES (?,'onion','2026-07-12','2026-07-12')").run(T);
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    await updateGroceryRow(h.env, T, "salt", { status: "in_cart" });
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    for (let i = 1; i < versions.length; i++) expect(versions[i]).not.toBe(versions[i - 1]);
  });

  it("keeps pantry, decisions, underived recipes, and cart membership in the plain-text fallback", async () => {
    const h = sqliteEnv([T]);
    const base = await readGrocerySnapshot(h.env, T, NOW);
    const text = grocerySnapshotText({
      ...base,
      lines: [{ key: "beans", name: "Beans", quantity: "2 cans", kind: "grocery", domain: "grocery", origin: "both", checked_at: null, row_version: 1, updated_at: NOW.toISOString(), note: "low sodium", staple: true, for_recipes: ["chili"], recipe_attribution: [{ slug: "chili", planned_for: "2026-07-14", plan_id: "p1" }], placement: { section: "Canned goods", aisle_number: "5" }, substitutes: [{ id: "lentils", label: "Lentils", relation: { role: "sibling", via: "legumes", via_label: "Legumes & pulses" }, in_pantry: true, on_sale_hint: { price: { promo: 1.79 } } }] }],
      pantry_covered: [{ key: "onion", name: "Onion", for_recipes: ["soup"], freshness: "worth_a_look", on_hand: {}, buy_anyway: false }],
      substitution_decisions: [{ original_key: "milk", replacement_key: "oat milk", attribution_signature: "sig", created_replacement: true, replacement_version: 1, row_version: 1, created_at: NOW.toISOString(), updated_at: NOW.toISOString() }],
      coverage_decisions: [{ line_key: "onion", created_row: true, created_row_version: 1, row_version: 1, created_at: NOW.toISOString(), updated_at: NOW.toISOString() }],
      underived: ["stew"],
      in_cart_groups: [{ send_id: "s1", store: "Kroger", location_id: "1", fulfillment: "kroger_online", sent_at: "2026-07-08T09:30:00Z", placed_at: null, awaiting_confirmation: true, estimated_total: 12, flyer_savings: 2.5, can_mark_placed: true, lines: [{ key: "rice", name: "Rice", quantity: "3 bags", row_version: 2, unit_price: 4, savings: 2.5 }] }],
      counts: { ...base.counts, in_carts: 1 },
    });
    expect(text).toContain("Pantry covers: Onion (worth a look)");
    expect(text).toContain("○ Beans (2 cans) [Staple] — low sodium [for: chili] [Canned goods, aisle 5] [try: Lentils (same family · via Legumes & pulses) (pantry) ($1.79 promo)]");
    expect(text).toContain("Decision: use oat milk instead of milk");
    expect(text).toContain("Decision: buy onion despite pantry coverage");
    expect(text).toContain("Underived recipes: stew");
    expect(text).toContain("Kroger: 1 item, sent 2026-07-08T09:30:00Z, awaiting confirmation, sent estimate $12.00, flyer savings $2.50\n  - Rice (3 bags)");
  });

  it("marks shopping lines that belong to the household staples list", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "olive oil" }, "2026-07-12");
    await addGroceryRow(h.env, T, { name: "lemons" }, "2026-07-12");
    h.raw.prepare("INSERT INTO staples (tenant,name,normalized_name,perishable) VALUES (?,'Olive oil','olive oil',0)").run(T);
    const snapshot = await readGrocerySnapshot(h.env, T, NOW);
    expect(snapshot.lines.find((line) => line.key === "olive oil")?.staple).toBe(true);
    expect(snapshot.lines.find((line) => line.key === "lemons")?.staple).toBeUndefined();
  });
});
