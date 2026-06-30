import { describe, it, expect } from "vitest";
import { handleCookbook } from "../src/cookbook.js";
import type { Env } from "../src/env.js";
import { fakeR2 } from "./fake-r2.js";

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
 * An env whose DB routes by SQL: `loadRecipeEmbeddings`'s query (`… WHERE embedding IS NOT
 * NULL`) returns `embeddingRows`; every other query (the recipe index) returns `recipeRows`.
 * An optional R2 corpus backs the recipe-body render. `failEmbeddings` makes the embeddings
 * read throw, to exercise the best-effort "omit the Similar Recipes section, still render the
 * body" path.
 */
function envWith(opts: {
  recipeRows?: Record<string, unknown>[];
  embeddingRows?: { slug: string; embedding: string }[];
  files?: Record<string, string>;
  failEmbeddings?: boolean;
}): Env {
  const recipeRows = opts.recipeRows ?? [];
  const embeddingRows = opts.embeddingRows ?? [];
  const makeStmt = (sql: string) => {
    const isEmbeddings = /embedding IS NOT NULL/i.test(sql);
    const stmt = {
      bind: () => stmt,
      all: async () => {
        if (isEmbeddings && opts.failEmbeddings) throw new Error("embeddings unavailable");
        return { results: isEmbeddings ? embeddingRows : recipeRows };
      },
    };
    return stmt;
  };
  return {
    DB: { prepare: (sql: string) => makeStmt(sql) },
    CORPUS: fakeR2(opts.files ?? {}).bucket,
  } as unknown as Env;
}

const get = (path: string, method = "GET") => new Request(`https://groc.example.com${path}`, { method });

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

  it('renders an "Open in Claude" deep link prefilling a cook prompt with the slug', async () => {
    const env = envWith({ files: { "recipes/miso-salmon.md": RECIPE_MD } });
    const html = await (await handleCookbook(get("/cookbook/miso-salmon"), env)).text();
    expect(html).toContain('class="cta"');
    expect(html).toContain("https://claude.ai/new?q=");
    // the prompt is URL-encoded and carries both the title and the slug for the cook skill
    // This title has no `'`/`&`, so encodeURIComponent fully encodes it and the URL appears
    // verbatim. (For titles that DO contain `'` or `&`, the rendered href differs — those
    // chars survive encodeURIComponent and are then HTML-escaped by the load-bearing esc()
    // wrapper in renderRecipe; see the hostile-title test below.)
    const expected = `https://claude.ai/new?q=${encodeURIComponent(
      'Cook "Miso Salmon" with me (cookbook recipe slug: miso-salmon). Walk me through it.',
    )}`;
    expect(html).toContain(expected);
    // it does not break the strict no-script CSP (it's a plain anchor)
    const res = await handleCookbook(get("/cookbook/miso-salmon"), env);
    expect(res.headers.get("content-security-policy")).not.toMatch(/script-src/);
  });

  it("escapes a hostile recipe title in the Open-in-Claude href (no attribute breakout)", async () => {
    // A title carrying the chars encodeURIComponent leaves literal (' and the un-encoded `"`
    // only matters once HTML-escaping is in play): the esc() wrapper around the href is what
    // prevents an attribute breakout on this open, cross-tenant surface.
    const evil = [
      "---",
      'title: Evil" onmouseover="alert(1)',
      "---",
      "",
      "## Ingredients",
      "- x",
      "",
      "## Instructions",
      "1. x",
      "",
    ].join("\n");
    const env = envWith({ files: { "recipes/evil.md": evil } });
    const html = await (await handleCookbook(get("/cookbook/evil"), env)).text();
    const cta = html.slice(html.indexOf('class="cta"'));
    const href = cta.slice(0, cta.indexOf("</a>"));
    // the title's `"` must be encoded/escaped, never a raw quote that breaks out of href="…"
    expect(href).not.toMatch(/onmouseover=/i);
    expect(href).toContain("%22"); // the title's quote arrived percent-encoded in the URL
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
  it("renders a progressively-enhanced search form + script on the index", async () => {
    const env = envWith({ recipeRows: [{ slug: "miso-salmon", title: "Miso Salmon" }] });
    const res = await handleCookbook(get("/cookbook"), env);
    const html = await res.text();
    expect(html).toContain('name="q"');
    expect(html).toContain('id="q"');
    expect(html).toContain('action="/cookbook"');
    expect(html).toMatch(/method="GET"/i);
    expect(html).toContain('id="results"');
    expect(html).toContain('src="/cookbook/search.js"');
    // the index/search page relaxes the CSP to first-party script + fetch (and nothing else)
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).toMatch(/connect-src 'self'/);
    expect(csp).not.toMatch(/unsafe-inline'[^;]*script|script[^;]*unsafe-inline/);
  });

  it("ranks a title match ahead of a description-only match (server-rendered ?q=)", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "bean-soup", title: "Bean Soup" },
        { slug: "green-salad", title: "Green Salad", description: "tossed with bean sprouts" },
      ],
    });
    const res = await handleCookbook(get("/cookbook?q=bean"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/cookbook/bean-soup");
    expect(html).toContain("/cookbook/green-salad");
    expect(html.indexOf("/cookbook/bean-soup")).toBeLessThan(html.indexOf("/cookbook/green-salad"));
  });

  it("surfaces a facet (cuisine) match the title does not mention", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "pad-thai", title: "Rice Noodles", cuisine: "thai" },
        { slug: "carbonara", title: "Carbonara", cuisine: "italian" },
      ],
    });
    const html = await (await handleCookbook(get("/cookbook?q=thai"), env)).text();
    expect(html).toContain("/cookbook/pad-thai");
    expect(html).not.toContain("/cookbook/carbonara");
  });

  it("renders a 200 empty state when nothing matches", async () => {
    const env = envWith({ recipeRows: [{ slug: "miso-salmon", title: "Miso Salmon" }] });
    const res = await handleCookbook(get("/cookbook?q=zzz-no-match"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No recipes match");
    expect(html).toContain("← All recipes");
  });

  it("serves the search endpoint as ranked JSON", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "taco-night", title: "Taco Night" },
        { slug: "sushi", title: "Sushi" },
      ],
    });
    const res = await handleCookbook(get("/cookbook/search?q=taco"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const data = (await res.json()) as { results: { slug: string }[] };
    expect(data.results.map((r) => r.slug)).toEqual(["taco-night"]);
  });

  it("returns an empty JSON list (200) when the endpoint query matches nothing or is empty", async () => {
    const env = envWith({ recipeRows: [{ slug: "sushi", title: "Sushi" }] });
    const miss = (await (await handleCookbook(get("/cookbook/search?q=taco"), env)).json()) as { results: unknown[] };
    const empty = (await (await handleCookbook(get("/cookbook/search?q="), env)).json()) as { results: unknown[] };
    expect(miss.results).toEqual([]);
    expect(empty.results).toEqual([]);
  });

  it("the server ?q= page and the JSON endpoint agree on ordering", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "chicken-tacos", title: "Chicken Tacos" },
        { slug: "chicken-soup", title: "Chicken Soup" },
        { slug: "beef-tacos", title: "Beef Tacos" },
      ],
    });
    const json = (await (await handleCookbook(get("/cookbook/search?q=chicken%20tacos"), env)).json()) as {
      results: { slug: string }[];
    };
    const html = await (await handleCookbook(get("/cookbook?q=chicken%20tacos"), env)).text();
    expect(json.results[0].slug).toBe("chicken-tacos");
    // every endpoint result appears in the SSR page, in the same relative order
    const positions = json.results.map((r) => html.indexOf(`/cookbook/${r.slug}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("serves the client search script with a JS content-type", async () => {
    const res = await handleCookbook(get("/cookbook/search.js"), envWith({}));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(await res.text()).toContain("addEventListener");
  });

  it("keeps the recipe-body page strict no-script", async () => {
    const env = envWith({ files: { "recipes/miso-salmon.md": RECIPE_MD } });
    const res = await handleCookbook(get("/cookbook/miso-salmon"), env);
    const html = await res.text();
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).not.toMatch(/script-src/);
    expect(html).not.toMatch(/<script/i);
  });
});

describe("handleCookbook similar recipes", () => {
  it("renders Similar Recipes from stored embeddings, excluding self and below-floor recipes", async () => {
    const env = envWith({
      files: { "recipes/miso-salmon.md": RECIPE_MD },
      recipeRows: [
        { slug: "miso-salmon", title: "Miso Salmon" },
        { slug: "teriyaki-salmon", title: "Teriyaki Salmon", protein: "fish" },
        { slug: "chocolate-cake", title: "Chocolate Cake" },
      ],
      embeddingRows: [
        { slug: "miso-salmon", embedding: JSON.stringify([1, 0, 0]) },
        { slug: "teriyaki-salmon", embedding: JSON.stringify([0.98, 0.1, 0]) }, // ~0.995 → above floor
        { slug: "chocolate-cake", embedding: JSON.stringify([0, 0, 1]) }, // cosine 0 → below floor
      ],
    });
    const res = await handleCookbook(get("/cookbook/miso-salmon"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Similar Recipes");
    expect(html).toContain("/cookbook/teriyaki-salmon");
    expect(html).not.toContain("/cookbook/chocolate-cake"); // below the similarity floor
    expect(html).not.toContain('href="/cookbook/miso-salmon"'); // the viewed recipe excludes itself
    // The section is static links, so the body page keeps its strict no-script CSP.
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).not.toMatch(/script-src/);
    expect(html).not.toMatch(/<script/i);
  });

  it("omits the section when the viewed recipe has no stored embedding yet", async () => {
    const env = envWith({
      files: { "recipes/miso-salmon.md": RECIPE_MD },
      recipeRows: [
        { slug: "miso-salmon", title: "Miso Salmon" },
        { slug: "teriyaki-salmon", title: "Teriyaki Salmon" },
      ],
      // The viewed recipe is unembedded (just imported); only another recipe has a vector.
      embeddingRows: [{ slug: "teriyaki-salmon", embedding: JSON.stringify([1, 0, 0]) }],
    });
    const html = await (await handleCookbook(get("/cookbook/miso-salmon"), env)).text();
    expect(html).toContain("<h1>Miso Salmon</h1>"); // body still renders
    expect(html).not.toContain("Similar Recipes");
  });

  it("still renders the body (200) when the embeddings read fails — section omitted", async () => {
    const env = envWith({
      files: { "recipes/miso-salmon.md": RECIPE_MD },
      recipeRows: [{ slug: "miso-salmon", title: "Miso Salmon" }],
      failEmbeddings: true,
    });
    const res = await handleCookbook(get("/cookbook/miso-salmon"), env);
    expect(res.status).toBe(200); // best-effort: a failed embeddings read does not 503 the page
    const html = await res.text();
    expect(html).toContain("<h1>Miso Salmon</h1>");
    expect(html).not.toContain("Similar Recipes");
  });

  it("escapes neighbor titles rendered in the section", async () => {
    const env = envWith({
      files: { "recipes/base.md": RECIPE_MD },
      recipeRows: [
        { slug: "base", title: "Base" },
        { slug: "evil", title: "<script>alert(1)</script>Pasta" },
      ],
      embeddingRows: [
        { slug: "base", embedding: JSON.stringify([1, 0]) },
        { slug: "evil", embedding: JSON.stringify([1, 0]) }, // identical vector → cosine 1
      ],
    });
    const html = await (await handleCookbook(get("/cookbook/base"), env)).text();
    expect(html).toContain("/cookbook/evil");
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/); // never injected raw
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;"); // rendered escaped
  });
});
