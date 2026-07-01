import { describe, expect, it, vi } from "vitest";
import { createJsonLdAdapter, extractUrlsFromXml } from "../src/adapters/jsonld.js";
import { validateEmit, type Sdk } from "../src/adapter.js";
import { parsePageToRecipe } from "../src/jsonld.js";
import type { SourceConfig } from "../src/config.js";
import type { FetchResult } from "../src/fetch.js";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://paid.example/recipes/one</loc></url>
  <url><loc>https://paid.example/recipes/two</loc></url>
</urlset>`;

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Paid</title>
  <item><title>A</title><link>https://paid.example/recipes/a</link></item>
  <item><title>B</title><link>https://paid.example/recipes/b</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><link href="https://paid.example/recipes/x" rel="alternate"/></entry>
  <entry><link href="https://paid.example/recipes/y"/></entry>
</feed>`;

const RECIPE_PAGE = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Fixture Stew",
 "recipeIngredient":["1 lb beef","2 carrots"],
 "recipeInstructions":["Brown the beef.","Add carrots and simmer."]}
</script></head><body></body></html>`;

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

/** Build an SDK whose fetch returns canned HTML, for discovery + extract tests. */
function fakeSdk(source: SourceConfig, fetched: FetchResult): Sdk {
  return {
    source,
    config: { connector_url: "https://mcp.example", sources: [source] },
    session: null,
    fetch: vi.fn(() => Promise.resolve(fetched)),
    parsePageToRecipe,
    log: noopLog,
  };
}

describe("extractUrlsFromXml", () => {
  it("parses a sitemap into loc URLs", () => {
    expect(extractUrlsFromXml(SITEMAP)).toEqual([
      "https://paid.example/recipes/one",
      "https://paid.example/recipes/two",
    ]);
  });

  it("parses an RSS feed into item links", () => {
    expect(extractUrlsFromXml(RSS)).toEqual(["https://paid.example/recipes/a", "https://paid.example/recipes/b"]);
  });

  it("parses an Atom feed into entry link hrefs", () => {
    expect(extractUrlsFromXml(ATOM)).toEqual(["https://paid.example/recipes/x", "https://paid.example/recipes/y"]);
  });
});

describe("createJsonLdAdapter", () => {
  const source: SourceConfig = { id: "paid", adapter: "jsonld", sitemap_url: "https://paid.example/sitemap.xml" };

  it("discovers candidate URLs from the source's sitemap", async () => {
    const sdk = fakeSdk(source, { html: SITEMAP, finalUrl: source.sitemap_url!, status: 200 });
    const adapter = createJsonLdAdapter(sdk);
    const urls = await adapter.discover(sdk);
    expect(urls).toEqual(["https://paid.example/recipes/one", "https://paid.example/recipes/two"]);
    expect(sdk.fetch).toHaveBeenCalledWith("https://paid.example/sitemap.xml");
  });

  it("returns [] when the source declares no sitemap/feed", async () => {
    const bare: SourceConfig = { id: "bare", adapter: "jsonld" };
    const sdk = fakeSdk(bare, { html: "", finalUrl: "", status: 200 });
    const adapter = createJsonLdAdapter(sdk);
    expect(await adapter.discover(sdk)).toEqual([]);
  });

  it("extracts a valid RecipeItem from a page with schema.org JSON-LD", () => {
    const sdk = fakeSdk(source, { html: "", finalUrl: "", status: 200 });
    const adapter = createJsonLdAdapter(sdk);
    const out = adapter.extract(sdk, "https://paid.example/recipes/one", RECIPE_PAGE);
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.title).toBe("Fixture Stew");
    expect(out.source).toBe("https://paid.example/recipes/one");
  });

  it("emits a structured error for a page with no recipe data", () => {
    const sdk = fakeSdk(source, { html: "", finalUrl: "", status: 200 });
    const adapter = createJsonLdAdapter(sdk);
    const out = adapter.extract(sdk, "https://paid.example/recipes/none", "<html><body>nope</body></html>");
    expect("error" in out).toBe(true);
  });
});

describe("validateEmit", () => {
  it("passes a valid item through", () => {
    const item = {
      title: "OK",
      ingredients: ["a"],
      instructions: ["b"],
      source: "https://paid.example/r/ok",
    };
    const out = validateEmit(item);
    expect("error" in out).toBe(false);
  });

  it("rejects an item that violates the contract (bad source URL)", () => {
    const bad = { title: "X", ingredients: ["a"], instructions: ["b"], source: "not-a-url" };
    const out = validateEmit(bad as never);
    expect("error" in out).toBe(true);
    if ("error" in out) expect(out.error).toMatch(/invalid item/);
  });

  it("passes an existing structured error through unchanged", () => {
    expect(validateEmit({ error: "no_jsonld" })).toEqual({ error: "no_jsonld" });
  });
});
