import { describe, it, expect } from "vitest";
import { handleCookbook } from "../src/cookbook.js";
import type { Env } from "../src/env.js";
import { EMBED_DIM } from "../src/embedding.js";
import { fakeR2 } from "./fake-r2.js";

/** Build an EMBED_DIM-length vector with the given non-zero entries (rest zero). */
function vec(entries: Record<number, number>): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  for (const [i, x] of Object.entries(entries)) v[Number(i)] = x;
  return v;
}

const RECIPE_MD = [
  "---",
  "title: Miso Salmon",
  "protein: fish",
  "cuisine: japanese",
  "time_total: 25",
  "source: https://ex.com/miso-salmon",
  "---",
  "",
  "## Ingredients",
  "- salmon",
  "- miso",
  "",
  "## Instructions",
  "1. Glaze and broil.",
  "",
].join("\n");

/**
 * An env whose DB returns recipe-index rows for `loadRecipeIndex` and embedding rows for
 * `loadRecipeEmbeddings` (routed by SQL), with optional Workers AI + KV fakes for search.
 */
function envWith(opts: {
  recipeRows?: Record<string, unknown>[];
  embeddingRows?: { slug: string; embedding: string }[];
  files?: Record<string, string>;
  ai?: { run: (model: string, input: unknown) => Promise<unknown> };
  kv?: Map<string, string>;
}): Env {
  const recipeRows = opts.recipeRows ?? [];
  const embeddingRows = opts.embeddingRows ?? [];
  // loadRecipeEmbeddings is the only cookbook SELECT that filters on a non-null embedding.
  const rowsFor = (sql: string) => (/embedding IS NOT NULL/.test(sql) ? embeddingRows : recipeRows);
  const makeStmt = (sql: string) => {
    const stmt = { bind: () => stmt, all: async () => ({ results: rowsFor(sql) }) };
    return stmt;
  };
  const kv = opts.kv ?? new Map<string, string>();
  return {
    DB: { prepare: (sql: string) => makeStmt(sql) },
    CORPUS: fakeR2(opts.files ?? {}).bucket,
    AI: opts.ai ?? { run: async () => ({ data: [vec({})] }) },
    KROGER_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
    },
  } as unknown as Env;
}

const get = (path: string, method = "GET") =>
  new Request(`https://groc.example.com${path}`, { method });

