import { describe, it, expect } from "vitest";
import { addStockup, type StockupItem } from "../src/stockup.js";

describe("addStockup", () => {
  it("adds items to an empty list", () => {
    const { items, added, changed } = addStockup(
      [],
      null,
      {
        items: [
          { name: "chicken thighs", unit: "lb", typical_purchase: "5 lb" },
          { name: "salmon", buy_at_or_below: 9.99 },
        ],
      },
    );
    expect(added).toBe(2);
    expect(changed).toBe(true);
    expect(items.map((r) => r.name)).toEqual(["chicken thighs", "salmon"]);
  });

  it("dedups by normalized name (case/whitespace-insensitive), existing untouched", () => {
    const first = addStockup([], null, { items: [{ name: "Chicken Thighs", unit: "lb" }] });
    const second = addStockup(first.items, first.freezer, {
      items: [
        { name: "  chicken   thighs ", unit: "kg" }, // dup → ignored, original kept
        { name: "rice", typical_purchase: "10 lb" },
      ],
    });
    expect(second.added).toBe(1);
    expect(second.items.map((r) => r.name)).toEqual(["Chicken Thighs", "rice"]);
    expect(second.items[0].unit).toBe("lb"); // not overwritten with kg
  });

  it("omits absent optional fields — thresholds are not required", () => {
    const { items } = addStockup([], null, { items: [{ name: "salmon" }] });
    expect(items[0]).toEqual({ name: "salmon" });
    expect("baseline_price" in items[0]).toBe(false);
    expect("buy_at_or_below" in items[0]).toBe(false);
  });

  it("sets freezer_capacity_estimate (returned separately for the profile row)", () => {
    const { items, freezer, changed } = addStockup([], null, {
      items: [{ name: "salmon" }],
      freezer_capacity_estimate: "moderate",
    });
    expect(changed).toBe(true);
    expect(freezer).toBe("moderate");
    expect(items).toHaveLength(1);
  });

  it("reports no change when nothing new is added and freezer is unchanged", () => {
    const first = addStockup([], null, {
      items: [{ name: "salmon" }],
      freezer_capacity_estimate: "tight",
    });
    const noop = addStockup(first.items, first.freezer, {
      items: [{ name: "salmon" }], // dup
      freezer_capacity_estimate: "tight", // same value
    });
    expect(noop.added).toBe(0);
    expect(noop.changed).toBe(false);
    expect(noop.freezer).toBe("tight");
  });

  it("counts a freezer-estimate change alone as a change", () => {
    const existing: StockupItem[] = [{ name: "salmon" }];
    const updated = addStockup(existing, "tight", { freezer_capacity_estimate: "spacious" });
    expect(updated.added).toBe(0);
    expect(updated.changed).toBe(true);
    expect(updated.freezer).toBe("spacious");
  });
});
