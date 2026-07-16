// Discovery + recipe-import tools (recipe-discovery / recipe-import capability). UNPROMPTED
// discovery is autonomous — the background discovery sweep (src/discovery-sweep.ts) polls the
// feeds + the email inbox, classifies/taste-matches/imports, and the agent READS the result via
// list_new_for_me. What remains here:
//   - import_recipe — the MANUAL "bring this recipe in" path: exactly one of a URL (egress-
//     guarded fetch + JSON-LD extraction) or pasted text (env.AI classification, no fetch),
//     both converging on the shared create path (buildNewRecipe + validateFile), in one call.
//   - list_new_for_me — the per-member read of the sweep's fresh imports (the discovery surface).
// Source suppression (admin Discovery), the feed/allowlist config (admin Config/Discovery), and
// the parked-candidate error surface (admin Discovery area) are operator admin surfaces now —
// there are no reject_discovery / update_feeds / update_discovery_sources / read_discovery_errors
// MCP tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import type { CorpusStore } from "./corpus-store.js";
import { ToolError, runTool } from "./errors.js";
import { recordImportGrant } from "./visibility.js";
import { validateFile } from "./validate.js";
import { seedRecipeDescription } from "./recipe-embeddings.js";
import { seedClassifiedFacets } from "./recipe-classify.js";
import { stampTitleAudit } from "./title-audit.js";
import { acquireRecipeContent } from "./recipe-acquire.js";
import { classifyRecipe, CLASSIFY_MAX_RETRIES, DERIVED_FACET_FIELDS, type ClassifyConditioning } from "./discovery-classify.js";
import { facetsFromFrontmatter } from "./description.js";
import { buildNewRecipe, canonicalizeUrl, indexSourceToSlug, renderContent, assembleBody } from "./discovery.js";
import { recipeSourceMap } from "./recipe-index.js";
import { readNewForMe } from "./discovery-db.js";

/** Cold-start floor: a never-planned member sees at most this window of recent discoveries.
 *  Exported: the member API's new-for-me endpoint computes the SAME floor. */
export const NEW_FOR_ME_WINDOW_DAYS = 21;

/** Best-effort heading normalization for a pasted recipe (import_recipe's text path): a
 *  standalone "Ingredients"/"Instructions" (or "Directions"/"Method"/"Steps"/"Preparation")
 *  line, optionally colon-suffixed, becomes the canonical H2 marker `buildNewRecipe`
 *  requires. Anything it can't recognize is left as-is, so a paste with no discernible
 *  ingredients/instructions split fails `buildNewRecipe`'s own body-shape guard — the
 *  structured `validation_failed` the recipe-import spec promises for unclassifiable
 *  text — rather than silently mangling the member's content. */
function normalizeHeadings(text: string): string {
  return text
    .replace(/^[ \t]*ingredients[ \t]*:?[ \t]*$/im, "## Ingredients")
    .replace(/^[ \t]*(instructions|directions|method|steps|preparation)[ \t]*:?[ \t]*$/im, "## Instructions");
}

/**
 * Discovery tools (recipe-discovery / recipe-import capability). Discovery is a SHARED,
 * top-level concern: the feeds, the email inbox, and the corpus index live in shared D1
 * tables, and recipe writes go through the R2 corpus `store` (recipes/<slug>.md). UNPROMPTED
 * discovery is run by the background sweep (not these tools); the agent reads its output via
 * list_new_for_me. The only write tool here is import_recipe (recipe-import) — the manual,
 * member-initiated pipeline (url-fetch-and-parse, or paste-and-classify) fused with the
 * shared create operation. Imports dedupe by source URL against the shared corpus so a
 * recipe already present is reused, never duplicated (§6.4, now returned as a SUCCESS —
 * `{ slug, already_existed: true }` — not an error).
 */
