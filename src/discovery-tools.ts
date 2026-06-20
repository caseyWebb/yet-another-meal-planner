// Discovery + draft-creation tools (recipe-discovery capability):
//   - fetch_rss_discoveries — pull configured feeds, dedup vs corpus, return a
//     candidate POOL (no taste score; the agent judges fit and picks 1–2).
//   - parse_recipe — PARSE-ONLY: fetch a page, return its JSON-LD Recipe data.
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
import { parseFeed, addFeeds, FEEDS_PATH } from "./feeds.js";
import { extractJsonLd, findRecipe, normalizeRecipe } from "./jsonld.js";
import {
  buildCandidates,
  buildNewRecipe,
  canonicalizeUrl,
  extractRecipeSources,
  flattenInbox,
  indexSourceToSlug,
  type FeedEntry,
} from "./discovery.js";
import { addSources, INBOX_PATH, SOURCES_PATH } from "./email.js";

const MAX_PER_FEED = 8;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Discovery tools (recipe-discovery capability). Discovery is a SHARED, top-level
 * concern: feeds, the email discoveries inbox, the corpus index, and draft writes
 * all go through `sharedGh` (the data-repo root) — any member's configured feeds
 * feed one group pool, and the candidates are judged against the caller's taste at
 * menu time. Imports dedupe by source URL against the shared corpus so a recipe
 * already present is reused, never duplicated (§6.4).
 */
