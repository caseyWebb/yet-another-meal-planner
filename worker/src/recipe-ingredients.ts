// Recipe-ingredient parsing (pantry-verification capability, tasks 1.1–1.3).
// Reduces a free-text, price-annotated recipe line to a clean, matchable name
// and an `optional` flag. Builds on matching.ts's normalizeIngredient/aliases
// rather than reimplementing alias handling. Pure — no I/O — so it is unit
// testable against the real corpus.

import { normalizeIngredient, stripLeadingQuantity } from "./matching.js";

export interface ParsedIngredient {
  /** Cleaned, alias-normalized ingredient name (the match key). */
  name: string;
  /** True when the line marked the ingredient optional (a garnish, "to taste", etc.). */
  optional: boolean;
}

// Leading descriptor adjectives that aren't part of the head noun and only hurt
// matching. Removed from the front before the head clause is taken. Deliberately
// conservative: state words that materially change the pantry item (e.g.
// "ground" in "ground beef") are NOT here.
const LEADING_DESCRIPTORS = new Set([
  "boneless",
  "skinless",
  "bone-in",
  "fresh",
  "ripe",
  "large",
  "small",
  "medium",
  "whole",
  "organic",
  "raw",
  "cooked",
  "frozen",
  "warm",
  "cold",
  "softened",
  "melted",
  // Leading prep participles. "ground" is deliberately excluded — it changes the
  // product ("ground beef" must not collapse to "beef").
  "chopped",
  "minced",
  "diced",
  "sliced",
  "grated",
  "shredded",
  "crushed",
  "finely",
  "thinly",
  "freshly",
  "roughly",
  "coarsely",
  "peeled",
  "trimmed",
  "halved",
  "quartered",
  "crumbled",
  "beaten",
  "drained",
  "rinsed",
  "toasted",
]);

/** Strip leading descriptor adjectives ("boneless, skinless chicken thighs" → "chicken thighs"). */
function stripLeadingDescriptors(s: string): string {
  let out = s;
  // Repeatedly remove a leading descriptor word and any comma/space after it.
  for (;;) {
    const m = /^([a-z-]+)\s*,?\s+/.exec(out);
    if (m && LEADING_DESCRIPTORS.has(m[1])) {
      out = out.slice(m[0].length);
      continue;
    }
    break;
  }
  return out;
}

/**
 * Parse one recipe ingredient line into a clean name + optional flag.
 * Order matters: detect `optional` and strip the `($x.xx)` price before the
 * other parentheticals are removed (the marker often lives in a parenthetical).
 */
export function parseRecipeIngredient(line: string, aliases: Record<string, string>): ParsedIngredient {
  let s = line.replace(/^[-*]\s+/, ""); // a markdown list bullet, if present

  // Price annotation: "($4.59)". Remove first so it never reaches the name.
  s = s.replace(/\(\s*\$[^)]*\)/g, " ");

  // Optional marker: "(optional ...)", "(optional)", or a trailing ", optional".
  const optional = /\boptional\b/i.test(s) || /\bto taste\b/i.test(s);

  // Remove all remaining parentheticals — quantity hints ("(4-5 thighs)"),
  // directives ("(uncooked)", "(optional garnish)"), etc.
  s = s.replace(/\([^)]*\)/g, " ");

  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  s = stripLeadingQuantity(s); // "1.25 lbs. boneless, ..." → "boneless, ..."
  s = stripLeadingDescriptors(s); // "boneless, skinless chicken thighs" → "chicken thighs"
  s = s.split(",")[0].trim(); // drop trailing prep clause: "yellow onion, diced" → "yellow onion"

  // Quantity is already stripped; this call resolves the alias and lowercases.
  const name = normalizeIngredient(s, aliases);
  return { name, optional };
}

/**
 * Extract the bullet lines under a recipe body's `## Ingredients` H2 section.
 * Returns the raw list-item text (bullets stripped) up to the next H2/H1.
 * Returns null when no `## Ingredients` section exists (caller maps to a
 * structured error — the recipe-site structural contract guarantees one).
 */
export function extractIngredientLines(body: string): string[] | null {
  const lines = body.split(/\r?\n/);
  let inSection = false;
  const out: string[] = [];
  for (const raw of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      const isIngredients = heading[1].length === 2 && /^ingredients\s*$/i.test(heading[2].trim());
      if (isIngredients) {
        inSection = true;
        continue;
      }
      if (inSection) break; // next heading ends the section
      continue;
    }
    if (!inSection) continue;
    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(raw);
    if (item) out.push(item[1]);
  }
  return inSection ? out : null;
}
