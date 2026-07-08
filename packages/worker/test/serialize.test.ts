import { describe, it, expect } from "vitest";
import { serializeMarkdown } from "../src/serialize.js";
import { parseMarkdown } from "../src/parse.js";

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

  it("quotes a date-like string so it reparses as a string", () => {
    const out = serializeMarkdown({ discovered_at: "2026-06-09" }, "body\n");
    expect(out).toContain("'2026-06-09'");
    expect(parseMarkdown(out).frontmatter.discovered_at).toBe("2026-06-09");
  });

  it("an unquoted authored date is round-trip stable: parse → serialize → parse → serialize", () => {
    const authored = "---\ntitle: X\ndiscovered_at: 2026-06-09\n---\nbody\n";
    const p1 = parseMarkdown(authored);
    expect(p1.frontmatter.discovered_at).toBe("2026-06-09");
    const s1 = serializeMarkdown(p1.frontmatter, p1.body);
    const p2 = parseMarkdown(s1);
    expect(p2.frontmatter.discovered_at).toBe("2026-06-09");
    // The second write is byte-identical to the first — no per-write drift.
    expect(serializeMarkdown(p2.frontmatter, p2.body)).toBe(s1);
  });

  it("a Date that leaked into frontmatter normalizes to its date string on the next round-trip", () => {
    // parseMarkdown normalizes Date values (see parse.ts normalizeDateValue); prove the
    // serialize side of that self-heal: a midnight-UTC Date dumps as a full ISO timestamp,
    // which the next parse → serialize keeps as a stable string (information preserved).
    const drifted = serializeMarkdown({ discovered_at: new Date(Date.UTC(2026, 5, 9)) }, "body\n");
    expect(drifted).toContain("2026-06-09T00:00:00.000Z");
    const p1 = parseMarkdown(drifted);
    expect(p1.frontmatter.discovered_at).toBe("2026-06-09T00:00:00.000Z");
    const s1 = serializeMarkdown(p1.frontmatter, p1.body);
    expect(serializeMarkdown(parseMarkdown(s1).frontmatter, p1.body)).toBe(s1);
  });
});
