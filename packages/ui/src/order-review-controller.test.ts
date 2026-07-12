import { describe, expect, it } from "vitest";
import type { OrderReviewData } from "@yamp/contract";
import { createOrderReviewController, orderReviewEstimatedTotal, stageOrderReview } from "./order-review-controller";

const preview: OrderReviewData = {
  contract_version: 1, preview_fingerprint: "sha256:p", grocery_snapshot_version: "sha256:g", as_of: "2026-07-12T00:00:00Z",
  store: { name: "Kroger", location_id: "L1" }, quote_disclaimer: "quote", stale_cart_count: 0, cleared_cart_ack_required: false,
  matched: [{ line_key: "milk", name: "milk", quantity: 1, assumed_quantity: true, for_recipes: [], provenance: "planned", selected: { sku: "1", brand: "A", description: "Milk", size: null, price: { regular: 3, promo: 2 }, on_sale: true, fulfillment: { curbside: true, delivery: true } }, selection_source: "matched", options: [], family_key: "milk", family_fingerprint: "f" }],
  decisions: [], left_off: [], underived: [], counts: { going_to_cart: 1, needs_decision: 0, left_off: 0 }, estimated_total: 2, flyer_savings: 1,
  stage: { skipped: [], quantities: {}, selections: [], impulses: [], saved_brands: [] },
};

describe("Order Review controller", () => {
  it("owns disposable skip/quantity/selection/impulse/undo stage and quote projection", () => {
    let state = createOrderReviewController(preview);
    state = stageOrderReview(state, { kind: "quantity", line_key: "milk", quantity: 3 });
    expect(orderReviewEstimatedTotal(state)).toBe(6);
    state = stageOrderReview(state, { kind: "select", line_key: "milk", sku: "2", source: "manual" });
    expect(state.stage.selections).toHaveLength(1);
    state = stageOrderReview(state, { kind: "undo_selection", line_key: "milk" });
    expect(state.stage.selections).toEqual([]);
    state = stageOrderReview(state, { kind: "impulse", key: "i1", label: "ice" });
    state = stageOrderReview(state, { kind: "skip", line_key: "milk" });
    expect(orderReviewEstimatedTotal(state)).toBeNull();
    expect(state.stage.impulses).toEqual([{ key: "i1", label: "ice" }]);
  });
});
