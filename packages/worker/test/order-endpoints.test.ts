import { describe, it, expect } from "vitest";
import { handleOrderList, handleOrderReceipt, handleSatelliteResults } from "../src/satellite.js";
import { mintIngestKey } from "../src/ingest-db.js";
import { enqueueTask, claimTasks } from "../src/satellite-tasks-db.js";
import { insertOrderList, getOrderList, markOrderListReceived, pruneStaleOrderLists } from "../src/order-lists-db.js";
import { readSourceStats } from "../src/satellite-audit-db.js";
import { setProfileFields } from "../src/profile-db.js";
import { addGroceryRow, readGroceryList, removeGroceryRow } from "../src/session-db.js";
import { normalizeName } from "../src/grocery.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";
import type { OrderListResponse, OrderReceiptResponse } from "@yamp/contract";

// The order-fill ENDPOINTS (satellite-order-cart-fill) end-to-end over the real-SQLite env: the
// tenant-bound ingest-key auth, the fulfillment-mode gate, the issued-set-authoritative receipt
// intake, and the grocery_list reconciliation (carted → in_cart; unavailable stays active;
// mark_placed → ordered). `/satellite/order/*` is outside `/admin*`, so no Access gate applies.

const NOW = 1_800_000_000_000;
const TODAY = new Date(NOW).toISOString().slice(0, 10);
const DAY = 24 * 60 * 60 * 1000;

const listReq = (secret: string | null): Request => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new Request("https://host/satellite/order/list", { method: "POST", headers, body: "{}" });
};
const receiptReq = (secret: string | null, body: unknown): Request => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new Request("https://host/satellite/order/receipt", { method: "POST", headers, body: JSON.stringify(body) });
};

/** Seed a tenant's primary store + fulfillment marker (the flat `stores` map). */
async function setStores(env: Env, tenant: string, stores: Record<string, unknown>): Promise<void> {
  await setProfileFields(env, tenant, { stores: JSON.stringify(stores) });
}

/** Fetch a pull-list for a satellite-fulfilled tenant and assert 200. */
async function pullList(env: Env, secret: string, now = NOW): Promise<OrderListResponse> {
  const res = await handleOrderList(listReq(secret), env, now);
  expect(res.status).toBe(200);
  return (await res.json()) as OrderListResponse;
}

/** A grocery row's current status (or undefined when absent). */
function statusOf(env: Env, tenant: string, name: string): Promise<string | undefined> {
  return readGroceryList(env, tenant).then((rows) => rows.find((r) => r.name.toLowerCase() === name.toLowerCase())?.status);
}

describe("/satellite/order/* auth + fulfillment gate", () => {
  it("rejects an operator-global (unbound) key on both endpoints (order-fill is tenant-scope only)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret: opSecret } = await mintIngestKey(env, "op-box", NOW, null);
    expect((await handleOrderList(listReq(opSecret), env, NOW)).status).toBe(403);
    expect((await handleOrderReceipt(receiptReq(opSecret, { order_list_id: "ol_x" }), env, NOW)).status).toBe(403);
  });

  it("refuses the pull-list for a Kroger primary and mints NO order-list", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "kroger" });
    const res = await handleOrderList(listReq(secret), env, NOW);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("wrong_fulfillment_mode");
    expect(rows("order_lists")).toHaveLength(0);
  });

  it("refuses the pull-list for a walk store (a store-slug primary with no satellite marker)", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target" }); // no fulfillment: "satellite"
    const res = await handleOrderList(listReq(secret), env, NOW);
    expect(res.status).toBe(409);
    expect(rows("order_lists")).toHaveLength(0);
  });

  it("maps a D1 blip to a structured 503 on both handlers (auth is inside the try)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const brokenEnv = { ...env, DB: { prepare() { throw new Error("D1_ERROR: connection reset"); } } } as unknown as Env;
    const list = await handleOrderList(listReq("ing_live_whatever"), brokenEnv, NOW);
    expect(list.status).toBe(503);
    expect(((await list.json()) as { error: string }).error).toBe("storage_error");
    const receipt = await handleOrderReceipt(receiptReq("ing_live_whatever", { order_list_id: "ol_x" }), brokenEnv, NOW);
    expect(receipt.status).toBe(503);
    expect(((await receipt.json()) as { error: string }).error).toBe("storage_error");
  });
});

