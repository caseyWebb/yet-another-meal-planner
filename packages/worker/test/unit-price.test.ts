import { describe, it, expect } from "vitest";
import { parseSize, parsePrice, compareUnitPrice } from "../src/unit-price.js";

describe("parseSize", () => {
  it("parses volume, weight, and count sizes to base units", () => {
    expect(parseSize("16.9 fl oz")).toEqual({ dimension: "volume", quantity: 16.9 * 29.5735 });
    expect(parseSize("1/2 gal")).toEqual({ dimension: "volume", quantity: 0.5 * 3785.41 });
    expect(parseSize("1.5 lb")).toEqual({ dimension: "weight", quantity: 1.5 * 453.592 });
    expect(parseSize("6 ct")).toEqual({ dimension: "count", quantity: 6 });
  });

  it("does not confuse 'fl oz' (volume) with 'oz' (weight)", () => {
    expect(parseSize("8 fl oz")?.dimension).toBe("volume");
    expect(parseSize("8 oz")?.dimension).toBe("weight");
  });

  it("handles multi-pack prefixes", () => {
    expect(parseSize("12 x 12 fl oz")).toEqual({ dimension: "volume", quantity: 12 * 12 * 29.5735 });
  });

  it("returns null for unparseable sizes", () => {
    expect(parseSize("Family Size")).toBeNull();
    expect(parseSize("1 bunch")).toBeNull();
    expect(parseSize("")).toBeNull();
  });

  it("returns null for degenerate (zero / non-finite) quantities", () => {
    expect(parseSize("0 x 1 oz")).toBeNull(); // zero multiplier
    expect(parseSize("1/0 gal")).toBeNull(); // divide-by-zero fraction → Infinity
    expect(parseSize("0 oz")).toBeNull(); // zero quantity
  });
});

describe("parsePrice", () => {
  it("parses US-formatted strings and passes numbers through", () => {
    expect(parsePrice("3.49")).toBe(3.49);
    expect(parsePrice("$1,234.56")).toBe(1234.56);
    expect(parsePrice("1,000")).toBe(1000);
    expect(parsePrice(12.5)).toBe(12.5);
  });

  it("fails closed (null) on ambiguous or nonsensical input", () => {
    expect(parsePrice("1.234,56")).toBeNull(); // decimal-comma locale
    expect(parsePrice("1.2.3")).toBeNull(); // multiple decimal points
    expect(parsePrice("-5.00")).toBeNull(); // negative price → incomparable, not 5
    expect(parsePrice("n/a")).toBeNull();
    expect(parsePrice("")).toBeNull();
  });
});

describe("compareUnitPrice", () => {
  it("ranks same-dimension items by ascending unit price with a cheapest id", () => {
    const res = compareUnitPrice([
      { id: "a", price: "8.99", size: "16.9 fl oz" },
      { id: "b", price: "$4.50", size: "8 fl oz" },
      { id: "c", price: 12.0, size: "32 fl oz" },
    ]);
    expect(res.ranked.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(res.cheapest).toBe("c");
    expect(res.incomparable).toEqual([]);
    expect(res.ranked[0].base_unit).toBe("ml");
  });

  it("places cross-dimension items in incomparable (ranks the largest group)", () => {
    const res = compareUnitPrice([
      { id: "v1", price: "2.00", size: "16 fl oz" },
      { id: "v2", price: "3.00", size: "32 fl oz" },
      { id: "w1", price: "5.00", size: "1 lb" },
    ]);
    expect(res.ranked.map((r) => r.id).sort()).toEqual(["v1", "v2"]);
    expect(res.incomparable).toEqual(["w1"]);
  });

  it("places unparseable sizes and prices in incomparable", () => {
    const res = compareUnitPrice([
      { id: "ok", price: "2.00", size: "16 oz" },
      { id: "badsize", price: "2.00", size: "Family Size" },
      { id: "badprice", price: "n/a", size: "16 oz" },
    ]);
    expect(res.ranked.map((r) => r.id)).toEqual(["ok"]);
    expect(res.incomparable.sort()).toEqual(["badprice", "badsize"]);
  });

  it("honors quantity_override/unit_override for residue the parser missed", () => {
    const res = compareUnitPrice([
      { id: "a", price: "4.00", size: "Family Size", quantity_override: 32, unit_override: "oz" },
      { id: "b", price: "3.00", size: "16 oz" },
    ]);
    // a: 4.00 / (32*28.3495) ; b: 3.00 / (16*28.3495) -> a is cheaper per unit
    expect(res.cheapest).toBe("a");
    expect(res.incomparable).toEqual([]);
  });

  it("routes a degenerate size to incomparable, never cheapest", () => {
    const res = compareUnitPrice([
      { id: "good", price: "5.00", size: "16 oz" },
      { id: "degenerate", price: "0.01", size: "0 x 1 oz" }, // cheap-looking but unparseable
    ]);
    expect(res.cheapest).toBe("good");
    expect(res.incomparable).toEqual(["degenerate"]);
  });

  it("routes a zero quantity_override to incomparable", () => {
    const res = compareUnitPrice([
      { id: "good", price: "5.00", size: "16 oz" },
      { id: "bad", price: "1.00", size: "Family Size", quantity_override: 0, unit_override: "oz" },
    ]);
    expect(res.cheapest).toBe("good");
    expect(res.incomparable).toEqual(["bad"]);
  });
});
