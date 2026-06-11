import { describe, it, expect } from "vitest";
import { addStockup } from "../src/stockup.js";
import { parseToml } from "../src/parse.js";

function items(text: string): Record<string, unknown>[] {
  const parsed = parseToml(text, "stockup.toml");
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
}

describe("addStockup", () => {
  it("adds items to an empty file and preserves the doc header", () => {
    const { text, added, changed } = addStockup(null, {
      items: [
        { name: "chicken thighs", unit: "lb", typical_purchase: "5 lb" },
        { name: "salmon", buy_at_or_below: 9.99 },
      ],
    });
    expect(added).toBe(2);
    expect(changed).toBe(true);
    expect(text.startsWith("# stockup.toml")).toBe(true);
    const rows = items(text);
    expect(rows.map((r) => r.name)).toEqual(["chicken thighs", "salmon"]);
  });

  it("dedups by normalized name (case/whitespace-insensitive), existing untouched", () => {
    const first = addStockup(null, { items: [{ name: "Chicken Thighs", unit: "lb" }] });
    const second = addStockup(first.text, {
      items: [
        { name: "  chicken   thighs ", unit: "kg" }, // dup → ignored, original kept
        { name: "rice", typical_purchase: "10 lb" },
      ],
    });
    expect(second.added).toBe(1);
    const rows = items(second.text);
    expect(rows.map((r) => r.name)).toEqual(["Chicken Thighs", "rice"]);
    expect(rows[0].unit).toBe("lb"); // not overwritten with kg
  });

  it("omits absent optional fields (no null) — thresholds are not required", () => {
    const { text } = addStockup(null, { items: [{ name: "salmon" }] });
    const rows = items(text);
    expect(rows[0]).toEqual({ name: "salmon" });
    expect("baseline_price" in rows[0]).toBe(false);
    expect("buy_at_or_below" in rows[0]).toBe(false);
  });

  it("sets freezer_capacity_estimate before the items tables and round-trips", () => {
    const { text, changed } = addStockup(null, {
      items: [{ name: "salmon" }],
      freezer_capacity_estimate: "moderate",
    });
    expect(changed).toBe(true);
    // Scalar must precede the [[items]] tables or TOML would bind it to the last item.
    expect(text.indexOf("freezer_capacity_estimate")).toBeLessThan(text.indexOf("[[items]]"));
    const parsed = parseToml(text, "stockup.toml");
    expect(parsed.freezer_capacity_estimate).toBe("moderate");
    expect(items(text)).toHaveLength(1);
  });

  it("reports no change when nothing new is added", () => {
    const first = addStockup(null, {
      items: [{ name: "salmon" }],
      freezer_capacity_estimate: "tight",
    });
    const noop = addStockup(first.text, {
      items: [{ name: "salmon" }], // dup
      freezer_capacity_estimate: "tight", // same value
    });
    expect(noop.added).toBe(0);
    expect(noop.changed).toBe(false);
  });

  it("counts a freezer-estimate change alone as a change", () => {
    const first = addStockup(null, { items: [{ name: "salmon" }] });
    const updated = addStockup(first.text, { freezer_capacity_estimate: "spacious" });
    expect(updated.added).toBe(0);
    expect(updated.changed).toBe(true);
    expect(parseToml(updated.text, "stockup.toml").freezer_capacity_estimate).toBe("spacious");
  });
});
