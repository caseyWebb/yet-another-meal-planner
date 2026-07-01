import { describe, expect, it } from "vitest";
import { extractJsonLdBlocks, parsePageToRecipe } from "../src/jsonld.js";

// A recipe page carrying a top-level schema.org Recipe JSON-LD block.
const TOP_LEVEL_PAGE = `<!doctype html>
<html><head>
<title>Skillet Cornbread</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Skillet Cornbread",
  "url": "https://paid.example/recipes/skillet-cornbread",
  "recipeYield": "8 servings",
  "totalTime": "PT35M",
  "prepTime": "PT10M",
  "recipeIngredient": ["1 cup cornmeal", "1 cup flour", "2 eggs", "1 cup buttermilk"],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "Heat the skillet in the oven." },
    { "@type": "HowToStep", "text": "Whisk the batter and pour it in." },
    { "@type": "HowToStep", "text": "Bake until golden." }
  ]
}
</script>
</head><body><h1>Skillet Cornbread</h1><p>A cozy headnote we must NOT push.</p></body></html>`;

// A recipe page where the Recipe node is nested inside an @graph array.
const GRAPH_PAGE = `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "name": "Paid Example" },
    {
      "@type": "Recipe",
      "name": "Graph Soup",
      "recipeIngredient": ["2 cups broth", "1 onion"],
      "recipeInstructions": "Simmer the broth with the onion until soft."
    }
  ]
}
</script>
</head><body></body></html>`;

// A page with no JSON-LD at all.
const NO_JSONLD_PAGE = `<html><head><title>Just a blog post</title></head><body><p>No structured data here.</p></body></html>`;

describe("extractJsonLdBlocks", () => {
  it("extracts a top-level JSON-LD block", () => {
    const blocks = extractJsonLdBlocks(TOP_LEVEL_PAGE);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { name: string }).name).toBe("Skillet Cornbread");
  });

  it("returns [] when there is no JSON-LD", () => {
    expect(extractJsonLdBlocks(NO_JSONLD_PAGE)).toEqual([]);
  });

  it("skips an unparseable block without throwing", () => {
    const html = `<script type="application/ld+json">{ not valid json </script>`;
    expect(extractJsonLdBlocks(html)).toEqual([]);
  });
});

describe("parsePageToRecipe", () => {
  it("returns the functional facts for a top-level Recipe", () => {
    const item = parsePageToRecipe(TOP_LEVEL_PAGE, "https://paid.example/recipes/skillet-cornbread");
    expect("error" in item).toBe(false);
    if ("error" in item) return;
    expect(item.title).toBe("Skillet Cornbread");
    expect(item.ingredients).toHaveLength(4);
    expect(item.instructions).toHaveLength(3);
    expect(item.source).toBe("https://paid.example/recipes/skillet-cornbread");
    expect(item.servings).toBe(8);
    expect(item.time_total).toBe(35);
    expect(item.time_active).toBe(10);
    // Prose/photos must never appear on the wire item.
    expect(JSON.stringify(item)).not.toContain("headnote");
  });

  it("finds a Recipe nested inside @graph", () => {
    const item = parsePageToRecipe(GRAPH_PAGE, "https://paid.example/soup");
    expect("error" in item).toBe(false);
    if ("error" in item) return;
    expect(item.title).toBe("Graph Soup");
    expect(item.ingredients).toEqual(["2 cups broth", "1 onion"]);
    expect(item.instructions).toEqual(["Simmer the broth with the onion until soft."]);
    // No JSON-LD `url` on this node → falls back to the page URL.
    expect(item.source).toBe("https://paid.example/soup");
  });

  it("errors when the page has no JSON-LD", () => {
    const item = parsePageToRecipe(NO_JSONLD_PAGE, "https://paid.example/blog");
    expect("error" in item).toBe(true);
    if ("error" in item) expect(item.error).toBe("no_jsonld");
  });
});
