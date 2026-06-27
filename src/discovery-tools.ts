// Discovery + recipe-creation tools (recipe-discovery capability):
//   - fetch_rss_discoveries — pull configured feeds, dedup vs corpus, return a
//     candidate POOL (no taste score; the agent judges fit and picks 1–2).
//   - parse_recipe — PARSE-ONLY: fetch a page, return its JSON-LD Recipe data.
//     Writes nothing. The agent cleans/classifies, then calls create_recipe.
//   - create_recipe — write a new recipe (available by default) as one solo commit.
//
// fetch_flyer_featured is intentionally NOT here: Kroger has no "featured"
// primitive, so on-sale ready-to-eat discovery rides the existing kroger_flyer
// pre-pass + the D1 `flyer_terms` table + agent-side catalog dedup (see AGENT_INSTRUCTIONS).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { GitHubClient } from "./github.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import { seedRecipeDescription } from "./recipe-embeddings.js";
import { fetchWithBrowserHeaders } from "./http.js";
import { parseFeed } from "./feeds.js";
import { extractJsonLd, findRecipe, normalizeRecipe } from "./jsonld.js";
import {
  buildCandidates,
  buildNewRecipe,
  canonicalizeUrl,
  extractRecipeSources,
  indexSourceToSlug,
  type FeedEntry,
} from "./discovery.js";
import { recipeSourceMap } from "./recipe-index.js";
import {
  readFeeds,
  addFeedRows,
  addSourceRows,
  readDiscoveryInbox,
  readDiscoveryRejections,
  addDiscoveryRejection,
} from "./corpus-db.js";

const MAX_PER_FEED = 8;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Discovery tools (recipe-discovery capability). Discovery is a SHARED, top-level
 * concern: the feeds, the email discoveries inbox, and the corpus index live in
 * shared D1 tables, while recipe (draft) writes go through `sharedGh` (the data-repo
 * root) — any member's configured feeds feed one group pool, and the candidates are
 * judged against the caller's taste at menu time. Imports dedupe by source URL against the shared corpus so a recipe
 * already present is reused, never duplicated (§6.4).
 */
