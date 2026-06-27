import { describe, it, expect } from "vitest";
import { serializeMarkdown } from "../src/serialize.js";

// `stripEmptyVarietyDimensions` is retired — `protein`/`cuisine` are now PRESENT-required
// with an explicit `null` for "no protein focus" (the required-field contract), so the
// write path persists the explicit `null` rather than stripping the field to absent.

describe("serializeMarkdown", () => {
  it("round-trips frontmatter + body with a leading fence", () => {
    const out = serializeMarkdown({ title: "X", protein: "shellfish" }, "body\n");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toMatch(/title: X/);
    expect(out).toMatch(/protein: shellfish/);
    expect(out.endsWith("body\n")).toBe(true);
  });

  it("persists an explicit null (no-protein dish) rather than dropping the field", () => {
    const out = serializeMarkdown({ title: "Radish Kimchi", protein: null }, "body\n");
    expect(out).toMatch(/protein: null/);
  });
});
