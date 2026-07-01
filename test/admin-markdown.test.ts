// Unit tests for src/admin/ui/markdown.ts — the shared frontmatter-stripping markdown-render
// helper (admin-ui-fidelity-pass, shared primitives 1.3). Guidance and Recipe-detail both
// consume `parseMarkdownDocument`; this locks in the two states a document can be in (fenced vs
// bare) and confirms the body renders without leaking the fence into the HTML output.

import { describe, it, expect } from "vitest";
import { parseMarkdownDocument, renderMarkdown } from "../src/admin/ui/markdown.js";

describe("parseMarkdownDocument", () => {
  it("splits a leading YAML frontmatter fence from the body and parses it", () => {
    const src = "---\ntitle: Salt\ntags: [technique]\n---\n\n# Salt\n\nBody text.\n";
    const doc = parseMarkdownDocument(src, "guidance/salt.md");
    expect(doc.frontmatter).toEqual({ title: "Salt", tags: ["technique"] });
    expect(doc.html).toContain("<h1>Salt</h1>");
    expect(doc.html).toContain("Body text.");
    // the fence itself must not leak into the rendered body (no stray leading "---" or hr).
    expect(doc.html).not.toContain("---");
    expect(doc.html.startsWith("<hr")).toBe(false);
  });

  it("yields null frontmatter (not an empty object) for a document with no fence at all", () => {
    const doc = parseMarkdownDocument("# Just markdown\n\nNo frontmatter here.\n");
    expect(doc.frontmatter).toBeNull();
    expect(doc.html).toContain("<h1>Just markdown</h1>");
  });

  it("still parses a fence with a single scalar key", () => {
    const src = "---\ntitle: x\n---\nBody.\n";
    const doc = parseMarkdownDocument(src);
    expect(doc.frontmatter).toEqual({ title: "x" });
    expect(doc.html).toContain("Body.");
  });
});

describe("renderMarkdown", () => {
  it("renders headings, lists, and code as semantic HTML", () => {
    const html = renderMarkdown("## Heading\n\n- one\n- two\n\n`code`\n");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>code</code>");
  });
});
