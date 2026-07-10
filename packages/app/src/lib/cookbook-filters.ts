// The cookbook page's pure filter model (member-app-core: unified browse). One global
// filter state applies to search results, the promoted panel (per-row), the organic
// list, and the favorites view — so the semantics live here once, I/O-free, and the
// route only wires state to controls. Time semantics mirror the agent-side
// `max_time_total` gate (src/recipes.ts): a recipe with no numeric `time_total` fails
// any active time cap — an unknown time is never claimed under a time budget.
import type { Hit } from "./data";

/** The time segmented control's values — "" is "Any" (no cap). */
export const TIME_FILTER_VALUES = ["", "20", "30", "45"] as const;
export type TimeFilterValue = (typeof TIME_FILTER_VALUES)[number];

export interface CookbookFilterState {
  cuisine: string;
  protein: string;
  time: TimeFilterValue;
}

/** Whether any filter narrows (the Clear affordance / count-label gate). */
export function filtersActive(f: CookbookFilterState): boolean {
  return Boolean(f.cuisine || f.protein || f.time);
}

/** Apply the global filter state to a hit list. Exact facet match; the time cap
 *  admits only recipes with a numeric `time_total` at or under it. */
export function filterHits<T extends Hit>(hits: T[], f: CookbookFilterState): T[] {
  const cap = f.time ? Number(f.time) : null;
  return hits.filter((r) => {
    if (f.cuisine && r.cuisine !== f.cuisine) return false;
    if (f.protein && r.protein !== f.protein) return false;
    if (cap !== null && !(typeof r.time_total === "number" && r.time_total <= cap)) return false;
    return true;
  });
}

/** "sheet-pan dinners" → "Sheet Pan Dinners" (the mock's select-label casing). */
function capWords(v: string): string {
  return v.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Distinct non-null values of a facet across the loaded corpus, sorted — the select
 *  options are corpus-derived (never the authoring vocab), so empty options can't
 *  exist by construction. */
export function facetOptions(hits: Hit[], key: "cuisine" | "protein"): { value: string; label: string }[] {
  const values = [...new Set(hits.map((r) => r[key]).filter((v): v is string => Boolean(v)))].sort();
  return values.map((value) => ({ value, label: capWords(value) }));
}