export function registerDiscoveryTools(
  server: McpServer,
  sharedGh: GitHubClient,
  dataKv: KVNamespace,
): void {
  server.registerTool(
    "fetch_rss_discoveries",
    {
      description:
        "Pull the SHARED, group-wide discovery feeds (root feeds.toml) and return a deduped POOL of candidate recipes ({ url, title, source, feed_weight, summary }) — deduped against recipes already in the corpus (by source URL) and canonicalized (tracking query strings stripped). No taste score: YOU judge taste fit against the user's taste profile (read_taste) and pick the 1–2 worth importing, then parse_recipe + create_recipe each. No configured feeds returns an empty pool. Unreachable feeds are skipped (reported in `skipped`), not fatal.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const feedsText = await readOptional(sharedGh, "feeds.toml");
        if (!feedsText) return { candidates: [] };
        const parsed = parseToml(feedsText, "feeds.toml");
        const feeds = Array.isArray(parsed.feeds) ? (parsed.feeds as Record<string, unknown>[]) : [];
        if (feeds.length === 0) return { candidates: [] };

        const seen = extractRecipeSources(await dataKv.get("index:recipes"));

        // Fetch all feeds concurrently (distinct external domains, no shared-host burst concern).
        const results = await Promise.all(
          feeds.map(async (f) => {
            const url = typeof f.url === "string" ? f.url : null;
            if (!url) return null;
            const feedName = typeof f.name === "string" ? f.name : url;
            const feedWeight = typeof f.weight === "number" ? f.weight : 1;
            try {
              const res = await fetchWithBrowserHeaders(url);
              if (!res.ok) return { skip: { feed: feedName, reason: `HTTP ${res.status}` } };
              const items = parseFeed(await res.text()).slice(0, MAX_PER_FEED);
              return { entries: items.map((item) => ({ item, feedName, feedWeight })) };
            } catch (e) {
              return { skip: { feed: feedName, reason: errMessage(e) } };
            }
          }),
        );

        const entries: FeedEntry[] = [];
        const skipped: { feed: string; reason: string }[] = [];
        for (const r of results) {
          if (!r) continue;
          if ("skip" in r) skipped.push(r.skip!);
          else entries.push(...r.entries);
        }

        const candidates = buildCandidates(entries, seen);
        return skipped.length ? { candidates, skipped } : { candidates };
      }),
  );

  server.registerTool(
    "parse_recipe",
    {
      description:
        "Parse a recipe page: fetch it and return its schema.org JSON-LD as structured data ({ title, ingredients[], instructions[], servings, time_total, time_active, source, tools_hint? }). Reads only — writes nothing and commits nothing. Clean up / classify the data, assemble the markdown body (with ## Ingredients and ## Instructions), then call create_recipe to persist it. `tools_hint` (present only when the page lists a schema.org `tool`) is a NON-AUTHORITATIVE hint for classifying `requires_equipment` — it lists every utensil, so default to [] and tag only truly-irreplaceable gear; never copy tools_hint into requires_equipment. If the source URL is already in the shared corpus, the result carries `existing_slug` — reuse that recipe instead of re-creating it (it's shared, you can rate/note it). Structured errors: unreachable (couldn't fetch), no_jsonld (no JSON-LD on page), not_a_recipe (JSON-LD but no Recipe), incomplete (Recipe missing ingredients/instructions). Bot-walled/paywalled sites (e.g. Serious Eats, NYT) return unreachable — paste the recipe instead.",
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

        const source = norm.recipe.source ?? canonicalizeUrl(url);
        // Idempotency (§6.4): if this source is already in the shared corpus, tell
        // the agent which slug to reuse rather than minting a duplicate.
        const existingSlug = indexSourceToSlug(await dataKv.get("index:recipes")).get(
          canonicalizeUrl(source),
        );
        return existingSlug
          ? { ...norm.recipe, source, existing_slug: existingSlug }
          : { ...norm.recipe, source };
      }),
  );

  server.registerTool(
    "create_recipe",
    {
      description:
        "Write a NEW recipe to the SHARED corpus, as one solo commit. Slug derives from the title unless `slug` is given. Discovery imports: pass status 'draft' with discovered_at + discovery_source (status defaults to 'draft' if omitted). The body MUST contain ## Ingredients and ## Instructions. `protein` and `cuisine` are coarse CONTROLLED buckets — protein one of: chicken | beef | pork | lamb | turkey | fish | shellfish | egg | tofu | vegetarian | vegan | mixed (map specifics to the bucket: shrimp→shellfish, salmon/cod/tuna→fish); cuisine one of: american | brazilian | cajun | caribbean | chinese | cuban | filipino | french | german | greek | indian | italian | japanese | korean | mediterranean | mexican | moroccan | peruvian | southwestern | spanish | thai | vietnamese. OMIT `protein` entirely for a dish with no protein focus (a side, a plain noodle/grain dish, a condiment) — never write 'none'. An off-vocabulary `protein`/`cuisine` value is rejected (validation_failed). Classify `requires_equipment` conservatively: default [] (the common case) and include a vocab slug (pressure-cooker | sous-vide-circulator | blender | ice-cream-maker) ONLY when the dish is genuinely impossible without it — a wrong tag silently hides a makeable recipe, and an off-vocab slug is rejected. `perishable_ingredients` lists the ingredient names that would spoil before use (the \"would the leftover rot\" test) — fuzzy edges (eggs, potatoes, hardy roots) are fine to skip; default []. Refuses to overwrite an existing slug (slug_exists), and refuses to duplicate a recipe whose `source` URL is already in the corpus (already_exists, with the existing slug — reuse it).",
      inputSchema: {
        frontmatter: z.record(z.string(), z.unknown()),
        body: z.string(),
        slug: z.string().optional(),
      },
    },
    ({ frontmatter, body, slug }) =>
      runTool(async () => {
        // Idempotency (§6.4): a recipe is shared and single-source. If this
        // `source` already resolves to a corpus recipe, refuse the duplicate and
        // point the agent at the existing slug to reuse.
        const source = typeof frontmatter.source === "string" ? frontmatter.source : null;
        if (source) {
          const existing = indexSourceToSlug(await dataKv.get("index:recipes")).get(
            canonicalizeUrl(source),
          );
          if (existing) {
            throw new ToolError(
              "already_exists",
              `A recipe for ${source} already exists (slug: ${existing}) — reuse it`,
              { slug: existing, source },
            );
          }
        }
        const { slug: finalSlug, file } = await buildNewRecipe(sharedGh, frontmatter, body, slug);
        const { commit_sha } = await commitFiles(sharedGh, [file], `add draft recipe ${finalSlug}`);
        return { slug: finalSlug, commit_sha };
      }),
  );

  server.registerTool(
    "read_discovery_inbox",
    {
      description:
        "Read the SHARED email discoveries inbox (root discoveries_inbox.toml) and return a list of forwarded newsletter emails ({ from, subject, received_at, body }). Each `body` is the full plain-text content of the email — YOU scan it for recipe titles and links, then call parse_recipe(url) on the promising ones. No pre-extraction: the LLM reads the body and decides what's worth importing. Surface these alongside fetch_rss_discoveries at menu time (1–2 at most, never dominating). Walled/paywalled sources can't be auto-fetched: present the link and have the user paste the recipe text, then create_recipe. An absent or empty inbox returns an empty list.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const inboxText = await readOptional(sharedGh, INBOX_PATH);
        return { emails: flattenInbox(inboxText) };
      }),
  );

  server.registerTool(
    "update_discovery_sources",
    {
      description:
        "Add trusted sources to the SHARED inbound-newsletter allowlist (root discovery_sources.toml). `members` = friend-group personal addresses (anything they forward to groceries-agent@ gets indexed) — address only, no label. `senders` = newsletter From addresses (auto-forwarded mail from them gets indexed), with an optional `name` for the NEWSLETTER (e.g. \"Serious Eats\") — never a person's name. Use when a member sets up a forward or wants a newsletter indexed. Dedups by address — existing entries are untouched. Anyone trusted with this MCP is trusted to widen intake.",
      inputSchema: {
        members: z.array(z.object({ address: z.string() })).optional(),
        senders: z.array(z.object({ address: z.string(), name: z.string().optional() })).optional(),
      },
    },
    ({ members, senders }) =>
      runTool(async () => {
        const existing = await readOptional(sharedGh, SOURCES_PATH);
        const { text, added } = addSources(existing, { members, senders });
        if (added.members === 0 && added.senders === 0) return { added, commit_sha: null };
        const { commit_sha } = await commitFiles(
          sharedGh,
          [{ path: SOURCES_PATH, content: text }],
          `discovery: add ${added.members} member(s), ${added.senders} sender(s)`,
        );
        return { added, commit_sha };
      }),
  );

  server.registerTool(
    "update_feeds",
    {
      description:
        "Add RSS/Atom discovery feeds to the SHARED feeds.toml at the data-repo root (the pool fetch_rss_discoveries reads). Add-only, deduped by canonicalized url — existing feeds untouched. Each feed needs a url; name, weight (default 1), and tags are optional. Discovery feeds are a shared, group-wide concern, so anyone trusted with this MCP may widen the set (like update_discovery_sources). Returns { added, commit_sha }; makes no commit when no new feed is added.",
      inputSchema: {
        feeds: z.array(
          z.object({
            url: z.string(),
            name: z.string().optional(),
            weight: z.number().optional(),
            tags: z.array(z.string()).optional(),
          }),
        ),
      },
    },
    ({ feeds }) =>
      runTool(async () => {
        const existing = await readOptional(sharedGh, FEEDS_PATH);
        const { text, added } = addFeeds(existing, feeds);
        if (added === 0) return { added, commit_sha: null };
        const { commit_sha } = await commitFiles(
          sharedGh,
          [{ path: FEEDS_PATH, content: text }],
          `discovery: add ${added} feed(s)`,
        );
        return { added, commit_sha };
      }),
  );
}
