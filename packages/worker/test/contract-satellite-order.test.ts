import { describe, it, expect } from "vitest";
import {
  parseObservationItem,
  parseOrderObservation,
  parseOrderReceiptRequest,
  parseRecipeItem,
  parseSaleObservation,
  OrderLineSchema,
} from "@grocery-agent/contract";

// The order-fill WIRE contract (satellite-order-cart-fill). Mirrors contract-ingest.test.ts /
// contract-satellite-pull.test.ts: the `order` observation is a new member of the shared
// discriminated union (sensor-not-judge — raw disposition, no derived grocery-list state), and the
// receipt envelope keeps its observations RAW for per-item validation. Adding the kind must not
// break a consumer that handles only `recipe`/`sale`.

const cartedObs = {
  kind: "order" as const,
  item_id: "olive oil",
  disposition: "carted" as const,
  product: { productId: "T-987", description: "Good & Gather EVOO", size: "16.9 fl oz", price: 6.49, url: "https://www.target.com/p/evoo/-/A-1" },
};

describe("order observations (sensor-not-judge)", () => {
  it("round-trips a carted observation with a product", () => {
    const r = parseObservationItem(cartedObs);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "order") {
      expect(r.value.item_id).toBe("olive oil");
      expect(r.value.disposition).toBe("carted");
      expect(r.value.product?.productId).toBe("T-987");
    }
  });

  it("accepts a substituted observation and an unavailable observation with no product", () => {
    expect(parseOrderObservation({ kind: "order", item_id: "scallions", disposition: "substituted", product: { productId: "T-1", description: "Green onions" } }).ok).toBe(true);
    expect(parseOrderObservation({ kind: "order", item_id: "saffron", disposition: "unavailable" }).ok).toBe(true);
  });

  it("strips an unmodeled field (no derived grocery-list state can ride the wire)", () => {
    const r = parseOrderObservation({ ...cartedObs, status: "in_cart", advanced: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toHaveProperty("status");
      expect(r.value).not.toHaveProperty("advanced");
    }
  });

  it("rejects a missing item_id, an unknown disposition, a product missing its id, or a non-http product url", () => {
    expect(parseOrderObservation({ kind: "order", disposition: "carted" }).ok).toBe(false);
    expect(parseOrderObservation({ kind: "order", item_id: "milk", disposition: "returned" }).ok).toBe(false);
    expect(parseOrderObservation({ kind: "order", item_id: "milk", disposition: "carted", product: { description: "x" } }).ok).toBe(false);
    expect(parseOrderObservation({ kind: "order", item_id: "milk", disposition: "carted", product: { productId: "p", description: "x", url: "ftp://x/y" } }).ok).toBe(false);
  });

  it("leaves the recipe/sale arms unaffected — a recipe/sale observation still validates alongside order", () => {
    const recipe = { kind: "recipe" as const, title: "T", ingredients: ["x"], instructions: ["y"], source: "https://e.com/r" };
    const sale = { kind: "sale" as const, store: "target", locationId: "T-1", productId: "s", description: "d", regular: 4, promo: 3 };
    expect(parseObservationItem(recipe).ok).toBe(true);
    expect(parseRecipeItem({ title: "T", ingredients: ["x"], instructions: ["y"], source: "https://e.com/r" }).ok).toBe(true);
    expect(parseObservationItem(sale).ok).toBe(true);
    expect(parseSaleObservation(sale).ok).toBe(true);
  });
});

describe("OrderLineSchema (the pull-list line)", () => {
  it("round-trips a well-formed line", () => {
    const r = OrderLineSchema.safeParse({ item_id: "olive oil", name: "extra virgin olive oil", quantity: 1, for_recipes: ["pesto"], assumed_quantity: true });
    expect(r.success).toBe(true);
  });

  it("rejects a blank item_id, a non-positive quantity, or a missing assumed_quantity", () => {
    expect(OrderLineSchema.safeParse({ item_id: "", name: "x", quantity: 1, for_recipes: [], assumed_quantity: false }).success).toBe(false);
    expect(OrderLineSchema.safeParse({ item_id: "x", name: "x", quantity: 0, for_recipes: [], assumed_quantity: false }).success).toBe(false);
    expect(OrderLineSchema.safeParse({ item_id: "x", name: "x", quantity: 1, for_recipes: [] }).success).toBe(false);
  });
});

describe("parseOrderReceiptRequest (observations kept RAW for per-item validation)", () => {
  it("validates a receipt carrying observations + mark_placed", () => {
    const r = parseOrderReceiptRequest({ order_list_id: "ol_abc", observations: [cartedObs], mark_placed: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.order_list_id).toBe("ol_abc");
      expect(r.value.mark_placed).toBe(true);
      expect(r.value.observations).toHaveLength(1);
      // The reported observations are the shared union — each validates individually.
      expect(parseObservationItem(r.value.observations![0]).ok).toBe(true);
    }
  });

  it("validates a mark-placed-only re-post (no observations)", () => {
    const r = parseOrderReceiptRequest({ order_list_id: "ol_abc", mark_placed: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.observations).toBeUndefined();
  });

  it("rejects a blank order_list_id with a structured error", () => {
    const r = parseOrderReceiptRequest({ order_list_id: "", observations: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("order_list_id");
  });

  it("a structurally-incomplete observation rides through the envelope (raw) and is rejected only per-item", () => {
    const r = parseOrderReceiptRequest({ order_list_id: "ol_x", observations: [{ kind: "order", disposition: "carted" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(parseObservationItem(r.value.observations![0]).ok).toBe(false);
  });

  it("carries the optional local_rejects summary (satellite-source-audit) and stays additive", () => {
    const withSummary = parseOrderReceiptRequest({
      order_list_id: "ol_x",
      observations: [cartedObs],
      local_rejects: [{ category: "contract_invalid", count: 5, sample: "adapter emitted an invalid order observation" }],
    });
    expect(withSummary.ok).toBe(true);
    if (withSummary.ok) expect(withSummary.value.local_rejects?.[0]).toMatchObject({ category: "contract_invalid", count: 5 });
    // Omitting it is unaffected; a malformed entry sinks the parse.
    const without = parseOrderReceiptRequest({ order_list_id: "ol_x", observations: [cartedObs] });
    expect(without.ok).toBe(true);
    if (without.ok) expect(without.value.local_rejects).toBeUndefined();
    expect(parseOrderReceiptRequest({ order_list_id: "ol_x", local_rejects: [{ category: "contract_invalid", count: 0 }] }).ok).toBe(false);
  });
});
