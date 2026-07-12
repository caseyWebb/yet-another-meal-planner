// The bespoke in-chat recipe card (recipe-card-widget): the `display_recipe` MCP tool and
// the `ui://recipe/card` MCP Apps resource it references. This is the reusable pattern the
// diagnostic spike proved out — the canonical ext-apps `App`-client bridge, no capability
// gating, and the widget HTML served over `resources/read` (no new HTTP route).
//
// The card is a WRITING widget (D18/D32): beyond rendering the recipe it carries guided cook mode
// (mise → steps → done) and the two persistent writes it owns — `toggle_favorite` and `log_cooked`
// — through the D18 bridge. The Worker stamps `contract_version` and optionally the structured
// `cook` block; the client parses `body` when `cook` is absent, so every card is cook-capable (D32).
//
// The single self-contained widget HTML is built by `packages/widgets` into the Worker's
// merged static-assets root (`assets/widgets/recipe-card.html`) and read at runtime through
// the `ASSETS` binding — no bundling into worker source. Because `wrangler.jsonc` sets
// `not_found_handling: "single-page-application"`, an unknown asset path resolves to the
// member SPA shell (index.html) rather than a 404, so the read ASSERTS the widget's marker
// and fails structurally rather than serving the wrong document.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { KNOWN_RECIPE_CONTRACT_VERSION, type CookModeData, type RecipeCardData } from "@yamp/contract";
import type { Env } from "./env.js";
import { ToolError, fail } from "./errors.js";

/** The `ui://` resource the widget is served from; `display_recipe._meta.ui.resourceUri` equals this. */
export const RECIPE_CARD_URI = "ui://recipe/card";

/** Where `packages/widgets` emits the built single-file HTML inside the merged assets root. */
const WIDGET_ASSET_URL = "https://assets.local/widgets/recipe-card.html";

/**
 * A stable string the built widget HTML carries (a `<meta>` marker in the shell). The ASSETS
 * read asserts it so the SPA-fallback document (served for an unknown asset path) is detected
 * rather than mistaken for the widget.
 */
export const WIDGET_MARKER = "recipe-card-widget";

/** The overlay-merged recipe read `display_recipe` renders (the `readRecipeDetail` shape). `cook`
 *  is optional: the reader supplies it only when a skill has authored structured cook-mode data;
 *  absent, the widget parses `body` client-side (`@yamp/ui`'s `parseCookBody`) to the same shape. */
type RecipeDetail = { slug: string; frontmatter: Record<string, unknown>; body: string; cook?: CookModeData };

/** Reader injected by the caller (`buildServer` binds env + tenant), keeping this module off the tools.ts cycle. */
export type ReadRecipe = (slug: string) => Promise<RecipeDetail>;

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Coerce a frontmatter facet to a clean string[]: an array keeps its strings; a lone string wraps. */
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? [v] : [];
}

/** Map an overlay-merged recipe read onto the widget's `structuredContent` shape. */
export function toRecipeCardData(detail: RecipeDetail): RecipeCardData {
  const fm = detail.frontmatter;
  return {
    contract_version: KNOWN_RECIPE_CONTRACT_VERSION,
    slug: detail.slug,
    title: asString(fm.title) ?? detail.slug,
    description: asString(fm.description),
    time_total: typeof fm.time_total === "number" ? fm.time_total : null,
    dietary: asStringArray(fm.dietary),
    tags: fm.tags == null ? undefined : asStringArray(fm.tags),
    protein: asString(fm.protein) ?? null,
    cuisine: asString(fm.cuisine) ?? null,
    course: fm.course == null ? undefined : asStringArray(fm.course),
    requires_equipment: fm.requires_equipment == null ? undefined : asStringArray(fm.requires_equipment),
    favorite: Boolean(fm.favorite),
    body: detail.body,
    // Pass the structured cook block through when the reader supplies it (the skill path, D32);
    // otherwise the widget derives it from `body` client-side, so every card is cook-capable.
    ...(detail.cook ? { cook: detail.cook } : {}),
  };
}

/** A plain-text rendering of the card — the `content` fallback for hosts that cannot render the widget. */
function toTextFallback(card: RecipeCardData): string {
  const facets = [card.protein, card.cuisine, ...(card.course ?? [])].filter((x): x is string => Boolean(x));
  const metaBits: string[] = [];
  if (facets.length) metaBits.push(facets.join(" · "));
  if (card.time_total != null) metaBits.push(`${card.time_total} min`);
  if (card.dietary.length) metaBits.push(card.dietary.join(", "));
  const lines = [card.title];
  if (metaBits.length) lines.push(metaBits.join(" — "));
  if (card.description) lines.push("", card.description);
  lines.push("", card.body);
  return lines.join("\n");
}

/**
 * Register the recipe card widget onto `server`: the `ui://recipe/card` resource and the
 * `display_recipe` tool. `readRecipe` is injected (buildServer binds env + tenant); `env`
 * backs the resource's ASSETS read. No capability gating — `_meta.ui.resourceUri` is returned
 * unconditionally (the pinned SDK strips the capability probe), and the text `content`
 * fallback keeps a non-rendering host readable.
 */
export function registerRecipeCardWidget(server: McpServer, env: Env, readRecipe: ReadRecipe): void {
  registerAppResource(
    server,
    "Recipe Card",
    RECIPE_CARD_URI,
    { description: "The bespoke in-chat recipe card: title, facets, time/dietary, the recipe body, and guided cook mode with favorite/log-cooked controls." },
    async () => {
      const res = await env.ASSETS.fetch(new Request(WIDGET_ASSET_URL));
      if (!res.ok) {
        throw new ToolError("not_found", `recipe card widget asset is unavailable (status ${res.status})`);
      }
      const html = await res.text();
      // The SPA-fallback shell (not_found_handling) also returns 200; the marker distinguishes
      // the real widget document from that shell.
      if (!html.includes(WIDGET_MARKER)) {
        throw new ToolError("not_found", "recipe card widget asset not found (received the SPA shell)");
      }
      return { contents: [{ uri: RECIPE_CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppTool(
    server,
    "display_recipe",
    {
      title: "Display recipe",
      description:
        "Render a recipe as an inline, branded card in the conversation. Use this when the member wants to SEE a recipe (not when you are only reading it to reason — use read_recipe for that). Also the conversation's guided-cook surface: the card carries a Start Cooking mode (mise-en-place check-off, step-by-step navigation, per-step timers) that reads its steps from the recipe body, plus favorite and log-cooked controls the widget writes back through the app bridge (toggle_favorite / log_cooked). Takes a recipe `slug`; returns a widget-bearing result: `_meta.ui.resourceUri` points at the ui://recipe/card view, `structuredContent` carries the recipe's title, facets, time/dietary, markdown body, and `contract_version` (and the structured `cook` block when a skill supplies one), and `content` is a plain-text rendering hosts that cannot render the widget fall back to. An unknown slug returns a structured not_found error.",
      inputSchema: { slug: z.string() },
      _meta: { ui: { resourceUri: RECIPE_CARD_URI } },
    },
    async ({ slug }) => {
      try {
        const card = toRecipeCardData(await readRecipe(slug));
        return {
          _meta: { ui: { resourceUri: RECIPE_CARD_URI } },
          structuredContent: card,
          content: [{ type: "text", text: toTextFallback(card) }],
        };
      } catch (e) {
        if (e instanceof ToolError) return fail(e.toShape());
        const message = e instanceof Error ? e.message : String(e);
        return fail({ error: "upstream_unavailable", message });
      }
    },
  );
}
