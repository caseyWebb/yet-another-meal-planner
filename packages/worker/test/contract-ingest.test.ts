import { describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  parseSatelliteBatch,
  parseObservationItem,
  parseRecipeItem,
  parseSatelliteEnvelope,
  type SatelliteBatch,
} from "@grocery-agent/contract";

// Locks the satellite ingest WIRE CONTRACT (packages/contract) and, by importing it
// across the workspace boundary, proves the worker↔contract link resolves at test
// runtime too. Covers the v2 round-trip, the v1→v2 normalization compat path, and the
// unknown-capability + unknown-kind rejections.

const validItem = {
  title: "Braised Short Ribs",
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear the ribs.", "Braise 3 hours."],
  source: "https://cooking.example.com/braised-short-ribs",
};

const validObservation = { kind: "recipe" as const, ...validItem };

const validBatch: SatelliteBatch = {
  capability: "recipe-scrape",
  source: "NYT Cooking",
  satellite_version: "1.0.0",
  contract_version: CONTRACT_VERSION,
  observations: [validObservation],
};

describe("v2 satellite batch", () => {
  it("round-trips a well-formed v2 batch", () => {
    const r = parseSatelliteBatch(validBatch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.capability).toBe("recipe-scrape");
      expect(r.value.observations).toHaveLength(1);
      expect(r.value.observations[0].kind).toBe("recipe");
    }
  });

  it("rejects a v2 batch with a blank source", () => {
    expect(parseSatelliteBatch({ ...validBatch, source: "  " }).ok).toBe(false);
  });

  it("rejects a v2 batch with no observations", () => {
    expect(parseSatelliteBatch({ ...validBatch, observations: [] }).ok).toBe(false);
  });

  it("rejects a v2 batch declaring an unimplemented capability", () => {
    const r = parseSatelliteBatch({ ...validBatch, capability: "sale-scan" });
    expect(r.ok).toBe(false);
  });
});

describe("observation items", () => {
  it("accepts a recipe observation with optional facets", () => {
    const r = parseObservationItem({ ...validObservation, summary: "rich + winey", servings: 4, time_total: 210, time_active: 30 });
    expect(r.ok).toBe(true);
  });

  it("rejects a recipe observation missing its source URL", () => {
    const { source: _drop, ...noSource } = validObservation;
    const r = parseObservationItem(noSource);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("source");
  });

  it("rejects a non-http source scheme", () => {
    expect(parseObservationItem({ ...validObservation, source: "ftp://x/y" }).ok).toBe(false);
  });

  it("rejects empty ingredients or instructions", () => {
    expect(parseObservationItem({ ...validObservation, ingredients: [] }).ok).toBe(false);
    expect(parseObservationItem({ ...validObservation, instructions: [] }).ok).toBe(false);
  });

  it("rejects an unknown observation kind", () => {
    const r = parseObservationItem({ kind: "sale", regular: 4.99, promo: 3.49 });
    expect(r.ok).toBe(false);
  });
});

describe("parseRecipeItem (adapter self-validation)", () => {
  it("accepts the bare functional-facts shape", () => {
    expect(parseRecipeItem(validItem).ok).toBe(true);
  });
});

describe("parseSatelliteEnvelope (lenient dual-shape)", () => {
  it("accepts a v2 envelope and reports the reported version", () => {
    const r = parseSatelliteEnvelope(validBatch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.wire).toBe("v2");
      expect(r.value.capability).toBe("recipe-scrape");
      expect(r.value.satelliteVersion).toBe("1.0.0");
      expect(r.value.observations).toHaveLength(1);
    }
  });

  it("normalizes a v1 batch to the recipe-scrape capability", () => {
    const v1 = { source: "NYT Cooking", scraper_version: "0.9.0", contract_version: "v1", recipes: [validItem] };
    const r = parseSatelliteEnvelope(v1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.wire).toBe("v1");
      expect(r.value.capability).toBe("recipe-scrape");
      expect(r.value.satelliteVersion).toBe("0.9.0"); // scraper_version → satelliteVersion
      expect(r.value.contractVersion).toBe("v1");
      expect(r.value.observations).toHaveLength(1);
      // Each v1 recipe is tagged kind:"recipe" so it validates against the discriminated union.
      const item = parseObservationItem(r.value.observations[0]);
      expect(item.ok).toBe(true);
      if (item.ok) expect(item.value.kind).toBe("recipe");
    }
  });

  it("rejects a v2 envelope with an unimplemented capability", () => {
    const r = parseSatelliteEnvelope({ ...validBatch, capability: "order-fill" });
    expect(r.ok).toBe(false);
  });

  it("rejects a batch that is neither valid v1 nor v2", () => {
    expect(parseSatelliteEnvelope({ source: "X" }).ok).toBe(false);
    expect(parseSatelliteEnvelope(null).ok).toBe(false);
  });
});
