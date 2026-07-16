import { describe, it, expect } from "vitest";
import { PROTEIN_VOCAB, CUISINE_VOCAB, EQUIPMENT_VOCAB } from "../src/vocab.js";
import { EQUIPMENT_VOCAB as KITCHEN_EQUIPMENT_VOCAB } from "../src/kitchen.js";

// The Worker validator (src/validate.ts), the kitchen logic (src/kitchen.ts), and
// the reconcile contract (src/recipe-contract.js, run by src/recipe-projection.ts) all
// draw these sets from src/vocab.js. These guards pin the buckets that matter and prove
// there is no second copy (the reconcile side is covered in test/recipe-projection.test.ts).
describe("controlled vocabularies (single source of truth)", () => {
  it("protein uses coarse buckets — shellfish in, shrimp/none out", () => {
    expect(PROTEIN_VOCAB).toContain("shellfish");
    expect(PROTEIN_VOCAB).not.toContain("shrimp");
    expect(PROTEIN_VOCAB).not.toContain("none");
  });

  it("cuisine and equipment carry the expected members", () => {
    expect(CUISINE_VOCAB).toContain("thai");
    expect(EQUIPMENT_VOCAB).toContain("blender");
    expect(EQUIPMENT_VOCAB).not.toContain("air-fryer");
  });

  it("kitchen re-exports the shared EQUIPMENT_VOCAB (no second copy)", () => {
    // Same array reference ⇒ exactly one definition feeds both consumers.
    expect(KITCHEN_EQUIPMENT_VOCAB).toBe(EQUIPMENT_VOCAB);
  });
});
