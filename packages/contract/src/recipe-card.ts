// The recipe-card widget's wire shape (recipe-card-widget). The `display_recipe` MCP
// tool populates a `RecipeCardData` from `readRecipeDetail`'s overlay-merged frontmatter +
// markdown body and returns it as the tool result's `structuredContent`; the bespoke
// `ui://recipe/card` widget hydrates its read-only render from the SAME shape. Kept here in
// the runtime-agnostic contract so the Worker (workerd) that produces it and the browser
// widget that consumes it share ONE definition and cannot drift.
//
// A pure type — no runtime, no workerd/Node/DOM API. Fields mirror the recipe frontmatter
// vocabulary (docs/SCHEMAS.md): the hard-gate `dietary`, the Tier-B `protein`/`cuisine`/
// `course`/`tags`, `requires_equipment`, `time_total`, plus the caller's `favorite` overlay
// and the derived `description`. The card is READ-ONLY, so there is no servings/steps data.

/** The RecipeCardData contract version this build understands (D19). A monotonic int, starting
 *  at 1; additive-only within a major. A widget hydrating a payload whose `contract_version`
 *  exceeds this renders READ-ONLY rather than mis-parsing a newer shape. Versioned INDEPENDENTLY
 *  of `ProposeCardData` (propose-card.ts). Bump when a field is added/changed. */
export const KNOWN_RECIPE_CONTRACT_VERSION = 1;

// A `type` (not `interface`) so the Worker can pass a `RecipeCardData` directly as an MCP
// tool result's `structuredContent` (typed `Record<string, unknown>`) — object-literal type
// aliases are assignable to an index-signature target; a named interface is not.
export type RecipeCardData = {
  /** The payload's contract version (D19), stamped by the Worker. `undefined` reads as 1. A
   *  widget on an older build renders READ-ONLY when this exceeds its `KNOWN_RECIPE_CONTRACT_VERSION`. */
  contract_version?: number;
  /** The recipe's slug (its stable id in the corpus). */
  slug: string;
  /** Display title (falls back to the slug if the frontmatter has none). */
  title: string;
  /** The AI-derived ~1-2 sentence summary, merged at read time. Absent until generated. */
  description?: string;
  /** Total time in minutes, or null when the recipe declares none. */
  time_total: number | null;
  /** Dietary tags (hard gate); may be empty. */
  dietary: string[];
  /** Free tags (Tier B), when present. */
  tags?: string[];
  /** Primary protein facet (Tier B), or null. */
  protein?: string | null;
  /** Cuisine facet (Tier B), or null. */
  cuisine?: string | null;
  /** Course/dish-type facets (Tier B open vocabulary), when present. */
  course?: string[];
  /** Equipment the recipe truly requires (EQUIPMENT_VOCAB slugs), when present. */
  requires_equipment?: string[];
  /** The caller's subjective favorite overlay. */
  favorite?: boolean;
  /** The recipe's markdown body (Ingredients/Instructions), rendered escape-first in the card. */
  body: string;
}