export function registerDiscoveryTools(
  server: McpServer,
  sharedGh: GitHubClient,
  env: Env,
  tenantId: string,
): void {
  server.registerTool(
    "fetch_rss_discoveries",
    {
      description:
        "Pull the SHARED, group-wide discovery feeds (the shared D1 feeds table) and return a deduped POOL of candidate recipes ({ url, title, source, feed_weight, summary }) — deduped against recipes already in the corpus (by source URL) and canonicalized (tracking query strings stripped). No taste score: YOU judge taste fit against the user's taste profile (from read_user_profile().taste) and pick the 1–2 worth importing, then parse_recipe + create_recipe each. No configured feeds returns an empty pool. Unreachable feeds are skipped (reported in `skipped`), not fatal.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const feeds = await readFeeds(env);
        if (feeds.length === 0) return { candidates: [] };

        // Dedup against BOTH the corpus (already-imported) and the group's rejected
        // URLs, so a suppressed discovery never reappears in the pool.
        const [sourceMap, rejected] = await Promise.all([
          recipeSourceMap(env),
          readDiscoveryRejections(env),
        ]);
        const seen = extractRecipeSources(sourceMap);
        for (const url of rejected) seen.add(url);

        // Fetch all feeds concurrently (distinct external domains, no shared-host burst concern).
        const results = await Promise.all(
          feeds.map(async (f) => {
            const url = f.url;
            if (!url) return null;
            const feedName = f.name ?? url;
            const feedWeight = f.weight ?? 1;
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
        const existingSlug = indexSourceToSlug(await recipeSourceMap(env)).get(
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
        "Write a NEW recipe to the SHARED corpus, as one solo commit. Slug derives from the title unless `slug` is given. An imported recipe lands AVAILABLE to every member by default — there is no `status` to set (the per-tenant status lifecycle is retired). The body MUST contain ## Ingredients and ## Instructions. " +
          "EVERY system-consumed field is REQUIRED and must be PRESENT (the recipe is rejected with validation_failed otherwise) — use the explicit empty form where a value is genuinely empty. Required, non-empty: `title`; `ingredients_key` (the defining 5–7 ingredients); `course` (e.g. [main], [side], [main, side]). Required, value OR explicit `null` (never omit, never 'none'): `protein` (coarse bucket: chicken | beef | pork | lamb | turkey | fish | shellfish | egg | tofu | vegetarian | vegan | mixed — map specifics: shrimp→shellfish, salmon/cod/tuna→fish; `null` when there is no protein focus), `cuisine` (american | brazilian | cajun | caribbean | chinese | cuban | filipino | french | german | greek | indian | italian | japanese | korean | mediterranean | mexican | moroccan | peruvian | southwestern | spanish | thai | vietnamese; `null` if cuisine-agnostic), `time_total` (minutes or `null`), `source` (the URL or `null` if hand-entered; set discovered_at + discovery_source for discovery imports). Required, may be `[]`: `dietary`, `season` (controlled vocab: spring | summer | fall | winter — `[]` for year-round; an off-vocab value, incl. `autumn` or capitalized, is rejected), `tags`, `pairs_with`, `perishable_ingredients` (names that would spoil before use — the \"would the leftover rot\" test; skip fuzzy edges like eggs/potatoes), `requires_equipment` (ONLY truly-irreplaceable gear: pressure-cooker | sous-vide-circulator | blender | ice-cream-maker — a wrong tag silently hides a makeable recipe; an off-vocab slug is rejected). `side_search_terms` is REQUIRED: non-empty for a MAIN (phrases for the kind of side that completes it, e.g. [\"a bright acidic salad\", \"crusty bread for the sauce\"]), `[]` for non-mains. Other free-form fields pass through untouched. An off-vocabulary `protein`/`cuisine`/`season`/`requires_equipment` value, a `\"none\"` protein, or any missing/empty required field is rejected (validation_failed). Refuses to overwrite an existing slug (slug_exists), and refuses to duplicate a recipe whose `source` URL is already in the corpus (already_exists, with the existing slug — reuse it). The `description` is generated automatically from the recipe's facets (it is no longer authored) — any `description` you supply is ignored.",
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
          const existing = indexSourceToSlug(await recipeSourceMap(env)).get(
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
        const { slug: finalSlug, file, facets } = await buildNewRecipe(sharedGh, env, frontmatter, body, slug);
        const { commit_sha } = await commitFiles(sharedGh, [file], `add recipe ${finalSlug}`);
        // Seed the derived description synchronously so the new recipe reads well before the
        // reconcile's next tick (the reconcile stays the authority + refreshes on facet change).
        // Best-effort: a generation failure must NOT fail the already-committed import.
        try {
          await seedRecipeDescription(env, finalSlug, facets);
        } catch (e) {
          console.error(`[create_recipe] description seed failed for ${finalSlug} (reconcile will backfill):`, e);
        }
        return { slug: finalSlug, commit_sha };
      }),
  );

  server.registerTool(
    "read_discovery_inbox",
    {
      description:
        "Read the SHARED email discoveries inbox and return a list of forwarded newsletter emails ({ from, subject, received_at, body }). Each `body` is the full plain-text content of the email — YOU scan it for recipe titles and links, then call parse_recipe(url) on the promising ones. No pre-extraction: the LLM reads the body and decides what's worth importing. Surface these alongside fetch_rss_discoveries at menu time (1–2 at most, never dominating). Walled/paywalled sources can't be auto-fetched: present the link and have the user paste the recipe text, then create_recipe. An absent or empty inbox returns an empty list.",
      inputSchema: {},
    },
    () => runTool(async () => ({ emails: await readDiscoveryInbox(env) })),
  );

  server.registerTool(
    "reject_discovery",
    {
      description:
        "SHARED, group-wide suppression of a discovery URL: stop it (and its tracker-wrapped variants) from ever resurfacing in fetch_rss_discoveries or read_discovery_inbox for ANYONE. Use ONLY when a candidate is not corpus-worthy for the GROUP — junk, broken, not actually a recipe, a duplicate, or clearly off-base. This is collective curation, deliberately asymmetric with a personal rating: a 'not for me this time' is a no-action skip (just don't import it), NEVER a reject. Idempotent on the canonical URL; an optional `reason` is recorded for provenance. Does not touch the corpus or anyone's recipe overlay.",
      inputSchema: { url: z.string(), reason: z.string().optional() },
    },
    ({ url, reason }) =>
      runTool(async () => {
        const canonical = canonicalizeUrl(url);
        await addDiscoveryRejection(env, {
          url: canonical,
          reason: reason ?? null,
          rejectedBy: tenantId,
          rejectedAt: new Date().toISOString().slice(0, 10),
        });
        return { url: canonical, rejected: true };
      }),
  );

  server.registerTool(
    "update_discovery_sources",
    {
      description:
        "Add trusted sources to the SHARED inbound-newsletter allowlist. `members` = friend-group personal addresses (anything they forward to groceries-agent@ gets indexed) — address only, no label. `senders` = newsletter From addresses (auto-forwarded mail from them gets indexed), with an optional `name` for the NEWSLETTER (e.g. \"Serious Eats\") — never a person's name. Use when a member sets up a forward or wants a newsletter indexed. Dedups by address — existing entries are untouched. Anyone trusted with this MCP is trusted to widen intake.",
      inputSchema: {
        members: z.array(z.object({ address: z.string() })).optional(),
        senders: z.array(z.object({ address: z.string(), name: z.string().optional() })).optional(),
      },
    },
    ({ members, senders }) =>
      runTool(async () => {
        const added = await addSourceRows(env, { members, senders });
        return { added };
      }),
  );

  server.registerTool(
    "update_feeds",
    {
      description:
        "Add RSS/Atom discovery feeds to the SHARED feed set (the pool fetch_rss_discoveries reads). Add-only, deduped by url — existing feeds untouched. Each feed needs a url; name, weight (default 1), and tags are optional. Discovery feeds are a shared, group-wide concern, so anyone trusted with this MCP may widen the set (like update_discovery_sources). Returns { added }.",
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
        const added = await addFeedRows(env, feeds);
        return { added };
      }),
  );
}
