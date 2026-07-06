import { describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  LOCAL_REJECT_CATEGORIES,
  parseSatelliteBatch,
  parseObservationItem,
  parseRecipeItem,
  parseSaleObservation,
  parseSatelliteEnvelope,
  type LocalReject,
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
    // `order-fill` is the still-unimplemented capability (recipe-scrape + sale-scan are defined).
    const r = parseSatelliteBatch({ ...validBatch, capability: "order-fill" });
    expect(r.ok).toBe(false);
  });

  it("accepts a v2 batch declaring the sale-scan capability", () => {
    const r = parseSatelliteBatch({ ...validBatch, capability: "sale-scan", observations: [validSale] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.capability).toBe("sale-scan");
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
    const r = parseObservationItem({ kind: "order", regular: 4.99, promo: 3.49 });
    expect(r.ok).toBe(false);
  });
});

const validSale = {
  kind: "sale" as const,
  store: "target",
  locationId: "T-1234",
  productId: "sku-abc",
  description: "Organic 2% Milk",
  size: "1 gal",
  regular: 4.99,
  promo: 3.49,
  brand: "Good & Gather",
  categories: ["Dairy"],
  url: "https://www.target.com/p/milk/-/A-123",
};

describe("sale observations (sensor-not-judge)", () => {
  it("round-trips a well-formed sale observation", () => {
    const r = parseObservationItem(validSale);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "sale") {
      expect(r.value.regular).toBe(4.99);
      expect(r.value.promo).toBe(3.49);
      expect(r.value.productId).toBe("sku-abc");
    }
  });

  it("accepts a bare sale (only the required raw facts)", () => {
    const bare = { kind: "sale" as const, store: "target", locationId: "T-1", productId: "s", description: "d", regular: 2, promo: 1 };
    expect(parseObservationItem(bare).ok).toBe(true);
  });

  it("carries NO derived saving on the wire — a set `savings`/`savings_pct` is stripped, not modeled", () => {
    // sensor-not-judge: the satellite reports only raw facts; a smuggled saving is silently dropped
    // (default object strip) so it can never influence the Worker's re-derivation.
    const r = parseSaleObservation({ ...validSale, savings: 1.5, savings_pct: 30, on_sale: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toHaveProperty("savings");
      expect(r.value).not.toHaveProperty("savings_pct");
      expect(r.value).not.toHaveProperty("on_sale");
    }
  });

  it("parses an implausible-but-structural sale (plausibility is Worker-side, not contract-side)", () => {
    // promo >= regular is structurally valid (both are just numbers); the Worker rejects it per-item.
    expect(parseObservationItem({ ...validSale, promo: 9.99 }).ok).toBe(true);
    // A 99% markdown is structurally valid too — the Worker's markdown ceiling catches it.
    expect(parseSaleObservation({ ...validSale, regular: 100, promo: 0.5 }).ok).toBe(true);
  });

  it("rejects a sale missing a required raw fact or with a bad price type", () => {
    const { productId: _drop, ...noProduct } = validSale;
    expect(parseObservationItem(noProduct).ok).toBe(false);
    expect(parseObservationItem({ ...validSale, regular: 0 }).ok).toBe(false); // regular must be positive
    expect(parseObservationItem({ ...validSale, promo: -1 }).ok).toBe(false); // promo must be non-negative
    expect(parseObservationItem({ ...validSale, url: "ftp://x/y" }).ok).toBe(false); // http(s) only
  });

  it("leaves the recipe arm unaffected — a recipe observation still validates alongside the sale arm", () => {
    expect(parseObservationItem(validObservation).ok).toBe(true);
    expect(parseRecipeItem(validItem).ok).toBe(true);
  });
});

describe("parseRecipeItem (adapter self-validation)", () => {
  it("accepts the bare functional-facts shape", () => {
    expect(parseRecipeItem(validItem).ok).toBe(true);
  });
});

describe("local_rejects wire summary (satellite-source-audit) — additive + optional, stays v2", () => {
  const localRejects: LocalReject[] = [
    { category: "contract_invalid", count: 12, sample: "adapter emitted an invalid sale observation: productId: Required" },
    { category: "judgment_smuggled", count: 2, sample: 'sensor-not-judge violation: adapter emitted a derived "savings" field' },
  ];

  it("exposes exactly the two reason categories", () => {
    expect([...LOCAL_REJECT_CATEGORIES]).toEqual(["contract_invalid", "judgment_smuggled"]);
  });

  it("(a) a batch WITHOUT local_rejects still validates and reports contract_version v2", () => {
    // The additive field being absent is the common case — it must not perturb the v2 contract.
    expect(CONTRACT_VERSION).toBe("v2");
    const r = parseSatelliteBatch(validBatch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.contract_version).toBe("v2");
      expect(r.value).not.toHaveProperty("local_rejects");
    }
    // The lenient Worker-side envelope parse agrees and carries no summary.
    const e = parseSatelliteEnvelope(validBatch);
    expect(e.ok).toBe(true);
    if (e.ok) {
      expect(e.value.contractVersion).toBe("v2");
      expect(e.value.localRejects).toBeUndefined();
    }
  });

  it("(b) a batch WITH local_rejects validates, round-trips, and STAYS v2", () => {
    const withSummary = { ...validBatch, local_rejects: localRejects };
    const r = parseSatelliteBatch(withSummary);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.contract_version).toBe("v2"); // additive ⇒ no version bump
      expect(r.value.local_rejects).toEqual(localRejects);
    }
    // A receiving Worker reads the summary off the lenient envelope (localRejects threaded through).
    const e = parseSatelliteEnvelope(withSummary);
    expect(e.ok).toBe(true);
    if (e.ok) expect(e.value.localRejects).toEqual(localRejects);
  });

  it("(c) rejects a malformed entry — an unknown category or a non-positive count", () => {
    expect(parseSatelliteBatch({ ...validBatch, local_rejects: [{ category: "bogus", count: 1 }] }).ok).toBe(false);
    expect(parseSatelliteBatch({ ...validBatch, local_rejects: [{ category: "contract_invalid", count: -1 }] }).ok).toBe(false);
    expect(parseSatelliteBatch({ ...validBatch, local_rejects: [{ category: "contract_invalid", count: 0 }] }).ok).toBe(false);
    expect(parseSatelliteBatch({ ...validBatch, local_rejects: [{ category: "contract_invalid", count: 1.5 }] }).ok).toBe(false);
  });

  it("accepts an entry without the optional sample", () => {
    const r = parseSatelliteBatch({ ...validBatch, local_rejects: [{ category: "contract_invalid", count: 3 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.local_rejects?.[0].sample).toBeUndefined();
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

  it("reports a clear neither-shape error for a v2 batch missing both discriminators (typo'd observations)", () => {
    // A v2 producer that dropped `capability` and typo'd `observations`→`observation` has neither
    // v2 discriminator, so it falls to the v1 fork — but must not be rejected with a v1-shaped
    // complaint (scraper_version/recipes) that misleads a v2 author.
    const r = parseSatelliteEnvelope({
      source: "NYT Cooking",
      satellite_version: "1.0.0",
      contract_version: CONTRACT_VERSION,
      observation: [validObservation], // typo: should be `observations`
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("matches neither");
      expect(r.error).toContain("v1 recipe shape");
      expect(r.error).toContain("v2 capability-tagged shape");
    }
  });
});