describe("/satellite/order/list (pull-list)", () => {
  it("serves the to-buy set keyed by canonical id + the primary store, and mints the issued order-list", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite", preferred_location: "Target West 7th" });
    await addGroceryRow(env, "casey", { name: "Olive Oil", for_recipes: ["pasta"] }, TODAY);
    await addGroceryRow(env, "casey", { name: "Scallions" }, TODAY);

    const body = await pullList(env, secret);
    expect(body.store).toBe("target");
    expect(body.location_id).toBe("Target West 7th");
    expect(body.items.map((i) => i.item_id).sort()).toEqual(["olive oil", "scallions"]);
    expect(body.items.every((i) => i.assumed_quantity === true)).toBe(true);
    // Exactly one issued order-list row, recording the issued id set.
    const ol = rows<{ id: string; tenant: string; status: string; item_ids: string }>("order_lists");
    expect(ol).toHaveLength(1);
    expect(ol[0].tenant).toBe("casey");
    expect(ol[0].status).toBe("issued");
    expect(JSON.parse(ol[0].item_ids).sort()).toEqual(["olive oil", "scallions"]);
    expect(body.order_list_id).toBe(ol[0].id);
  });

  it("keys a NON-FOOD line's item_id to its stored normalized_name (not a divergent resolve), and a receipt advances it", async () => {
    // A general-store (Target) tenant can have non-food items. computeToBuy stores a non-food row's
    // key as `normalizeName(name)` (the food guard), NOT `normalizeIngredient`; the pull-list must use
    // that SAME key so the issued item_id round-trips to the stored row at receipt time (no silent miss),
    // and the capture-resolver is NOT run on the non-food term (the invariant the guard exists to hold).
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY); // food
    await addGroceryRow(env, "casey", { name: "AA Batteries", kind: "household" }, TODAY); // non-food

    const list = await pullList(env, secret);
    const batteries = list.items.find((i) => i.name === "AA Batteries")!;
    const nonFoodKey = normalizeName("AA Batteries"); // "aa batteries"
    // item_id == the stored normalized_name (the household row's PK), not a resolve()-diverged id.
    expect(batteries.item_id).toBe(nonFoodKey);
    const stored = rows<{ name: string; normalized_name: string }>("grocery_list").find((r) => r.name === "AA Batteries")!;
    expect(stored.normalized_name).toBe(nonFoodKey);
    expect(batteries.item_id).toBe(stored.normalized_name);
    // The non-food term was never funneled through the capture-resolver (no ingredient-graph leak).
    expect(rows<{ term: string }>("novel_ingredient_terms").some((t) => t.term === nonFoodKey)).toBe(false);

    // End-to-end: carting the non-food line advances it to in_cart (would silently miss under the bug).
    const obs = [{ kind: "order", item_id: batteries.item_id, disposition: "carted", product: { productId: "T-9", description: "AA 8-pack" } }];
    const res = await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(res.status).toBe(200);
    expect(((await res.json()) as OrderReceiptResponse).results[0].disposition).toBe("accepted");
    expect(await statusOf(env, "casey", "AA Batteries")).toBe("in_cart");
  });

  it("reifies a FOOD id-named line's display via idLabel while keeping the canonical item_id; a non-food id-named line keeps its raw name", async () => {
    // A plan-derived FOOD line (`name === key`, virtual — no stored row) renders the curated node
    // label, never a raw `::` id; a non-food id-named row (kind:other, whose name collides with a food
    // id) must NOT route through the identity graph. `item_id` stays the canonical id in both cases.
    const h = sqliteEnv(["casey"]);
    const { env } = h;
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    // A curated node for the plan-derived id, and a FOOD "sage" node whose label must NOT leak onto
    // the non-food row below.
    h.raw
      .prepare("INSERT INTO ingredient_identity (id, base, detail, representative, display_name, source) VALUES (?, ?, ?, NULL, ?, 'auto')")
      .run("cabbage::color-red", "cabbage", "color-red", "Red cabbage");
    h.raw
      .prepare("INSERT INTO ingredient_identity (id, base, detail, representative, display_name, source) VALUES (?, ?, NULL, NULL, ?, 'auto')")
      .run("sage", "sage", "Fresh sage");
    h.raw.prepare("INSERT INTO recipes (slug, title, ingredients_full) VALUES (?, ?, ?)").run("slaw", "slaw", JSON.stringify(["cabbage::color-red"]));
    h.raw.prepare("INSERT INTO meal_plan (tenant, id, recipe, planned_for) VALUES ('casey', lower(hex(randomblob(16))), ?, NULL)").run("slaw");
    await addGroceryRow(env, "casey", { name: "sage", kind: "other" }, TODAY); // non-food, name === normalizeName === "sage"

    const body = await pullList(env, secret);
    // Plan-derived FOOD id-named line: display reified to the curated label, item_id stays the id.
    const cabbage = body.items.find((i) => i.item_id === "cabbage::color-red")!;
    expect(cabbage.name).toBe("Red cabbage");
    expect(cabbage.name).not.toContain("::");
    expect(cabbage.item_id).toBe("cabbage::color-red"); // keying unchanged
    // Non-food id-named line: raw name preserved (never routed through idLabel to the food label).
    const sage = body.items.find((i) => i.item_id === "sage")!;
    expect(sage.name).toBe("sage");
    // The issued order-list still records the canonical ids (the receipt correlation key).
    const ol = h.rows<{ item_ids: string }>("order_lists")[0];
    expect(JSON.parse(ol.item_ids).sort()).toEqual(["cabbage::color-red", "sage"]);
  });
});

