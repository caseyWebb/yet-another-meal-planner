// Discovery + draft-creation tools (recipe-discovery capability):
//   - fetch_rss_discoveries — pull configured feeds, dedup vs corpus, return a
//     candidate POOL (no taste score; the agent judges fit and picks 1–2).
//   - import_recipe — PARSE-ONLY: fetch a page, return its JSON-LD Recipe data.
//     Writes nothing. The agent cleans/classifies, then calls create_recipe.
//   - create_recipe — write a new draft recipe as one solo commit.
//
// fetch_flyer_featured is intentionally NOT here: Kroger has no "featured"
// primitive, so on-sale ready-to-eat discovery rides the existing kroger_flyer
// pre-pass + flyer_terms.toml + agent-side catalog dedup (see AGENT_INSTRUCTIONS).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "./github.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import { fetchWithBrowserHeaders } from "./http.js";
import { parseFeed } from "./feeds.js";
import { extractJsonLd, findRecipe, normalizeRecipe } from "./jsonld.js";
import {
  buildCandidates,
  buildNewRecipe,
  canonicalizeUrl,
  extractRecipeSources,
  type FeedEntry,
} from "./discovery.js";

const MAX_PER_FEED = 8;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function registerDiscoveryTools(server: McpServer, gh: GitHubClient): void {
  server.registerTool(
    "fetch_rss_discoveries",
    {
      description:
        "Pull the feeds in feeds.toml and return a deduped POOL of candidate recipes ({ url, title, source, feed_weight, summary }) — deduped against recipes already in the corpus (by source URL) and canonicalized (tracking query strings stripped). No taste score: YOU judge taste fit against taste.md and pick the 1–2 worth importing, then import_recipe + create_recipe each. Empty/absent feeds.toml returns an empty pool. Unreachable feeds are skipped (reported in `skipped`), not fatal.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const feedsText = await readOptional(gh, "feeds.toml");
        if (!feedsText) return { candidates: [] };
        const parsed = parseToml(feedsText, "feeds.toml");
        const feeds = Array.isArray(parsed.feeds) ? (parsed.feeds as Record<string, unknown>[]) : [];
        if (feeds.length === 0) return { candidates: [] };

        const seen = extractRecipeSources(await readOptional(gh, "_indexes/recipes.json"));

        const entries: FeedEntry[] = [];
        const skipped: { feed: string; reason: string }[] = [];
        for (const f of feeds) {
          const url = typeof f.url === "string" ? f.url : null;
          if (!url) continue;
          const feedName = typeof f.name === "string" ? f.name : url;
          const feedWeight = typeof f.weight === "number" ? f.weight : 1;
          try {
            const res = await fetchWithBrowserHeaders(url);
            if (!res.ok) {
              skipped.push({ feed: feedName, reason: `HTTP ${res.status}` });
              continue;
            }
            const items = parseFeed(await res.text()).slice(0, MAX_PER_FEED);
            for (const item of items) entries.push({ item, feedName, feedWeight });
          } catch (e) {
            skipped.push({ feed: feedName, reason: errMessage(e) });
          }
        }

        const candidates = buildCandidates(entries, seen);
        return skipped.length ? { candidates, skipped } : { candidates };
      }),
  );

  server.registerTool(
    "import_recipe",
    {
      description:
        "PARSE-ONLY: fetch a recipe page and return its schema.org JSON-LD as structured data ({ title, ingredients[], instructions[], servings, time_total, time_active, source }). Writes nothing and commits nothing — clean up / classify the data, assemble the markdown body (with ## Ingredients and ## Instructions), then call create_recipe. Structured errors: unreachable (couldn't fetch), no_jsonld (no JSON-LD on page), not_a_recipe (JSON-LD but no Recipe), incomplete (Recipe missing ingredients/instructions). Bot-walled/paywalled sites (e.g. Serious Eats, NYT) return unreachable — paste the recipe instead.",
      inputSchema: { url: z.string() },
    },
    ({ url }) =>
      runTool(async () => {
        let res: Response;
        try {
          res = await fetchWithBrowserHeaders(url);
        } catch (e) {
          throw new ToolError("unreachable", `Could not fetch ${url}: ${errMessage(e)}`, { url });
        }
        if (!res.ok) {
          throw new ToolError("unreachable", `Fetching ${url} returned HTTP ${res.status}`, {
            url,
            status: res.status,
          });
        }

        const blocks = await extractJsonLd(res);
        if (blocks.length === 0) {
          throw new ToolError("no_jsonld", `No JSON-LD found at ${url}`, { url });
        }
        const recipe = findRecipe(blocks);
        if (!recipe) {
          throw new ToolError("not_a_recipe", `JSON-LD present but no schema.org Recipe at ${url}`, {
            url,
          });
        }
        const norm = normalizeRecipe(recipe);
        if (!norm.ok) {
          throw new ToolError("incomplete", `Recipe at ${url} is missing ${norm.missing.join(" and ")}`, {
            url,
            missing: norm.missing,
          });
        }

        return { ...norm.recipe, source: norm.recipe.source ?? canonicalizeUrl(url) };
      }),
  );

  server.registerTool(
    "create_recipe",
    {
      description:
        "Write a NEW recipe markdown file (recipes/<slug>.md) from agent-assembled frontmatter + body, as one solo commit. Slug derives from the title unless `slug` is given. Discovery imports: pass status 'draft' with discovered_at + discovery_source (status defaults to 'draft' if omitted). The body MUST contain ## Ingredients and ## Instructions. Refuses to overwrite an existing recipe (slug_exists).",
      inputSchema: {
        frontmatter: z.record(z.string(), z.unknown()),
        body: z.string(),
        slug: z.string().optional(),
      },
    },
    ({ frontmatter, body, slug }) =>
      runTool(async () => {
        const { slug: finalSlug, file } = await buildNewRecipe(gh, frontmatter, body, slug);
        const { commit_sha } = await commitFiles(gh, [file], `add draft recipe ${finalSlug}`);
        return { slug: finalSlug, commit_sha };
      }),
  );
}
