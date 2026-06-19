import { describe, it, expect } from "vitest";
import { stripEmptyVarietyDimensions, serializeMarkdown } from "../src/serialize.js";

describe("stripEmptyVarietyDimensions", () => {
  it("drops a `none` protein so a no-protein dish writes as field-absent", () => {
    const fm = stripEmptyVarietyDimensions({ title: "Radish Kimchi", protein: "none" });
    expect("protein" in fm).toBe(false);
    expect(fm.title).toBe("Radish Kimchi");
  });

  it("drops an empty / n/a value, case- and whitespace-insensitively", () => {
    expect("protein" in stripEmptyVarietyDimensions({ protein: "" })).toBe(false);
    expect("protein" in stripEmptyVarietyDimensions({ protein: "  NONE " })).toBe(false);
    expect("cuisine" in stripEmptyVarietyDimensions({ cuisine: "N/A" })).toBe(false);
  });

  it("normalizes both protein and cuisine independently", () => {
    const fm = stripEmptyVarietyDimensions({ protein: "none", cuisine: "thai" });
    expect("protein" in fm).toBe(false);
    expect(fm.cuisine).toBe("thai");
  });

  it("leaves a real (even off-vocab) value alone — the vocab check handles those", () => {
    // "shrimp" is off-vocab but NOT empty/none, so it survives here and is caught
    // downstream by validateFile (which maps it to the corrective error).
    const fm = stripEmptyVarietyDimensions({ protein: "shrimp" });
    expect(fm.protein).toBe("shrimp");
  });

  it("leaves a valid bucket untouched", () => {
    const fm = stripEmptyVarietyDimensions({ protein: "shellfish", cuisine: "japanese" });
    expect(fm.protein).toBe("shellfish");
    expect(fm.cuisine).toBe("japanese");
  });

  it("the stripped field does not appear in the serialized markdown", () => {
    const out = serializeMarkdown(stripEmptyVarietyDimensions({ title: "X", protein: "none" }), "body\n");
    expect(out).not.toMatch(/protein/);
  });
});
