import { describe, expect, it } from "vitest";
import { emptyOrderReviewStage } from "@yamp/contract";
import type { KrogerCandidate } from "../src/kroger.js";
import { readOrderReview, saveOrderBrandPreference, searchOrderCatalog, sendOrderReview } from "../src/order-review.js";
import type { OrderWiring } from "../src/order-tools.js";
import { addGroceryRow } from "../src/session-db.js";
import { sqliteEnv } from "./sqlite-d1.js";

const T = "casey";
function candidate(productId: string, brand = "Kroger", price = 2): KrogerCandidate {
  return { productId, brand, description: "Whole Milk", categories: ["Dairy"], size: "1 gal", price: { regular: price, promo: 0 }, fulfillment: { curbside: true, delivery: true, inStore: true }, aisleLocation: { number: "4", description: "Dairy" } };
}
function wiring(overrides: Partial<OrderWiring> = {}): OrderWiring {
  return {
    resolve: async () => ({ resolved: true, sku: "MILK-1", brand: "Kroger", description: "Whole Milk", size: "1 gal", price: { regular: 2, promo: 0 }, on_sale: false, fulfillment: { curbside: true, delivery: true }, reason: "test", aisleLocation: { number: "4", description: "Dairy" } }),
    revalidateSku: async (sku) => sku === "MILK-1" ? { brand: "Kroger", description: "Whole Milk", size: "1 gal", price: { regular: 2, promo: 0 }, on_sale: false, fulfillment: { curbside: true, delivery: true }, aisleLocation: { number: "4", description: "Dairy" } } : null,
    getLocationId: async () => "L1", search: async () => [candidate("MILK-1"), candidate("MILK-2", "Organic", 4)],
    productById: async (sku) => sku === "MILK-1" ? candidate(sku) : null, cartAdd: async () => {}, ...overrides,
  };
}

describe("Order Review shared operations", () => {
  it("preview is write-free and final send persists impulse/list truth only after matching fingerprint", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    const deps = { wiring: wiring() };
    const preview = await readOrderReview(h.env, T, emptyOrderReviewStage(), deps);
    expect(preview.matched).toHaveLength(1);
    expect(h.rows("order_sends")).toHaveLength(0);
    const sent = await sendOrderReview(h.env, T, { stage: { ...emptyOrderReviewStage(), quantities: { milk: 2 } }, preview_fingerprint: preview.preview_fingerprint, cleared_cart_ack: true, rendered_preview: preview }, deps);
    expect(sent.status).toBe("sent");
    expect(h.rows("order_sends")).toHaveLength(1);
    expect(h.rows("sku_cache")).toHaveLength(1);
  });

  it("narrow brand save preserves peers/lower tiers and is stale-safe/idempotent", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO brand_prefs (tenant, term, tiers, any_brand) VALUES (?, 'milk', ?, 1)").run(T, '[["A"],["B","C"]]');
    const first = await saveOrderBrandPreference(h.env, T, { family_key: "milk", brand: "C", expected_family_fingerprint: await (await import("@yamp/contract")).orderReviewFingerprint({ tiers: [["A"], ["B", "C"]], any_brand: true }) });
    expect(first).toMatchObject({ status: "saved", changed: true, family: { tiers: [["A", "C"], ["B"]], any_brand: false } });
    if (first.status !== "saved") throw new Error("expected save");
    const repeat = await saveOrderBrandPreference(h.env, T, { family_key: "milk", brand: "C", expected_family_fingerprint: first.family_fingerprint });
    expect(repeat).toMatchObject({ status: "saved", changed: false });
  });

  it("keeps an impulse client key through preview and materializes only on successful send", async () => {
    const h = sqliteEnv([T]);
    const deps = { wiring: wiring() };
    const stage = { ...emptyOrderReviewStage(), impulses: [{ key: "client-extra-1", label: "milk" }] };
    const preview = await readOrderReview(h.env, T, stage, deps);
    expect(preview.matched[0]).toMatchObject({ line_key: "client-extra-1", provenance: "impulse" });
    expect(h.rows("grocery_list")).toHaveLength(0);
    const result = await sendOrderReview(h.env, T, { stage, preview_fingerprint: preview.preview_fingerprint, cleared_cart_ack: true }, deps);
    expect(result.status).toBe("sent");
    expect(h.rows<{ status: string }>("grocery_list")[0].status).toBe("in_cart");
    expect(h.rows<{ provenance: string }>("order_send_lines")[0].provenance).toBe("impulse");
  });

  it("manual search is bounded, fulfillable, and writes nothing", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    const deps = { wiring: wiring() };
    const preview = await readOrderReview(h.env, T, emptyOrderReviewStage(), deps);
    const result = await searchOrderCatalog(h.env, T, "milk", preview.preview_fingerprint, emptyOrderReviewStage(), "whole milk", deps);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((item) => item.fulfillment.curbside || item.fulfillment.delivery)).toBe(true);
    expect(h.rows("sku_cache")).toHaveLength(0);
    await expect(searchOrderCatalog(h.env, T, "milk", "x", emptyOrderReviewStage(), "x", deps)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects unknown lines and SKUs not issued by the server", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    const deps = { wiring: wiring() };
    const preview = await readOrderReview(h.env, T, emptyOrderReviewStage(), deps);
    await expect(readOrderReview(h.env, T, {
      ...emptyOrderReviewStage(),
      selections: [{ line_key: "unknown", sku: "EVIL", source: "manual", divergence: { rung: "manual", requested_label: "unknown", searched_label: "milk", missing_constraints: [], candidate_terms: [] } }],
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(readOrderReview(h.env, T, {
      ...emptyOrderReviewStage(),
      selections: [{ line_key: "milk", sku: "EVIL", source: "manual", divergence: { rung: "manual", requested_label: "milk", searched_label: "milk", missing_constraints: [], candidate_terms: [] } }],
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });
    expect((await readOrderReview(h.env, T, emptyOrderReviewStage(), deps)).preview_fingerprint).toBe(preview.preview_fingerprint);
  });

  it("atomically claims rows so concurrent confirms call the additive cart once", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    let release!: () => void;
    let entered!: () => void;
    const enteredP = new Promise<void>((resolve) => { entered = resolve; });
    const releaseP = new Promise<void>((resolve) => { release = resolve; });
    let carts = 0;
    const deps = { wiring: wiring({ cartAdd: async () => { carts += 1; entered(); await releaseP; } }) };
    const preview = await readOrderReview(h.env, T, emptyOrderReviewStage(), deps);
    const firstP = sendOrderReview(h.env, T, { stage: emptyOrderReviewStage(), preview_fingerprint: preview.preview_fingerprint, cleared_cart_ack: true }, deps);
    await enteredP;
    const second = await sendOrderReview(h.env, T, { stage: emptyOrderReviewStage(), preview_fingerprint: preview.preview_fingerprint, cleared_cart_ack: true }, deps);
    release();
    const first = await firstP;
    expect(first.status).toBe("sent");
    expect(second.status).toBe("review_changed");
    expect(carts).toBe(1);
    expect(h.rows("order_sends")).toHaveLength(1);
  });

  it("gates review operations when the primary store is not Kroger", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO profile (tenant, stores) VALUES (?, ?)").run(T, JSON.stringify({ primary: "target", fulfillment: "walk" }));
    await expect(readOrderReview(h.env, T, emptyOrderReviewStage(), { wiring: wiring() })).rejects.toMatchObject({ code: "unsupported" });
  });
});
