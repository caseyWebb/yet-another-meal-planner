import { describe, it, expect } from "vitest";
import { deriveAtRiskDemand, quantityToCount, DEFAULT_AT_RISK_PARAMS, type AtRiskInput } from "../src/use-it-up.js";

const NOW = new Date("2026-07-01T12:00:00Z");
const VOCAB = new Set(["cilantro", "salmon", "ground beef", "bok choy"]);

function row(over: Partial<AtRiskInput> & { normalizedName: string }): AtRiskInput {
  return { quantity: null, addedAt: "2026-06-01", ...over };
}

describe("quantityToCount", () => {
  it("maps a full unit to two servings' worth", () => {
    expect(quantityToCount("full", 3)).toBe(2);
  });
  it("reads an explicit leading count, capped", () => {
    expect(quantityToCount("2 bunches", 3)).toBe(2);
    expect(quantityToCount("5", 3)).toBe(3); // capped at maxCount
    expect(quantityToCount("1.5 lb", 3)).toBe(2); // ceil
  });
  it("treats partial / low / unknown / null as one", () => {
    expect(quantityToCount("partial", 3)).toBe(1);
    expect(quantityToCount("low", 3)).toBe(1);
    expect(quantityToCount("a handful", 3)).toBe(1);
    expect(quantityToCount(null, 3)).toBe(1);
  });
});

describe("deriveAtRiskDemand", () => {
  it("keeps only perishables the corpus can use, with quantity→count", () => {
    const demand = deriveAtRiskDemand(
      [
        row({ normalizedName: "cilantro", quantity: "partial" }),
        row({ normalizedName: "ground beef", quantity: "full" }),
        row({ normalizedName: "olive oil", quantity: "full" }), // not perishable → dropped
        row({ normalizedName: "", quantity: "full" }), // empty name → dropped
      ],
      VOCAB,
      NOW,
    );
    expect(demand.get("cilantro")).toBe(1);
    expect(demand.get("ground beef")).toBe(2); // "full" → two mains can split it
    expect(demand.has("olive oil")).toBe(false);
    expect(demand.size).toBe(2);
  });

  it("respects a freshness floor when configured (default 0 keeps everything)", () => {
    const rows = [row({ normalizedName: "salmon", quantity: "full", addedAt: "2026-06-30" })]; // 1 day old
    // Default floor 0 → included (always-on holistic).
    expect(deriveAtRiskDemand(rows, VOCAB, NOW).get("salmon")).toBe(2);
    // Raise the floor → a just-bought item isn't at risk yet.
    const strict = deriveAtRiskDemand(rows, VOCAB, NOW, { ...DEFAULT_AT_RISK_PARAMS, freshnessFloorDays: 5 });
    expect(strict.has("salmon")).toBe(false);
  });

  it("treats a missing added_at as aged (assume at-risk)", () => {
    const demand = deriveAtRiskDemand([row({ normalizedName: "bok choy", addedAt: null })], VOCAB, NOW, {
      ...DEFAULT_AT_RISK_PARAMS,
      freshnessFloorDays: 5,
    });
    expect(demand.get("bok choy")).toBe(1); // unknown provenance still counts
  });

  it("takes the max count when rows normalize to the same item (never sums)", () => {
    const demand = deriveAtRiskDemand(
      [row({ normalizedName: "cilantro", quantity: "partial" }), row({ normalizedName: "cilantro", quantity: "full" })],
      VOCAB,
      NOW,
    );
    expect(demand.get("cilantro")).toBe(2); // max(1, 2), not 3
  });
});
