// Pantry-verification core (pantry-verification capability, tasks 2.x + 3.1–3.2
// logic). Pure: takes parsed recipe ingredients + pantry items + substitution
// rules and returns the bucketed picture. No I/O, no freshness classification —
// it surfaces facts (presence + age metadata) and ambiguity (possible_matches),
// leaving freshness judgment and fuzzy-match confirmation to the agent.

import { normalizeIngredient } from "./matching.js";
import type { ParsedIngredient } from "./recipe-ingredients.js";
import { acceptableInPantry, findRule, type SubRule } from "./substitutions.js";

export interface InPantryEntry {
  recipe_calls_for: string;
  pantry_item: string;
  added_at: string | null;
  last_verified_at: string | null;
  days_since_verified: number | null;
  category: string | null;
  prepared_from: string | null;
}

export interface PossibleMatch {
  recipe_calls_for: string;
  candidate_pantry_item: string;
  for_recipes?: string[];
}

export interface InventorySubstitute {
  recipe_calls_for: string;
  available_substitute: string;
  for_recipes?: string[];
}

export interface NotInPantry {
  ingredient: string;
  for_recipes?: string[];
}

export interface VerifyResult {
  in_pantry: InPantryEntry[];
  possible_matches: PossibleMatch[];
  not_in_pantry: NotInPantry[];
  optional: string[];
  inventory_substitutes_available: InventorySubstitute[];
}

export type PantryItem = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Whole days between an ISO `YYYY-MM-DD` date and `now` (UTC), or null. */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - then;
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Tokens length >= 3, used for the conservative fuzzy candidate pass. */
function tokens(name: string): string[] {
  return name.split(/[\s-]+/).filter((t) => t.length >= 3);
}

/** A pantry item is a fuzzy candidate if names share a significant token or one contains the other. */
function isFuzzyCandidate(recipeKey: string, pantryKey: string): boolean {
  if (recipeKey === pantryKey) return false; // exact is handled separately
  if (recipeKey.includes(pantryKey) || pantryKey.includes(recipeKey)) return true;
  const a = new Set(tokens(recipeKey));
  return tokens(pantryKey).some((t) => a.has(t));
}

/**
 * Walk parsed recipe ingredients against the pantry. `slug` (when given) is
 * attached as `for_recipes` so per-recipe results aggregate cleanly.
 */
export function verifyParsedIngredients(
  parsed: ParsedIngredient[],
  pantryItems: PantryItem[],
  rules: SubRule[],
  aliases: Record<string, string>,
  now: Date = new Date(),
): VerifyResult {
  const result: VerifyResult = {
    in_pantry: [],
    possible_matches: [],
    not_in_pantry: [],
    optional: [],
    inventory_substitutes_available: [],
  };

  // Pre-normalize pantry names once.
  const pantry = pantryItems.map((it) => ({
    item: it,
    name: str(it.name) ?? "",
    key: normalizeIngredient(str(it.name) ?? "", aliases),
  }));
  const pantryNames = pantry.map((p) => p.name);

  for (const ing of parsed) {
    if (ing.optional) {
      result.optional.push(ing.name);
      continue;
    }
    if (!ing.name) continue;

    const exact = pantry.find((p) => p.key === ing.name);
    if (exact) {
      const lastVerified = str(exact.item.last_verified_at);
      result.in_pantry.push({
        recipe_calls_for: ing.name,
        pantry_item: exact.name,
        added_at: str(exact.item.added_at),
        last_verified_at: lastVerified,
        days_since_verified: daysSince(lastVerified, now),
        category: str(exact.item.category),
        prepared_from: str(exact.item.prepared_from),
      });
      continue;
    }

    const candidate = pantry.find((p) => isFuzzyCandidate(ing.name, p.key));
    if (candidate) {
      result.possible_matches.push({
        recipe_calls_for: ing.name,
        candidate_pantry_item: candidate.name,
      });
      continue;
    }

    // Genuinely absent → to-buy, and check for an inventory substitute.
    result.not_in_pantry.push({ ingredient: ing.name });
    const rule = findRule(rules, ing.name, aliases);
    if (rule) {
      const available = acceptableInPantry(rule, pantryNames, aliases);
      for (const sub of available) {
        result.inventory_substitutes_available.push({
          recipe_calls_for: ing.name,
          available_substitute: sub,
        });
      }
    }
  }

  return result;
}

/** Merge several per-recipe results, deduping by name and attaching `for_recipes`. */
export function aggregateVerifications(
  perRecipe: { slug: string; result: VerifyResult }[],
): VerifyResult {
  const inPantry = new Map<string, InPantryEntry>();
  const optional = new Set<string>();
  const possible = new Map<string, PossibleMatch & { for_recipes: string[] }>();
  const notIn = new Map<string, NotInPantry & { for_recipes: string[] }>();
  const subs = new Map<string, InventorySubstitute & { for_recipes: string[] }>();

  const push = <T extends { for_recipes: string[] }>(
    map: Map<string, T>,
    key: string,
    make: () => T,
    slug: string,
  ): void => {
    const existing = map.get(key);
    if (existing) {
      if (!existing.for_recipes.includes(slug)) existing.for_recipes.push(slug);
    } else {
      map.set(key, make());
    }
  };

  for (const { slug, result } of perRecipe) {
    for (const e of result.in_pantry) if (!inPantry.has(e.recipe_calls_for)) inPantry.set(e.recipe_calls_for, e);
    for (const o of result.optional) optional.add(o);
    for (const p of result.possible_matches) {
      push(possible, `${p.recipe_calls_for}|${p.candidate_pantry_item}`, () => ({ ...p, for_recipes: [slug] }), slug);
    }
    for (const n of result.not_in_pantry) {
      push(notIn, n.ingredient, () => ({ ingredient: n.ingredient, for_recipes: [slug] }), slug);
    }
    for (const s of result.inventory_substitutes_available) {
      push(subs, `${s.recipe_calls_for}|${s.available_substitute}`, () => ({ ...s, for_recipes: [slug] }), slug);
    }
  }

  return {
    in_pantry: [...inPantry.values()],
    possible_matches: [...possible.values()],
    not_in_pantry: [...notIn.values()],
    optional: [...optional],
    inventory_substitutes_available: [...subs.values()],
  };
}