export function registerDiscoveryTools(
  server: McpServer,
  store: CorpusStore,
  env: Env,
  tenant: Tenant,
): void {
  const tenantId = tenant.id;

  /**
   * The shared create tail (recipe-import D5): strip the DERIVED facets from the
   * authored file (they live in `recipe_facets`, not R2 — never freeze a one-time
   * classification as a permanent override), persist via the shared `buildNewRecipe` +
   * `validateFile` path (slug from the cleaned title, `slug_exists` refusal), record the
   * caller's attribution, and best-effort seed the title-audit stamp + description +
   * derived facets (via `seedClassifiedFacets` — the frontmatter is ALREADY classified,
   * so this does not re-classify, mirroring the discovery sweep's import path).
   */
  async function persistImportedRecipe(
    frontmatter: Record<string, unknown>,
    body: string,
  ): Promise<{ slug: string }> {
    const today = new Date().toISOString().slice(0, 10);
    const descFacets = facetsFromFrontmatter(frontmatter);
    const fm: Record<string, unknown> = { ...frontmatter };
    for (const k of DERIVED_FACET_FIELDS) delete fm[k];

    const { slug, file } = await buildNewRecipe(store, env, fm, body);
    validateFile(file.path, file.content);
    await store.put(file.path, file.content);

    await recordImportGrant(env, {
      recipe: slug,
      tenant: tenant.id,
      member: tenant.member,
      via: "agent",
      importedAt: today,
    });

    try {
      const fmTitle = typeof fm.title === "string" ? fm.title : null;
      await stampTitleAudit(env, { slug, outcome: "kept", before: fmTitle }, Date.now());
    } catch (e) {
      console.error(`[import_recipe] title-audit born-stamp failed for ${slug}:`, e);
    }
    try {
      await seedRecipeDescription(env, slug, descFacets);
    } catch (e) {
      console.error(`[import_recipe] description seed failed for ${slug} (reconcile will backfill):`, e);
    }
    try {
      await seedClassifiedFacets(env, slug, frontmatter, body);
    } catch (e) {
      console.error(`[import_recipe] facet seed failed for ${slug} (classify pass will backfill):`, e);
    }

    return { slug };
  }

  server.registerTool(
    "import_recipe",
    {
      description:
        "Bring a recipe into the shared corpus in ONE call — takes EXACTLY ONE of `url` or `text`, plus an optional `title` hint, and returns the landed slug. No frontmatter is supplied by you: the tool classifies and persists it internally. " +
        "URL path: fetches the page and extracts its schema.org JSON-LD (handles @graph, arrays, HowToStep/HowToSection instructions). Structured errors on failure (nothing written): `unreachable` (fetch failed, or an outbound-guard refusal — bot-walled/paywalled sites like Serious Eats or NYT land here; paste the recipe as `text` instead), `no_jsonld`, `not_a_recipe`, `incomplete`. " +
        "Text path: classifies the pasted content directly (env.AI, with a corrective retry) into contract-valid frontmatter and body — no page fetch; use it for a recipe pasted from a bot-walled site or dictated by the member. Genuinely unclassifiable text (no discernible ingredients/instructions) returns a structured validation_failed and writes nothing. " +
        "Both paths populate every required authored field themselves (title, source, time_total, dietary, requires_equipment, pairs_with) and seed the derived facets/description synchronously, so the recipe is immediately findable via search_recipes. " +
        "A duplicate `source` URL is DEDUP-TO-GRANT: no second copy is written — the recipe is already in the shared corpus, your household's grant is minted (idempotent), and this is a SUCCESS: `{ slug, already_existed: true }` naming the recipe to reuse. A fresh import returns `{ slug }`. Recipe EDITING is not this tool's job — the member web app owns member edits.",
      inputSchema: {
        url: z.string().optional(),
        text: z.string().optional(),
        title: z.string().optional(),
      },
    },
    ({ url, text, title }) =>
      runTool(async () => {
        const hasUrl = typeof url === "string" && url.trim().length > 0;
        const hasText = typeof text === "string" && text.trim().length > 0;
        if (hasUrl === hasText) {
          throw new ToolError("validation_failed", "import_recipe takes exactly one of `url` or `text`");
        }

        if (hasUrl) {
          // Dedup-to-grant (recipe-import): resolved once against the raw input URL
          // BEFORE any fetch — the common case (re-pasting a URL already in the
          // corpus) never fetches or classifies at all. A duplicate source is a
          // SUCCESS, not an error — mint the caller household's grant idempotently
          // and return the existing slug.
          const sourceMap = indexSourceToSlug(await recipeSourceMap(env));
          const grantExisting = async (existingSlug: string) => {
            await recordImportGrant(env, {
              recipe: existingSlug,
              tenant: tenant.id,
              member: tenant.member,
              via: "agent",
              importedAt: new Date().toISOString().slice(0, 10),
            });
            return { slug: existingSlug, already_existed: true as const };
          };
          const preFetchSlug = sourceMap.get(canonicalizeUrl(url as string));
          if (preFetchSlug) return grantExisting(preFetchSlug);

          // Single shared acquisition path (src/recipe-acquire.ts) — the SAME pipeline and
          // the SAME failure taxonomy the background sweep parks with, so the two can't drift.
          const acquired = await acquireRecipeContent(url as string);
          if (!acquired.ok) {
            switch (acquired.reason) {
              case "unreachable":
                throw new ToolError(
                  "unreachable",
                  acquired.status !== undefined
                    ? `Fetching ${url} returned HTTP ${acquired.status}`
                    : `Could not fetch ${url}`,
                  acquired.status !== undefined ? { url, status: acquired.status } : { url },
                );
              case "no_jsonld":
                throw new ToolError("no_jsonld", `No JSON-LD found at ${url}`, { url });
              case "not_a_recipe":
                throw new ToolError("not_a_recipe", `JSON-LD present but no schema.org Recipe at ${url}`, { url });
              case "incomplete":
                throw new ToolError(
                  "incomplete",
                  `Recipe at ${url} is missing ${(acquired.missing ?? []).join(" and ")}`,
                  { url, missing: acquired.missing ?? [] },
                );
              default:
                throw new ToolError("unreachable", `Could not acquire ${url}`, { url });
            }
          }
          const norm = acquired.recipe;
          const source = norm.source ?? canonicalizeUrl(url as string);

          // The page's OWN declared source (canonical link / schema.org url) can differ
          // from the raw input (a redirect, a tracker-wrapped link) — re-check against
          // the SAME already-loaded map before spending a classify call.
          const postFetchSlug = sourceMap.get(canonicalizeUrl(source));
          if (postFetchSlug) return grantExisting(postFetchSlug);

          const rawTitle = norm.title.trim() || title?.trim() || "";
          const content = renderContent({ ingredients: norm.ingredients, instructions: norm.instructions });
          // tools_hint (schema.org `tool`) informs requires_equipment classification only —
          // never written directly, never returned (recipe-import's MODIFIED requirement).
          const conditioning: ClassifyConditioning | undefined = norm.tools_hint?.length
            ? { tools_hint: norm.tools_hint }
            : undefined;
          const classified = await classifyRecipe(
            env,
            { title: rawTitle, content },
            source,
            CLASSIFY_MAX_RETRIES,
            conditioning,
            "request",
          );
          const body = assembleBody({ ingredients: norm.ingredients, instructions: norm.instructions });
          return persistImportedRecipe(classified.frontmatter, body);
        }

        // Text path: classify directly from the pasted content (no page fetch) — the same
        // posture the sweep uses for an inline-recipe email body. `source` is null (no URL,
        // so no dedup-to-grant basis). When no `title` hint is given, the word-subset guard's
        // basis is the pasted text itself (recipes conventionally state the dish name near
        // the top), so a real extracted title still passes; only a hint-less paste with no
        // title anywhere in it falls back to an unusable title and fails validation below.
        const rawTitle = title?.trim() || (text as string);
        const classified = await classifyRecipe(
          env,
          { title: rawTitle, content: text as string },
          null,
          CLASSIFY_MAX_RETRIES,
          undefined,
          "request",
        );
        // The body is the member's own pasted text, content-faithful — never AI-reformatted —
        // normalized only enough to carry the required H2 structure. Text with no discernible
        // ingredients/instructions split fails buildNewRecipe's own shape guard (the
        // structured validation_failed the spec promises for unclassifiable text).
        const body = normalizeHeadings((text as string).trim());
        return persistImportedRecipe(classified.frontmatter, body);
      }),
  );

  // Source suppression (reject_discovery), the inbound-newsletter allowlist
  // (update_discovery_sources), and the feed set (update_feeds) leave the member MCP
  // surface (recipe-discovery, newsletter-discovery): they are shared, group-wide
  // config now written from the operator admin Discovery/Config surface over the same
  // shared write helpers (addDiscoveryRejection / addSourceRows / addFeedRows) —
  // unchanged and unaffected by this cull.

  server.registerTool(
    "list_new_for_me",
    {
      description:
        "Return the recipes the BACKGROUND discovery sweep imported FOR YOU since your last meal plan — already classified and embedded (so they're immediately usable AND retrievable via search_recipes). Each carries { slug, title, description, protein, cuisine, time_total, discovered_at }. Scoped to the calling MEMBER's discovery attribution: recipes the sweep taste-matched to YOU (not merely to your household), that you haven't favorited/rejected or cooked, discovered after your last plan (capped at a recent window for a never-planned member). Discovery-attribution-based and unchanged by visibility events: a recipe that newly entered your lens through a friend, or a curated landing (which carries no member matches), NEVER appears here. This REPLACES the old fetch_rss_discoveries/read_discovery_inbox pull — discovery is autonomous now; you read the result, you don't triage/parse/import in-flow. Fold these into the menu before the rest of retrieval. An empty list is normal (nothing new since you last planned).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const floor = new Date(Date.now() - NEW_FOR_ME_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
        const recipes = await readNewForMe(env, tenantId, tenant.member, floor);
        return { recipes };
      }),
  );

  // read_discovery_errors leaves the member MCP surface (discovery-sweep): parked
  // candidates surface in the operator admin Discovery area's candidate-pipeline view
  // (per-row retry/delete) instead — the same readDiscoveryErrors read, unchanged.
}
