// Live, read-only smoke test against the real validated feeds + recipe pages.
// SKIPPED by default — runs only with RECIPE_LIVE=1, so the normal suite and CI
// never hit the network. Run with:
//   RECIPE_LIVE=1 npx vitest run test/discovery.live.test.ts
//
// HTMLRewriter doesn't exist in Node, so this test extracts the JSON-LD blocks
// with a small test-local regex and feeds them to the REAL findRecipe +
// normalizeRecipe (the actual risk surface). The Worker's extractJsonLd
// (HTMLRewriter) is exercised by the MCP Inspector smoke test on the deployed
// Worker instead.

import { describe, it, expect } from "vitest";
import { fetchWithBrowserHeaders } from "../src/http.js";
import { parseFeed } from "../src/feeds.js";
import { findRecipe, normalizeRecipe } from "../src/jsonld.js";

const LIVE = process.env.RECIPE_LIVE === "1";

function extractBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // skip unparseable
    }
  }
  return blocks;
}

const FEEDS = [
  { name: "Budget Bytes", url: "https://www.budgetbytes.com/feed/" },
  { name: "RecipeTin Eats", url: "https://www.recipetineats.com/feed/" },
  { name: "The Woks of Life", url: "https://thewoksoflife.com/feed/" },
  { name: "The Kitchn", url: "https://www.thekitchn.com/main.rss" },
  { name: "Bon Appétit", url: "https://www.bonappetit.com/feed/recipes-rss-feed/rss" },
];

describe.skipIf(!LIVE)("live feed + JSON-LD smoke", () => {
  for (const feed of FEEDS) {
    it(
      `${feed.name}: feed parses and at least one recent item normalizes to a recipe`,
      async () => {
        const res = await fetchWithBrowserHeaders(feed.url);
        expect(res.ok).toBe(true);
        const items = parseFeed(await res.text());
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].link).toMatch(/^https?:\/\//);

        // Feeds legitimately carry non-recipe items (articles, listicle galleries),
        // so scan the first several until one yields a normalizable Recipe — the
        // same way the agent picks recipe candidates from the pool and skips the
        // rest on no_jsonld/not_a_recipe.
        let found: string | null = null;
        for (const item of items.slice(0, 6)) {
          const page = await fetchWithBrowserHeaders(item.link);
          if (!page.ok) continue;
          const recipe = findRecipe(extractBlocks(await page.text()));
          if (!recipe) continue;
          const norm = normalizeRecipe(recipe);
          if (!norm.ok) continue;
          expect(norm.recipe.ingredients.length).toBeGreaterThan(0);
          expect(norm.recipe.instructions.length).toBeGreaterThan(0);
          found = `"${norm.recipe.title}" — ${norm.recipe.ingredients.length} ing, ${norm.recipe.instructions.length} steps, total=${norm.recipe.time_total}, serves=${norm.recipe.servings}`;
          break;
        }
        expect(found, `no normalizable recipe in the first 6 items of ${feed.name}`).not.toBeNull();
        // eslint-disable-next-line no-console
        console.log(`${feed.name}: ${found}`);
      },
      45_000,
    );
  }
});
