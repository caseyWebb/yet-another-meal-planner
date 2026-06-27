// Shared recipe-FACET helpers (recipe-facet-derivation): the derived-facet type, the open
// `course` normalizer, the D1 row parser, and the EFFECTIVE-facet merge. Both producers share
// this ONE module so the placement rules can't drift: the classify pass (src/recipe-classify.ts)
// WRITES raw classified facets to `recipe_facets`, and the index projection
// (src/recipe-projection.ts) MERGES `recipe_facets` + authored frontmatter into `recipes`.
//
// The merge rules (design D5/D7):
//   - Tier B (protein, cuisine, course, season): authored frontmatter override wins; else classified.
//   - tags: UNION of authored + classified (an editorial tag never discards the classifier's tags).
//   - Tier A (ingredients_key, perishable_ingredients, side_search_terms, meal_preppable):
//     classified wins; an authored value is only a legacy fallback (pre-migration), then empty.

/** The descriptive facets the classify pass derives + the projection merges (the recipe_facets row). */
export interface ClassifiedFacets {
  // Tier B — classified default (an authored frontmatter value overrides at merge).
  protein: string | null;
  cuisine: string | null;
  course: string[];
  season: string[];
  tags: string[];
  // Tier A — derived only (an authored value is a pre-migration legacy fallback).
  ingredients_key: string[];
  perishable_ingredients: string[];
  side_search_terms: string[];
  meal_preppable: boolean | null;
}

/** Empty derived facets — the failure / not-yet-classified form. */
export const EMPTY_FACETS: ClassifiedFacets = {
  protein: null,
  cuisine: null,
  course: [],
  season: [],
  tags: [],
  ingredients_key: [],
  perishable_ingredients: [],
  side_search_terms: [],
  meal_preppable: null,
};

/** Normalize the open-vocabulary `course` to a lowercased, trimmed string array. */
export function normalizeFacetCourse(value: unknown): string[] {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((c) => String(c).trim().toLowerCase()).filter((c) => c.length > 0);
}

/** Coerce a value to a string[] (array-of-strings, or a single string → [string]). */
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" && v ? [v] : [];
}

/** Parse a JSON-array TEXT column to a string[] (tolerating null/garbage as []). */
function parseJsonArr(value: unknown): string[] {
  if (typeof value !== "string" || value === "") return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** One raw `recipe_facets` D1 row as returned by the driver. */
export interface RawFacetRow {
  slug: string;
  protein: string | null;
  cuisine: string | null;
  course: string | null;
  season: string | null;
  tags: string | null;
  ingredients_key: string | null;
  perishable_ingredients: string | null;
  side_search_terms: string | null;
  meal_preppable: number | null;
}

/** Parse a `recipe_facets` row into ClassifiedFacets (for the projection's merge load). */
export function parseFacetRow(row: RawFacetRow): ClassifiedFacets {
  return {
    protein: row.protein ?? null,
    cuisine: row.cuisine ?? null,
    course: parseJsonArr(row.course),
    season: parseJsonArr(row.season),
    tags: parseJsonArr(row.tags),
    ingredients_key: parseJsonArr(row.ingredients_key),
    perishable_ingredients: parseJsonArr(row.perishable_ingredients),
    side_search_terms: parseJsonArr(row.side_search_terms),
    meal_preppable: row.meal_preppable == null ? null : !!row.meal_preppable,
  };
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** Stable union (a first, then any of b not already present), deduplicated. */
function unionStable(a: string[], b: string[]): string[] {
  const seen = new Set(a);
  const out = [...a];
  for (const x of b) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

/**
 * The effective facet overlay merged into a projected recipe row, given the recipe's authored
 * frontmatter and its classified facets (or null if not yet classified). Returns exactly the
 * nine facet fields the projection overwrites on the recipe object — Tier C (`dietary`,
 * `requires_equipment`, `time_total`, `pairs_with`) is untouched (it stays authored).
 */
export function mergeEffectiveFacets(
  authored: Record<string, unknown>,
  classified: ClassifiedFacets | null,
): ClassifiedFacets {
  const c = classified;
  // Tier A — classified wins; else authored legacy (pre-migration); else empty.
  const pickArr = (cv: string[] | undefined, av: string[]): string[] => (cv && cv.length ? cv : av);
  // Tier B — authored override (present, even if null) wins; else classified; else empty.
  return {
    protein: has(authored, "protein")
      ? typeof authored.protein === "string"
        ? authored.protein
        : null
      : c?.protein ?? null,
    cuisine: has(authored, "cuisine")
      ? typeof authored.cuisine === "string"
        ? authored.cuisine
        : null
      : c?.cuisine ?? null,
    course: has(authored, "course") ? normalizeFacetCourse(authored.course) : c?.course ?? [],
    season: has(authored, "season") ? strArray(authored.season) : c?.season ?? [],
    tags: unionStable(strArray(authored.tags), c?.tags ?? []),
    ingredients_key: pickArr(c?.ingredients_key, strArray(authored.ingredients_key)),
    perishable_ingredients: pickArr(c?.perishable_ingredients, strArray(authored.perishable_ingredients)),
    side_search_terms: pickArr(c?.side_search_terms, strArray(authored.side_search_terms)),
    meal_preppable:
      c?.meal_preppable ?? (typeof authored.meal_preppable === "boolean" ? authored.meal_preppable : null),
  };
}