describe("/satellite/order/list (plan-derived needs, member-app-grocery D4)", () => {
  function seedPlanned(env: Env, raw: SqliteEnv["raw"], recipe: string, full: string[] | null): void {
    void env;
    raw.prepare("INSERT INTO recipes (slug, title, ingredients_full) VALUES (?, ?, ?)").run(recipe, recipe, full ? JSON.stringify(full) : null);
    raw.prepare("INSERT INTO meal_plan (tenant, id, recipe, planned_for) VALUES ('casey', lower(hex(randomblob(16))), ?, NULL)").run(recipe);
  }

  it("unions the plan's derived needs into the pull-list with canonical item_ids + for_recipes, and reports underived", async () => {
    const h = sqliteEnv(["casey"]);
    const { env } = h;
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    seedPlanned(env, h.raw, "honey-mustard-salmon", ["salmon", "mustard", "honey"]);
    seedPlanned(env, h.raw, "not-derived-yet", null);
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY); // an explicit row rides along

    const body = await pullList(env, secret);
    expect(body.items.map((i) => i.item_id).sort()).toEqual(["honey", "mustard", "olive oil", "salmon"]);
    const salmon = body.items.find((i) => i.item_id === "salmon")!;
    expect(salmon.for_recipes).toEqual(["honey-mustard-salmon"]);
    expect(salmon.assumed_quantity).toBe(true); // derivation is presence-only
    expect(body.underived).toEqual(["not-derived-yet"]); // honesty: the list may be incomplete
    // The issued set records the derived ids too — they are receipt-advanceable.
    const ol = h.rows<{ item_ids: string }>("order_lists")[0];
    expect(JSON.parse(ol.item_ids).sort()).toEqual(["honey", "mustard", "olive oil", "salmon"]);
  });

  it("a carted DERIVED line (no stored row) advances via the existing insert-on-missing keying", async () => {
    const h = sqliteEnv(["casey"]);
    const { env } = h;
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    seedPlanned(env, h.raw, "honey-mustard-salmon", ["salmon"]);
    const list = await pullList(env, secret);
    expect(await statusOf(env, "casey", "salmon")).toBeUndefined(); // truly virtual — no row minted

    const obs = [{ kind: "order", item_id: "salmon", disposition: "carted", product: { productId: "T-7", description: "Atlantic salmon" } }];
    const res = await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(res.status).toBe(200);
    expect(((await res.json()) as OrderReceiptResponse).results[0].disposition).toBe("accepted");
    // Insert-on-missing: the derived line now exists as an in_cart row keyed by its canonical id.
    expect(await statusOf(env, "casey", "salmon")).toBe("in_cart");
  });

  it("pantry coverage diverts a derived need to partials, not items", async () => {
    const h = sqliteEnv(["casey"]);
    const { env } = h;
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    seedPlanned(env, h.raw, "honey-mustard-salmon", ["salmon", "mayonnaise"]);
    h.raw.prepare("INSERT INTO pantry (tenant, name, normalized_name, added_at) VALUES ('casey', 'Mayonnaise', 'mayonnaise', ?)").run(TODAY);

    const body = await pullList(env, secret);
    expect(body.items.map((i) => i.item_id)).toEqual(["salmon"]);
    expect(body.partials.map((p) => p.name)).toEqual(["mayonnaise"]);
  });
});

