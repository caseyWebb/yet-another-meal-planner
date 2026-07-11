// The pantry/waste vocabularies and the ONE D17 item→department derivation
// (pantry-disposition-foundations, design D1/D5). Pantry rows carry two orthogonal
// controlled fields — `location` (where it's kept) and `category` (the food taxonomy,
// which doubles as the analytics department dimension) — and waste events stamp a
// `department` at capture through `stampDepartment` below. Spend capture
// (spend-capture-on-order-commit) stamps the same dimension on order-send lines and
// spend events through `departmentForGroceryLine`; no
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

/**
 * The grocery-line department derivation (spend-capture-on-order-commit — the send-record
 * snapshot's capture-time stamp, same D17 dimension as `stampDepartment`):
 *   1. a NON-FOOD line — `kind` of `household`/`other`, or a non-grocery `domain` (the
 *      "2x4 lumber" fixture) — stamps `household` IMMEDIATELY, never pending: it is
 *      included in spend but excluded from cost-per-meal, and never enters the
 *      ingredient graph;
 *   2. else the identity memo's category for the line's canonical key (any memo value,
 *      `household` included);
 *   3. else NULL = pending classification — the `ingredient-category` cron's spend-fill
 *      phase stamps it once (NULL→value only); a stamped value is never rewritten.
 * `leftovers` is waste-side only (`prepared_from` rows via `stampDepartment`) — this
 * derivation can never produce it (the memo vocabulary excludes it). `memoLookup` is the
 * caller's batched `ingredient_identity.category` read (alias → identity → representative
 * — `readIngredientCategoryMemo`), threaded as a lookup so this stays pure (no env).
 */
export function departmentForGroceryLine(
  line: { key: string; kind?: string | null; domain?: string | null },
  memoLookup: (key: string) => string | null | undefined,
): Department | null {
  const kind = line.kind ?? "grocery";
  const domain = line.domain ?? "grocery";
  if (kind !== "grocery" || domain !== "grocery") return "household";
  const memo = memoLookup(line.key);
  if (memo && (IDENTITY_CATEGORIES as readonly string[]).includes(memo)) {
    return memo as Department;
  }
  return null;
}

/** The cost-per-meal NUMERATOR exclusion set (band 4's analyzer consumes this rather
 *  than re-deriving it): spend in these departments counts toward totals but never
 *  toward cost-per-meal. */
export const COST_PER_MEAL_EXCLUDED: readonly Department[] = ["household", "beverages"];
