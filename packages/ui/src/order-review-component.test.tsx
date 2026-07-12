import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OrderReviewData } from "@yamp/contract";
import { OrderReview } from "./components/order-review";

const product = {
  sku: "1",
  brand: "A",
  description: "Milk",
  size: "1 gal",
  price: { regular: 4, promo: 3 },
  on_sale: true,
  fulfillment: { curbside: true, delivery: true },
};
const data: OrderReviewData = {
  contract_version: 2,
  preview_fingerprint: "p",
  grocery_snapshot_version: "g",
  as_of: "2026-07-12T00:00:00Z",
  store: { name: "Kroger", location_id: "L1" },
  quote_disclaimer: "Current quote",
  stale_cart_count: 3,
  cleared_cart_ack_required: true,
  matched: [
    {
      line_key: "milk",
      name: "milk",
      quantity: 1,
      assumed_quantity: true,
      for_recipes: [],
      provenance: "planned",
      selected: product,
      selection_source: "matched",
      options: [{ ...product, sku: "2", description: "Other milk" }],
      featured_swap: { ...product, sku: "2", description: "Other milk" },
      family_key: "milk",
      family_fingerprint: "f",
    },
  ],
  decisions: [
    {
      line_key: "bread",
      name: "bread",
      quantity: 1,
      assumed_quantity: false,
      for_recipes: [],
      provenance: "planned",
      kind: "unavailable",
      candidates: [],
      family_key: "bread",
      family_fingerprint: "b",
      can_save_brand: false,
      can_search_broader: true,
      can_search_manual: false,
    },
  ],
  left_off: [],
  underived: [],
  counts: { going_to_cart: 1, needs_decision: 1, left_off: 1 },
  estimated_total: 3,
  flyer_savings: 1,
  stage: { skipped: [], quantities: {}, selections: [], impulses: [], saved_brands: [] },
};

describe("shared Order Review component", () => {
  it("renders saved unknown-newer facts while disabling every review control", () => {
    const html = renderToStaticMarkup(
      <OrderReview
        data={data}
        adapter={{
          mode: "readonly",
          preview: async () => data,
          search: async () => {
            throw new Error("unused");
          },
          saveBrand: async () => {
            throw new Error("unused");
          },
          send: async () => {
            throw new Error("unused");
          },
          closeToGrocery: () => undefined,
        }}
      />,
    );
    expect(html).toContain("read-only");
    expect(html).toContain("Featured swap");
    expect(html).toContain("3 prior items");
    expect(html).not.toContain("Search catalog for bread");
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThan(6);
    expect((html.match(/name=\"choice-milk\"/g) ?? []).length).toBe(2);
  });
});
