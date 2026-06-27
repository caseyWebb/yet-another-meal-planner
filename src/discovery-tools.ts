// Discovery + recipe-creation tools (recipe-discovery capability). UNPROMPTED discovery is
// autonomous now — the background discovery sweep (src/discovery-sweep.ts) polls the feeds +
// the email inbox, classifies/taste-matches/imports, and the agent READS the result via
// list_new_for_me. So the old in-chat pull tools (fetch_rss_discoveries / read_discovery_inbox)
// are retired from this surface. What remains here:
//   - parse_recipe — PARSE-ONLY: fetch a page, return its JSON-LD Recipe data (the MANUAL
//     "import this URL I'm handing you" path — writes nothing).
//   - create_recipe — write a new recipe (available by default) as one R2 object (manual import).
//   - list_new_for_me — the per-member read of the sweep's fresh imports (the discovery surface).
//   - read_discovery_errors — the sweep's parked-candidate surface (mirrors read_reconcile_errors).
//   - reject_discovery — group-wide suppression of a discovery SOURCE so the sweep won't re-import it.
//   - update_feeds / update_discovery_sources — shared discovery-source config.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { CorpusStore } from "./corpus-store.js";
import { ToolError, runTool } from "./errors.js";
import { validateFile } from "./validate.js";
import { seedRecipeDescription } from "./recipe-embeddings.js";
import { fetchWithBrowserHeaders } from "./http.js";
import { extractJsonLd, findRecipe, normalizeRecipe } from "./jsonld.js";
import { buildNewRecipe, canonicalizeUrl, indexSourceToSlug } from "./discovery.js";
import { recipeSourceMap } from "./recipe-index.js";
import { addFeedRows, addSourceRows, addDiscoveryRejection } from "./corpus-db.js";
import { readNewForMe, readDiscoveryErrors } from "./discovery-db.js";

/** Cold-start floor: a never-planned member sees at most this window of recent discoveries. */
const NEW_FOR_ME_WINDOW_DAYS = 21;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Discovery tools (recipe-discovery capability). Discovery is a SHARED, top-level concern:
 * the feeds, the email inbox, and the corpus index live in shared D1 tables, and recipe
 * writes go through the R2 corpus `store` (recipes/<slug>.md). UNPROMPTED discovery is run by
 * the background sweep (not these tools); the agent reads its output via list_new_for_me. The
 * tools here are the MANUAL import path (parse_recipe/create_recipe), the discovery reads
 * (list_new_for_me/read_discovery_errors), source suppression (reject_discovery), and config
 * (update_feeds/update_discovery_sources). Imports dedupe by source URL against the shared
 * corpus so a recipe already present is reused, never duplicated (§6.4).
 */
export function registerDiscoveryTools(
  server: McpServer,
  store: CorpusStore,
  env: Env,
  tenantId: string,
): void {
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
        "Write a NEW recipe to the SHARED corpus, as a single R2 object. Slug derives from the title unless `slug` is given. An imported recipe lands AVAILABLE to every member by default — there is no `status` to set (the per-tenant status lifecycle is retired). The body MUST contain ## Ingredients and ## Instructions. " +
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
        const { slug: finalSlug, file, facets } = await buildNewRecipe(store, env, frontmatter, body, slug);
        // Validate the serialized content before persisting (the commit engine used to do
        // this): a missing/empty required field or an off-vocab value is rejected
        // (validation_failed) and nothing is written.
        validateFile(file.path, file.content);
        await store.put(file.path, file.content);
        // Seed the derived description synchronously so the new recipe reads well before the
        // reconcile's next tick (the reconcile stays the authority + refreshes on facet change).
        // Best-effort: a generation failure must NOT fail the already-persisted import.
        try {
          await seedRecipeDescription(env, finalSlug, facets);
        } catch (e) {
          console.error(`[create_recipe] description seed failed for ${finalSlug} (reconcile will backfill):`, e);
        }
        return { slug: finalSlug };
      }),
  );

  server.registerTool(
    "reject_discovery",
    {
      description:
        "SHARED, group-wide suppression of a discovery SOURCE url: stop it (and its tracker-wrapped variants) from ever being imported by the background discovery sweep for the GROUP. The sweep folds these into its intake dedup, so a rejected url is never re-evaluated or re-imported. Use ONLY when a source is not corpus-worthy for the group — junk, broken, not actually a recipe, a duplicate, or a feed/site producing off-base results. This is collective curation; a member who simply dislikes an already-imported recipe uses toggle_reject (per-tenant), NOT this. Idempotent on the canonical URL; an optional `reason` is recorded for provenance. Does not touch the corpus or anyone's recipe overlay.",
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
        "Add RSS/Atom discovery feeds to the SHARED feed set (the feeds the background discovery sweep polls). Add-only, deduped by url — existing feeds untouched. Each feed needs a url; name, weight (default 1), and tags are optional. Discovery feeds are a shared, group-wide concern, so anyone trusted with this MCP may widen the set (like update_discovery_sources). Returns { added }.",
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

  server.registerTool(
    "list_new_for_me",
    {
      description:
        "Return the recipes the BACKGROUND discovery sweep imported FOR YOU since your last meal plan — already classified and embedded (so they're immediately usable AND retrievable via search_recipes). Each carries { slug, title, description, protein, cuisine, time_total, discovered_at }. Scoped to the caller: recipes the sweep matched to YOUR taste, that you haven't favorited/rejected or cooked, discovered after your last plan (capped at a recent window for a never-planned member). This REPLACES the old fetch_rss_discoveries/read_discovery_inbox pull — discovery is autonomous now; you read the result, you don't triage/parse/import in-flow. Fold these into the menu before the rest of retrieval. An empty list is normal (nothing new since you last planned).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const floor = new Date(Date.now() - NEW_FOR_ME_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
        const recipes = await readNewForMe(env, tenantId, floor);
        return { recipes };
      }),
  );

  server.registerTool(
    "read_discovery_errors",
    {
      description:
        "Read the SHARED discovery-sweep error surface: candidates the background sweep could not classify into a valid recipe after retries, parked for an operator/author to look at (mirrors read_reconcile_errors). Each carries { url, title, source, outcome, slug, detail, created_at } (outcome is 'error'; detail holds the validation failure). An empty list means the sweep is importing cleanly. Read-only; does not retry or import.",
      inputSchema: {},
    },
    () => runTool(async () => ({ errors: await readDiscoveryErrors(env) })),
  );
}
