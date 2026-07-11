// The pantry/waste vocabularies and the ONE D17 item→department derivation
// (pantry-disposition-foundations, design D1/D5). Pantry rows carry two orthogonal
// controlled fields — `location` (where it's kept) and `category` (the food taxonomy,
// which doubles as the analytics department dimension) — and waste events stamp a
// `department` at capture through `stampDepartment` below. The sibling
// spend-capture-on-order-commit change imports this module for the same stamp; no
// surface re-derives item→department on its own. Pure (no env) — the identity-memo
// read that feeds `stampDepartment` lives with the other identity reads
// (`readIngredientCategoryMemo`, src/corpus-db.ts). Band 2 lifts the vocab arrays
// into `@yamp/contract` when the member app needs the dropdowns (a one-line move,
// deliberately not done speculatively).

/** Kitchen locations — THE location vocabulary product-wide (page 06). */
export const PANTRY_LOCATIONS = ["fridge", "freezer", "pantry", "spice_rack", "counter", "cabinet"] as const;
export type PantryLocation = (typeof PANTRY_LOCATIONS)[number];

/** The food taxonomy a pantry row's `category` holds — also the D17 analytics
 *  dimension source. NULL reads as uncategorized (filled by the classifier), never
 *  an error; there is deliberately NO `other` value. */
export const PANTRY_CATEGORIES = [
  "produce",
  "dairy",
  "meat",
  "seafood",
  "grains",
  "bakery",
  "canned",
  "condiments",
  "oils",
  "spices",
  "baking",
  "frozen",
  "snacks",
  "beverages",
] as const;
export type PantryCategory = (typeof PANTRY_CATEGORIES)[number];

/** What the identity memo (`ingredient_identity.category`) may hold: the food taxonomy
 *  plus `household`, the non-food catch-all so classification always terminates. */
export const IDENTITY_CATEGORIES = [...PANTRY_CATEGORIES, "household"] as const;
export type IdentityCategory = (typeof IDENTITY_CATEGORIES)[number];

/** The D17 analytics departments stamped on events: the food taxonomy ∪ `household`
 *  (non-food) ∪ `leftovers` (the waste-only pseudo-department `prepared_from` rows stamp). */
export const DEPARTMENTS = [...IDENTITY_CATEGORIES, "leftovers"] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** The ONE canonical waste-reason enum (stories/03 §2's set, slugged). Capture defines
 *  it; band 4's versioned reason(+item-class)→avoidability table consumes it. */
export const WASTE_REASONS = [
  "spoiled",
  "moldy",
  "over_ripe",
  "expired",
  "freezer_burned",
  "stale",
  "forgot",
  "bought_too_much",
  "never_opened",
  "other",
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

/** The ongoing D21 write/read shim: the four LEGACY documented pantry `category` values
 *  transposed onto `location` for one deprecation window (stale cached plugins keep
 *  working, intent preserved). This is deliberately NARROWER than the migration's
 *  one-time remap (which also maps production's food-flavored free text); after the
 *  window these values drop to the generic off-vocab accepted-and-dropped path. */
export const LEGACY_CATEGORY_TO_LOCATION: Record<string, PantryLocation> = {
  pantry: "pantry",
  fridge: "fridge",
  freezer: "freezer",
  spices: "spice_rack",
};

/**
 * The capture-time department stamp (design D5 precedence, DECISIONS.md D17):
 *   1. a `prepared_from` row is a leftover → `leftovers`, regardless of category;
 *   2. else the row's `category` when it is in the food taxonomy — the user-visible,
 *      possibly user-corrected capture-time truth (member correction wins over derivation);
 *   3. else the identity memo's category (food taxonomy or `household`);
 *   4. else NULL = pending — the `ingredient-category` cron fills it once (NULL→value
 *      only); a stamped department is NEVER rewritten (vocab evolution never rewrites
 *      history).
 */
export function stampDepartment(args: {
  preparedFrom: string | null;
  rowCategory: string | null;
  memoCategory: string | null;
}): Department | null {
  if (args.preparedFrom != null && args.preparedFrom !== "") return "leftovers";
  if (args.rowCategory && (PANTRY_CATEGORIES as readonly string[]).includes(args.rowCategory)) {
    return args.rowCategory as Department;
  }
  if (args.memoCategory && (IDENTITY_CATEGORIES as readonly string[]).includes(args.memoCategory)) {
    return args.memoCategory as Department;
  }
  return null;
}
