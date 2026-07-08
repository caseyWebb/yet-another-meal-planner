import { describe, it, expect } from "vitest";
import { normalizeDateValue, parseMarkdown } from "../src/parse.js";
import { ToolError } from "../src/errors.js";

const RECIPE = `---
title: American Chop Suey
protein: beef
tags: [american, beef]
time_total: 40
---

Brown the beef, add the macaroni and tomatoes.
`;

describe("parseMarkdown", () => {
  it("splits frontmatter and body", () => {
    const { frontmatter, body } = parseMarkdown(RECIPE, "recipe.md");
    expect(frontmatter.title).toBe("American Chop Suey");
    expect(frontmatter.tags).toEqual(["american", "beef"]);
    expect(frontmatter.time_total).toBe(40);
    expect(body.trim()).toBe("Brown the beef, add the macaroni and tomatoes.");
  });

  it("treats a document with no fence as empty frontmatter + full body", () => {
    const { frontmatter, body } = parseMarkdown("# Just markdown\n");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just markdown\n");
  });

  it("throws malformed_data on invalid YAML frontmatter", () => {
    const bad = "---\ntitle: [unterminated\n---\nbody\n";
    try {
      parseMarkdown(bad, "bad.md");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).code).toBe("malformed_data");
    }
  });

  it("keeps an unquoted YYYY-MM-DD frontmatter value a plain string", () => {
    const { frontmatter } = parseMarkdown("---\ndiscovered_at: 2026-06-09\n---\nbody\n");
    expect(frontmatter.discovered_at).toBe("2026-06-09");
    expect(typeof frontmatter.discovered_at).toBe("string");
  });
});

// The bundled js-yaml never resolves timestamps to Dates, so the normalizer is
// exercised directly — it guards against Date values from other tooling / an older
// YAML 1.1 loader, keeping parse → serialize a fixed point.
describe("normalizeDateValue", () => {
  it("collapses a midnight-UTC Date to its authored YYYY-MM-DD form", () => {
    expect(normalizeDateValue(new Date(Date.UTC(2026, 5, 9)))).toBe("2026-06-09");
  });

  it("preserves a real time component as the full ISO string (never truncated)", () => {
    expect(normalizeDateValue(new Date(Date.UTC(2026, 5, 9, 14, 30, 5, 123)))).toBe(
      "2026-06-09T14:30:05.123Z",
    );
  });

  it("passes non-Date values through unchanged", () => {
    expect(normalizeDateValue("2026-06-09")).toBe("2026-06-09");
    expect(normalizeDateValue(40)).toBe(40);
    expect(normalizeDateValue(null)).toBe(null);
    const arr = ["a"];
    expect(normalizeDateValue(arr)).toBe(arr);
  });
});
