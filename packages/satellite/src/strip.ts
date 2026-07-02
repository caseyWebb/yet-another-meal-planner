// Fact-stripping: a NormalizedRecipe (the shared parse's output) → the wire-contract
// RecipeItem the satellite pushes. This is where the functional-facts-only posture is
// enforced: title / ingredients / instructions / times / servings / source and an
// optional summary are the ONLY fields that cross the wire. Publisher prose (headnotes)
// and images are never carried — the contract has no field for them and we never invent
// one. `tools_hint` from the parse is a classifier hint for the Worker, not a wire fact,
// so it is dropped here too.

import type { NormalizedRecipe, RecipeItem } from "@grocery-agent/contract";

/**
 * Strip a normalized recipe to the wire-contract functional facts.
 *
 * `source` falls back to the page URL the recipe was fetched from when the JSON-LD
 * carried no `url` — the contract requires a public http(s) source, and the fetch URL
 * is always that. Optional numeric/servings facts are carried through only when the
 * parse produced them (`undefined` is elided so the contract's optionals stay optional).
 */
export function toRecipeItem(n: NormalizedRecipe, fallbackUrl: string): RecipeItem {
  const item: RecipeItem = {
    title: n.title,
    ingredients: n.ingredients,
    instructions: n.instructions,
    source: n.source ?? fallbackUrl,
  };
  // Servings may be a number, string, or explicit null — carry it only when present.
  if (n.servings !== null && n.servings !== undefined) item.servings = n.servings;
  if (n.time_total !== null) item.time_total = n.time_total;
  if (n.time_active !== null) item.time_active = n.time_active;
  return item;
}
