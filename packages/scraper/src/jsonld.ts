// Layer-1 HTML → JSON-LD extraction, the NODE half of the shared recipe parse.
//
// The Worker extracts JSON-LD blocks with HTMLRewriter (workerd-only). This module is
// the equivalent for Node: a regex sweep for every <script type="application/ld+json">
// block, JSON.parse each (with the same minimal entity-decode fallback the Worker uses),
// collecting the parsed objects into unknown[]. From there we hand off to the shared,
// runtime-agnostic parse (findRecipe + normalizeRecipe from @grocery-agent/contract) so
// the scraper and the Worker can never disagree on what a recipe page means.

import { findRecipe, normalizeRecipe, type RecipeItem } from "@grocery-agent/contract";
import { toRecipeItem } from "./strip.js";

/**
 * Match each `<script type="application/ld+json">…</script>` block. `type` may carry
 * other attributes and any quoting; the content is captured lazily up to the closing tag.
 * Case-insensitive + dot-matches-newline so multi-line blocks are captured whole.
 */
const LD_JSON_BLOCK =
  /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Parse one script block's raw text, with the Worker's minimal HTML-entity fallback. */
function tryParseJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A few sites HTML-encode quotes/ampersands inside the script; try a minimal decode.
    try {
      return JSON.parse(text.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&"));
    } catch {
      return undefined;
    }
  }
}

/**
 * Collect and parse every JSON-LD script block from an HTML string. Unparseable blocks
 * are skipped (mirrors the Worker's tolerant extractor). Returns the parsed objects,
 * ready for `findRecipe`.
 */
export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const m of html.matchAll(LD_JSON_BLOCK)) {
    const parsed = tryParseJson(m[1]);
    if (parsed !== undefined) blocks.push(parsed);
  }
  return blocks;
}

/**
 * The full generic page → RecipeItem path: extract JSON-LD, find the schema.org Recipe,
 * normalize with the shared parse, and strip to functional facts. Returns a structured
 * `{ error }` (never throws) when the page has no recipe JSON-LD or the recipe is
 * incomplete (missing ingredients/instructions), so callers can log-and-skip.
 */
export function parsePageToRecipe(html: string, url: string): RecipeItem | { error: string } {
  const blocks = extractJsonLdBlocks(html);
  if (blocks.length === 0) return { error: "no_jsonld" };
  const recipe = findRecipe(blocks);
  if (!recipe) return { error: "no_recipe_node" };
  const normalized = normalizeRecipe(recipe);
  if (!normalized.ok) return { error: `incomplete: missing ${normalized.missing.join(", ")}` };
  return toRecipeItem(normalized.recipe, url);
}