describe("/satellite/order/receipt (issued-set-authoritative reconciliation)", () => {
  it("advances carted/substituted to in_cart, leaves unavailable active, and marks the list received", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    await addGroceryRow(env, "casey", { name: "Scallions" }, TODAY);
    await addGroceryRow(env, "casey", { name: "Saffron" }, TODAY);
    const list = await pullList(env, secret);

    const obs = [
      { kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO" } },
      { kind: "order", item_id: "scallions", disposition: "substituted", product: { productId: "T-2", description: "Green onions" } },
      { kind: "order", item_id: "saffron", disposition: "unavailable" },
    ];
    const res = await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrderReceiptResponse;
    expect(body.order_list).toEqual({ id: list.order_list_id, status: "received" });
    expect(body.results.every((r) => r.disposition === "accepted")).toBe(true);

    expect(await statusOf(env, "casey", "Olive Oil")).toBe("in_cart");
    expect(await statusOf(env, "casey", "Scallions")).toBe("in_cart");
    expect(await statusOf(env, "casey", "Saffron")).toBe("active"); // unavailable stays active to retry
    expect((await getOrderList(env, list.order_list_id))?.status).toBe("received");
  });

  it("rejects an unissued item_id per-item and advances nothing for it", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, secret);

    const obs = [{ kind: "order", item_id: "caviar", disposition: "carted", product: { productId: "X", description: "Caviar" } }];
    const res = await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    const body = (await res.json()) as OrderReceiptResponse;
    expect(body.results[0].disposition).toBe("rejected");
    // No row was created/advanced for the unissued id; the real issued line stays active.
    expect(await statusOf(env, "casey", "caviar")).toBeUndefined();
    expect(await statusOf(env, "casey", "Olive Oil")).toBe("active");
  });

  it("does not resurrect an issued line removed from the list before the receipt (issued+active only)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    await addGroceryRow(env, "casey", { name: "Scallions" }, TODAY);
    const list = await pullList(env, secret);
    // The user removes scallions between Refresh and receipt.
    await removeGroceryRow(env, "casey", "Scallions");

    const obs = [
      { kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO" } },
      { kind: "order", item_id: "scallions", disposition: "carted", product: { productId: "T-2", description: "Scallions" } },
    ];
    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(await statusOf(env, "casey", "Olive Oil")).toBe("in_cart");
    expect(await statusOf(env, "casey", "Scallions")).toBeUndefined(); // stays gone — not resurrected
  });

  it("does not resurrect a plan-DERIVED line whose recipe was removed from the plan before the receipt", async () => {
    const h = sqliteEnv(["casey"]);
    const { env, raw } = h;
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    raw.prepare("INSERT INTO recipes (slug, title, ingredients_full) VALUES (?, ?, ?)").run("honey-mustard-salmon", "honey-mustard-salmon", JSON.stringify(["salmon"]));
    raw.prepare("INSERT INTO meal_plan (tenant, id, recipe, planned_for) VALUES ('casey', lower(hex(randomblob(16))), ?, NULL)").run("honey-mustard-salmon");
    const list = await pullList(env, secret);
    expect(list.items.map((i) => i.item_id)).toEqual(["salmon"]);
    expect(await statusOf(env, "casey", "salmon")).toBeUndefined(); // truly virtual — no row minted
    // The user drops the recipe from the plan between Refresh and receipt.
    raw.prepare("DELETE FROM meal_plan WHERE tenant = 'casey' AND recipe = ?").run("honey-mustard-salmon");

    const obs = [{ kind: "order", item_id: "salmon", disposition: "carted", product: { productId: "T-7", description: "Atlantic salmon" } }];
    const res = await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(res.status).toBe(200);
    // The re-derive at receipt time finds the id no longer needed, so the insert-on-missing
    // branch never fires — no row is minted or advanced (the same no-resurrection guard a
    // removed explicit row gets).
    expect(await statusOf(env, "casey", "salmon")).toBeUndefined();
  });

  it("converges on a re-posted receipt (no double-advance)", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, secret);
    const obs = [{ kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO" } }];
    const body = { order_list_id: list.order_list_id, observations: obs };
    await handleOrderReceipt(receiptReq(secret, body), env, NOW + 1);
    await handleOrderReceipt(receiptReq(secret, body), env, NOW + 2);
    // Still exactly one row, still in_cart (re-apply is idempotent — active-only filter skips it now).
    const groceryRows = rows<{ status: string }>("grocery_list");
    expect(groceryRows).toHaveLength(1);
    expect(groceryRows[0].status).toBe("in_cart");
  });

  it("a re-posted receipt does NOT double-bump the accept-tally (Fix 3 idempotency guard)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, secret);
    const obs = [{ kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO" } }];
    const body = { order_list_id: list.order_list_id, observations: obs };

    // First receipt lands the item + marks the list received → tally = 1 accept for {order, target}.
    await handleOrderReceipt(receiptReq(secret, body), env, NOW + 1);
    const afterFirst = (await readSourceStats(env)).reduce((n, s) => n + s.accepted, 0);
    expect(afterFirst).toBe(1);

    // A retry (the satellite missed the first response) re-sends the SAME receipt. The list is already
    // `received`, so the guard skips intake — the accept-tally must NOT climb to 2.
    const second = await handleOrderReceipt(receiptReq(secret, body), env, NOW + 2);
    expect(second.status).toBe(200);
    expect((await readSourceStats(env)).reduce((n, s) => n + s.accepted, 0)).toBe(1);
  });

  it("mark_placed advances the issued in_cart lines to ordered", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, secret);
    const obs = [{ kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO" } }];
    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(await statusOf(env, "casey", "Olive Oil")).toBe("in_cart");
    // The optional mark-placed re-post (no new observations) advances the issued in_cart line to ordered.
    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, mark_placed: true }), env, NOW + 2);
    expect(await statusOf(env, "casey", "Olive Oil")).toBe("ordered");
  });

  it("masks another tenant's order-list as 404 and advances nothing (tenant isolation)", async () => {
    const { env } = sqliteEnv(["casey", "sam"]);
    const { secret: caseySecret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    const { secret: samSecret } = await mintIngestKey(env, "sam-box", NOW, "sam");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, caseySecret);
    // Sam (a tenant-bound key) references casey's order-list id → masked as not_found.
    const res = await handleOrderReceipt(receiptReq(samSecret, { order_list_id: list.order_list_id, observations: [] }), env, NOW + 1);
    expect(res.status).toBe(404);
    expect((await getOrderList(env, list.order_list_id))?.status).toBe("issued"); // untouched
    expect(await statusOf(env, "casey", "Olive Oil")).toBe("active");
  });

  it("an unknown order_list_id is a structured 404", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    const res = await handleOrderReceipt(receiptReq(secret, { order_list_id: "ol_nope", observations: [] }), env, NOW);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_found");
  });
});

