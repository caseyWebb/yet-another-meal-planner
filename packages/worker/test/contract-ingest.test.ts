import { describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  parseIngestBatch,
  parseRecipeItem,
  type IngestBatch,
} from "@grocery-agent/contract";

// Locks the walled-source ingest WIRE CONTRACT (packages/contract) and, by
// importing it across the workspace boundary, proves the worker↔contract link
// resolves at test runtime too.

const validItem = {
  title: "Braised Short Ribs",
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear the ribs.", "Braise 3 hours."],
  source: "https://cooking.example.com/braised-short-ribs",
};

const validBatch: IngestBatch = {
  source: "NYT Cooking",
  scraper_version: "1.0.0",
  contract_version: CONTRACT_VERSION,
  recipes: [validItem],
};

describe("ingest wire contract", () => {
  it("accepts a well-formed batch", () => {
    const r = parseIngestBatch(validBatch);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.recipes).toHaveLength(1);
  });

  it("rejects a batch with a blank source", () => {
    const r = parseIngestBatch({ ...validBatch, source: "  " });
    expect(r.ok).toBe(false);
  });

  it("rejects a batch with no recipes", () => {
    const r = parseIngestBatch({ ...validBatch, recipes: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects an item missing its source URL", () => {
    const { source: _drop, ...noSource } = validItem;
    const r = parseRecipeItem(noSource);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("source");
  });

  it("rejects a non-http source scheme", () => {
    const r = parseRecipeItem({ ...validItem, source: "ftp://x/y" });
    expect(r.ok).toBe(false);
  });

  it("rejects an item with empty ingredients or instructions", () => {
    expect(parseRecipeItem({ ...validItem, ingredients: [] }).ok).toBe(false);
    expect(parseRecipeItem({ ...validItem, instructions: [] }).ok).toBe(false);
  });

  it("accepts optional facets when present", () => {
    const r = parseRecipeItem({ ...validItem, summary: "rich + winey", servings: 4, time_total: 210, time_active: 30 });
    expect(r.ok).toBe(true);
  });
});
