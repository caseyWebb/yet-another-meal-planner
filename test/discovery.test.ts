import { describe, it, expect } from "vitest";
import {
  canonicalizeUrl,
  extractRecipeSources,
  indexSourceToSlug,
  buildCandidates,
  slugify,
  buildNewRecipe,
  type FeedEntry,
} from "../src/discovery.js";
import { parseMarkdown } from "../src/parse.js";
import { GitHubError, type GitHubClient } from "../src/github.js";

function ghWith(files: Record<string, string>): GitHubClient {
  return {
    async getFile(path: string) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async getRef() {
      return "x";
    },
    async getCommitTree() {
      return "x";
    },
    async createTree() {
      return "x";
    },
    async createCommit() {
      return "x";
    },
    async updateRef() {},
    async createIssue() {
      return { url: "https://example.test/issues/1", number: 1 };
    },
  };
}

describe("canonicalizeUrl", () => {
  it("strips query, fragment, and trailing slash", () => {
    expect(canonicalizeUrl("https://x.com/a/b/?utm=1#frag")).toBe("https://x.com/a/b");
    expect(canonicalizeUrl("https://x.com/a/")).toBe("https://x.com/a");
    expect(canonicalizeUrl("https://thewoksoflife.com/dumplings/?adt_ei=*|EMAIL|*")).toBe(
      "https://thewoksoflife.com/dumplings",
    );
  });
  it("keeps the root path and returns junk unchanged", () => {
    expect(canonicalizeUrl("https://x.com/")).toBe("https://x.com/");
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

describe("extractRecipeSources", () => {
  it("collects canonicalized source URLs, ignoring null/missing", () => {
    const index = JSON.stringify({
      a: { slug: "a", source: "https://ex.com/one/?ref=x" },
      b: { slug: "b", source: null },
      c: { slug: "c" },
    });
    const set = extractRecipeSources(index);
    expect(set.has("https://ex.com/one")).toBe(true);
    expect(set.size).toBe(1);
  });
  it("returns an empty set for absent or malformed index", () => {
    expect(extractRecipeSources(null).size).toBe(0);
    expect(extractRecipeSources("{not json").size).toBe(0);
  });
});

describe("indexSourceToSlug (idempotent import, §6.4)", () => {
  it("maps canonicalized source URLs to their recipe slug", () => {
    const index = JSON.stringify({
      "miso-salmon": { slug: "miso-salmon", source: "https://ex.com/salmon/?utm=1" },
      "no-source": { slug: "no-source" },
    });
    const map = indexSourceToSlug(index);
    // A tracker-wrapped variant of the same URL resolves to the existing slug.
    expect(map.get(canonicalizeUrl("https://ex.com/salmon#print"))).toBe("miso-salmon");
    expect(map.size).toBe(1);
  });

  it("first slug wins on a source collision; empty for absent/malformed", () => {
    const dupes = JSON.stringify({
      a: { source: "https://ex.com/x" },
      b: { source: "https://ex.com/x/" },
    });
    expect(indexSourceToSlug(dupes).get("https://ex.com/x")).toBe("a");
    expect(indexSourceToSlug(null).size).toBe(0);
    expect(indexSourceToSlug("{ not json").size).toBe(0);
  });
});

describe("buildCandidates", () => {
  const entries: FeedEntry[] = [
    { item: { title: "New One", link: "https://ex.com/new/?utm=1", summary: "s" }, feedName: "Feed A", feedWeight: 1 },
    { item: { title: "Already Have", link: "https://ex.com/old", summary: null }, feedName: "Feed A", feedWeight: 1 },
    { item: { title: "Dup In Pool", link: "https://ex.com/new", summary: null }, feedName: "Feed B", feedWeight: 0.7 },
  ];

  it("drops corpus dupes and in-pool dupes, canonicalizing and passing feed_weight", () => {
    const seen = new Set(["https://ex.com/old"]);
    const out = buildCandidates(entries, seen);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      url: "https://ex.com/new",
      title: "New One",
      source: "Feed A",
      feed_weight: 1,
      summary: "s",
    });
  });
});

describe("slugify", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(slugify("Arroz Caldo (Filipino Chicken & Rice)")).toBe("arroz-caldo-filipino-chicken-rice");
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });
});

const BODY = "## Ingredients\n- a\n\n## Instructions\n1. do it\n";

describe("buildNewRecipe", () => {
  it("creates recipes/<slug>.md, defaulting status to draft", async () => {
    const gh = ghWith({});
    const { slug, file } = await buildNewRecipe(gh, { title: "Test Dish" }, BODY);
    expect(slug).toBe("test-dish");
    expect(file.path).toBe("recipes/test-dish.md");
    const { frontmatter, body } = parseMarkdown(file.content);
    expect(frontmatter.status).toBe("draft");
    expect(body).toContain("## Ingredients");
  });

  it("preserves an explicit status", async () => {
    const gh = ghWith({});
    const { file } = await buildNewRecipe(gh, { title: "X", status: "active" }, BODY);
    expect(parseMarkdown(file.content).frontmatter.status).toBe("active");
  });

  it("refuses to overwrite an existing slug", async () => {
    const gh = ghWith({ "recipes/test-dish.md": "---\ntitle: Test Dish\n---\n## Ingredients\n## Instructions\n" });
    await expect(buildNewRecipe(gh, { title: "Test Dish" }, BODY)).rejects.toMatchObject({ code: "slug_exists" });
  });

  it("rejects a body missing the H2 contract", async () => {
    const gh = ghWith({});
    await expect(buildNewRecipe(gh, { title: "No Sections" }, "just prose")).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("rejects when no title/slug is derivable", async () => {
    const gh = ghWith({});
    await expect(buildNewRecipe(gh, {}, BODY)).rejects.toMatchObject({ code: "validation_failed" });
  });
});