describe("handleCookbook", () => {
  it("renders the index from the D1 recipe index", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "miso-salmon", title: "Miso Salmon", protein: "fish", cuisine: "japanese", description: "A quick glazed salmon." },
      ],
    });
    const res = await handleCookbook(get("/cookbook"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("Cookbook");
    expect(html).toContain('href="/cookbook/miso-salmon"');
    expect(html).toContain("Miso Salmon");
    expect(html).toContain("A quick glazed salmon.");
  });

  it("renders an empty index cleanly", async () => {
    const res = await handleCookbook(get("/cookbook"), envWith({}));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No recipes yet");
  });

  it("renders one recipe's R2 body to HTML", async () => {
    const env = envWith({ files: { "recipes/miso-salmon.md": RECIPE_MD } });
    const res = await handleCookbook(get("/cookbook/miso-salmon"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Miso Salmon</h1>");
    expect(html).toContain("<h2>Ingredients</h2>"); // marked rendered the body
    expect(html).toContain("Glaze and broil");
    expect(html).toContain("https://ex.com/miso-salmon"); // source link
  });

  it("neutralizes XSS in an untrusted recipe body (drops raw HTML + unsafe URL schemes)", async () => {
    const malicious = [
      "---",
      "title: Bad Recipe",
      "source: javascript:alert('src')",
      "---",
      "",
      "## Ingredients",
      "- <img src=x onerror=alert(1)>",
      "",
      "## Instructions",
      "<script>alert(2)</script>",
      "",
      "[click me](javascript:alert(3))",
      "",
    ].join("\n");
    const env = envWith({ files: { "recipes/bad.md": malicious } });
    const res = await handleCookbook(get("/cookbook/bad"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror=/i);
    expect(html).not.toMatch(/javascript:/i); // both the body link AND the source href
    // a restrictive CSP blocks script execution even if something slipped through
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
  });

  it("returns a graceful 404 (not a 500) for a recipe with malformed YAML frontmatter", async () => {
    // `parseMarkdown` throws ToolError('malformed_data'); the open route has no runTool
    // boundary, so the handler must catch it.
    const env = envWith({ files: { "recipes/broken.md": "---\ntitle: [unclosed\n---\n## Ingredients\n" } });
    const res = await handleCookbook(get("/cookbook/broken"), env);
    expect(res.status).toBe(404);
  });

  it("404s a missing recipe", async () => {
    const res = await handleCookbook(get("/cookbook/ghost"), envWith({}));
    expect(res.status).toBe(404);
  });

  it("404s an invalid slug without touching R2", async () => {
    const res = await handleCookbook(get("/cookbook/..%2Fsecret"), envWith({}));
    expect(res.status).toBe(404);
  });

  it("405s a non-GET method", async () => {
    const res = await handleCookbook(get("/cookbook", "POST"), envWith({}));
    expect(res.status).toBe(405);
  });
});

describe("handleCookbook search", () => {
  it("renders a GET search form on the index", async () => {
    const env = envWith({ recipeRows: [{ slug: "miso-salmon", title: "Miso Salmon" }] });
    const html = await (await handleCookbook(get("/cookbook"), env)).text();
    expect(html).toContain('name="q"');
    expect(html).toContain('action="/cookbook"');
    expect(html).toMatch(/method="GET"/i);
  });

  it("lists an exact title match ahead of semantic-only neighbours", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "taco-night", title: "Taco Night" },
        { slug: "salsa-bowl", title: "Salsa Bowl" },
      ],
      embeddingRows: [
        { slug: "taco-night", embedding: JSON.stringify(vec({ 1: 1 })) }, // cosine 0 vs query
        { slug: "salsa-bowl", embedding: JSON.stringify(vec({ 0: 1 })) }, // cosine 1 vs query
      ],
      ai: { run: async () => ({ data: [vec({ 0: 1 })] }) }, // query points at salsa-bowl
    });
    const res = await handleCookbook(get("/cookbook?q=taco"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // taco-night via SUBSTRING (title), salsa-bowl via SEMANTIC — substring ordered first.
    expect(html).toContain("/cookbook/taco-night");
    expect(html).toContain("/cookbook/salsa-bowl");
    expect(html.indexOf("/cookbook/taco-night")).toBeLessThan(html.indexOf("/cookbook/salsa-bowl"));
    expect(html.split("/cookbook/taco-night").length - 1).toBe(1); // appears exactly once
  });

  it("returns cosine-ranked results for a vibe query, floored, no-script", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "alpha-stew", title: "Alpha Stew" },
        { slug: "gamma-soup", title: "Gamma Soup" },
        { slug: "beta-salad", title: "Beta Salad" },
      ],
      embeddingRows: [
        { slug: "alpha-stew", embedding: JSON.stringify(vec({ 0: 1 })) }, // cosine 1.0
        { slug: "gamma-soup", embedding: JSON.stringify(vec({ 0: 3, 1: 1 })) }, // ~0.95
        { slug: "beta-salad", embedding: JSON.stringify(vec({ 1: 1 })) }, // cosine 0 → floored out
      ],
      ai: { run: async () => ({ data: [vec({ 0: 1 })] }) },
    });
    const res = await handleCookbook(get("/cookbook?q=cozy"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/cookbook/alpha-stew");
    expect(html).toContain("/cookbook/gamma-soup");
    expect(html).not.toContain("/cookbook/beta-salad"); // below the similarity floor
    expect(html.indexOf("/cookbook/alpha-stew")).toBeLessThan(html.indexOf("/cookbook/gamma-soup"));
    // the open surface stays script-free under the same restrictive CSP
    expect(html).not.toMatch(/<script/i);
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
  });

  it("renders a 200 empty state when nothing matches", async () => {
    const env = envWith({ recipeRows: [{ slug: "miso-salmon", title: "Miso Salmon" }] });
    const res = await handleCookbook(get("/cookbook?q=zzz-no-match"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No recipes match");
    expect(html).toContain("← All recipes");
  });

  it("falls back to substring results when the query embed fails (no 5xx)", async () => {
    const env = envWith({
      recipeRows: [{ slug: "taco-night", title: "Taco Night" }],
      embeddingRows: [{ slug: "taco-night", embedding: JSON.stringify(vec({ 0: 1 })) }],
      ai: {
        run: async () => {
          throw new Error("AI down");
        },
      },
    });
    const res = await handleCookbook(get("/cookbook?q=taco"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/cookbook/taco-night"); // substring tier still renders
  });

  it("finds a not-yet-embedded recipe by title", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "fresh-bread", title: "Fresh Bread" }, // no embedding row yet
        { slug: "old-soup", title: "Old Soup" },
      ],
      embeddingRows: [{ slug: "old-soup", embedding: JSON.stringify(vec({ 0: 1 })) }],
      ai: { run: async () => ({ data: [vec({ 1: 1 })] }) },
    });
    const res = await handleCookbook(get("/cookbook?q=bread"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/cookbook/fresh-bread");
  });

  it("reuses the cached query vector across identical searches (one embed call)", async () => {
    const counter = { n: 0 };
    const env = envWith({
      recipeRows: [{ slug: "alpha-stew", title: "Alpha Stew" }],
      embeddingRows: [{ slug: "alpha-stew", embedding: JSON.stringify(vec({ 0: 1 })) }],
      ai: {
        run: async () => {
          counter.n++;
          return { data: [vec({ 0: 1 })] };
        },
      },
    });
    await handleCookbook(get("/cookbook?q=cozy"), env);
    await handleCookbook(get("/cookbook?q=cozy"), env);
    expect(counter.n).toBe(1); // the second search hit the KV vector cache
  });
});