describe("/satellite/order/receipt — the send-record snapshot (spend-telemetry)", () => {
  it("the first landing persists the send record (id = the order-list id) from the observations and stamps sent_in", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    await addGroceryRow(env, "casey", { name: "Paper Towels", kind: "household" }, TODAY);
    await addGroceryRow(env, "casey", { name: "Saffron" }, TODAY);
    const list = await pullList(env, secret);

    const obs = [
      { kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO", size: "500 ml", price: 6.49 } },
      // No observed price → NULL-unknown, never fabricated.
      { kind: "order", item_id: "paper towels", disposition: "substituted", product: { productId: "T-2", description: "Paper towels 6pk" } },
      { kind: "order", item_id: "saffron", disposition: "unavailable" },
    ];
    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);

    expect(rows("order_sends")).toEqual([
      expect.objectContaining({
        id: list.order_list_id,
        tenant: "casey",
        store: "target",
        fulfillment: "satellite",
        order_list_id: list.order_list_id,
      }),
    ]);
    const lines = rows<Record<string, unknown>>("order_send_lines");
    expect(lines).toHaveLength(2); // the unavailable line gets NO snapshot line
    expect(lines.find((l) => l.line_key === "olive oil")).toMatchObject({
      sku: "T-1",
      size: "500 ml",
      unit_price: 6.49,
      price_regular: null, // a single observed price cannot fabricate the Kroger-shaped fields
      price_promo: null,
      on_sale: null,
      savings: null,
      estimated: 0,
      brand: null,
      quantity: 1,
      provenance: "planned",
      department: null, // cold food id — pending classification
    });
    expect(lines.find((l) => l.line_key === "paper towels")).toMatchObject({
      sku: "T-2",
      unit_price: null,
      department: "household", // kind override — immediate, never pending
    });
    const grocery = rows<{ normalized_name: string; sent_in: string | null }>("grocery_list");
    expect(grocery.find((r) => r.normalized_name === "olive oil")!.sent_in).toBe(list.order_list_id);
    expect(grocery.find((r) => r.normalized_name === "paper towels")!.sent_in).toBe(list.order_list_id);
    expect(grocery.find((r) => r.normalized_name === "saffron")!.sent_in).toBeNull();
  });

  it("a replayed receipt converges on the deterministic send id — no duplicate lines", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, secret);
    const body = {
      order_list_id: list.order_list_id,
      observations: [
        { kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO", price: 6.49 } },
      ],
    };
    await handleOrderReceipt(receiptReq(secret, body), env, NOW + 1);
    await handleOrderReceipt(receiptReq(secret, body), env, NOW + 2);
    expect(rows("order_sends")).toHaveLength(1);
    expect(rows("order_send_lines")).toHaveLength(1);
  });

  it("mark_placed materializes the snapshot as spend events VERBATIM, idempotently across a re-post", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, secret);
    const obs = [
      { kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO", price: 6.49 } },
    ];
    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(rows("spend_events")).toHaveLength(0); // in_cart alone is never auto-counted

    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, mark_placed: true }), env, NOW + 2);
    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, mark_placed: true }), env, NOW + 3);
    const events = rows<Record<string, unknown>>("spend_events");
    expect(events).toHaveLength(1); // the re-posted mark-placed converges
    expect(events[0]).toMatchObject({
      send_id: list.order_list_id,
      line_key: "olive oil",
      tenant: "casey",
      unit_price: 6.49,
      amount: 6.49,
      store: "target",
      fulfillment: "satellite",
      provenance: "planned",
      voided_at: null,
    });
  });

  it("a snapshot-build failure never rejects the receipt — lines advance bare, no send, no spend", async () => {
    const { env, raw, rows } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    await setStores(env, "casey", { primary: "target", fulfillment: "satellite" });
    await addGroceryRow(env, "casey", { name: "Olive Oil" }, TODAY);
    const list = await pullList(env, secret);
    // Force the snapshot build's memo read to throw (the advance's own resolver read
    // degrades independently) — the receipt must still land the advance.
    raw.exec("DROP TABLE ingredient_alias");

    const obs = [
      { kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO", price: 6.49 } },
    ];
    const res = await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, observations: obs }), env, NOW + 1);
    expect(res.status).toBe(200);
    expect(await statusOf(env, "casey", "Olive Oil")).toBe("in_cart");
    expect(rows("order_sends")).toHaveLength(0);
    expect(rows<{ sent_in: string | null }>("grocery_list")[0].sent_in).toBeNull();
    // Those lines simply never produce spend events.
    await handleOrderReceipt(receiptReq(secret, { order_list_id: list.order_list_id, mark_placed: true }), env, NOW + 2);
    expect(rows("spend_events")).toHaveLength(0);
  });
});

