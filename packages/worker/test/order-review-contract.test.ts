import { describe, expect, it } from "vitest";
import {
  ORDER_REVIEW_CONTRACT_CEILING,
  ORDER_REVIEW_CONTRACT_FLOOR,
  OrderReviewDataSchema,
  canonicalOrderReviewValue,
  emptyOrderReviewStage,
  orderReviewContractSupport,
  orderReviewFingerprint,
} from "@yamp/contract";

describe("Order Review shared contract", () => {
  it("has independent floor/ceiling gates", () => {
    expect(orderReviewContractSupport(ORDER_REVIEW_CONTRACT_FLOOR)).toBe("supported");
    expect(orderReviewContractSupport(ORDER_REVIEW_CONTRACT_FLOOR - 1)).toBe("older");
    expect(orderReviewContractSupport(ORDER_REVIEW_CONTRACT_CEILING + 1)).toBe("newer");
  });

  it("canonicalizes object ordering and changes every staged commit fact", async () => {
    expect(canonicalOrderReviewValue({ b: 2, a: 1 })).toBe(canonicalOrderReviewValue({ a: 1, b: 2 }));
    const base = { snapshot: "s1", stage: emptyOrderReviewStage(), store: "L1", price: 2, promo: 0, available: true };
    const digest = await orderReviewFingerprint(base);
    for (const changed of [
      { ...base, snapshot: "s2" }, { ...base, store: "L2" }, { ...base, price: 3 },
      { ...base, promo: 1 }, { ...base, available: false },
      { ...base, stage: { ...base.stage, skipped: ["milk"] } },
    ]) expect(await orderReviewFingerprint(changed)).not.toBe(digest);
  });

  it("rejects trusted prices in stage", () => {
    const review = {
      contract_version: 1, preview_fingerprint: "sha256:x", grocery_snapshot_version: "sha256:g", as_of: "2026-07-12T00:00:00Z",
      store: { name: "Kroger", location_id: "L1" }, quote_disclaimer: "quote", stale_cart_count: 0, cleared_cart_ack_required: false,
      matched: [], decisions: [], left_off: [], underived: [], counts: { going_to_cart: 0, needs_decision: 0, left_off: 0 },
      estimated_total: null, flyer_savings: null,
      stage: { ...emptyOrderReviewStage(), selections: [{ line_key: "milk", sku: "1", source: "manual", divergence: { rung: "manual", requested_label: "milk", searched_label: "milk", missing_constraints: [], candidate_terms: [] }, price: 0.01 }] },
    };
    const parsed = OrderReviewDataSchema.parse(review);
    expect(parsed.stage.selections[0]).not.toHaveProperty("price");
  });
});