describe("order observations are order-receipt-only", () => {
  it("rejects an `order` observation arriving on /satellite/results (no order-list context)", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const { id } = await enqueueTask(env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "d", payload: {} }, NOW);
    await claimTasks(env, { keyId: "ik_x", tenant: null, capabilities: ["scan"], now: NOW });
    const obs = [{ kind: "order", item_id: "olive oil", disposition: "carted", product: { productId: "T-1", description: "EVOO" } }];
    const res = await handleSatelliteResults(
      new Request("https://host/satellite/results", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ task_id: id, status: "done", observations: obs }) }),
      env,
      NOW + 1,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results?: { disposition: string }[] };
    expect(body.results?.[0].disposition).toBe("rejected"); // order requires an issued order-list
  });
});

describe("pruneStaleOrderLists (cron reap)", () => {
  it("deletes an old issued row but spares a received (audit) row and a fresh issued row", async () => {
    const { env, rows } = sqliteEnv(["casey"]);
    const base = { tenant: "casey", store: "target", locationId: null, itemIds: ["olive oil"] };
    const oldIssued = await insertOrderList(env, base, NOW - 10 * DAY);
    const received = await insertOrderList(env, base, NOW - 10 * DAY);
    await markOrderListReceived(env, received, NOW - 9 * DAY);
    const fresh = await insertOrderList(env, base, NOW);

    const pruned = await pruneStaleOrderLists(env, NOW - 7 * DAY);
    expect(pruned).toBe(1);
    const remaining = rows<{ id: string }>("order_lists").map((r) => r.id).sort();
    expect(remaining).toEqual([received, fresh].sort());
    expect(await getOrderList(env, oldIssued)).toBeNull();
  });
});
