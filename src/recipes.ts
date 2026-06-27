// Pure search_recipes facet-gate filtering (design D5). No I/O here so it is unit-testable;
// the tool wrapper supplies the index and the reference "now".

export interface RecipeFilters {
  protein?: string;
  cuisine?: string;
  /** Open-vocabulary course facet; matched by containment against the recipe's course list. */
  course?: string;
  query?: string;
  season?: string[];
  dietary?: string[];
  max_time_total?: number;
  not_cooked_since?: string;
  exclude_cooked_within_days?: number;
  /** Disable the default makeability gate, returning unmakeable recipes annotated with `missing_equipment`. */
  include_unmakeable?: boolean;
}

/** A recipe index entry: parsed frontmatter plus the injected slug. */
export type IndexedRecipe = Record<string, unknown> & { slug: string };
export type RecipeIndex = Record<string, IndexedRecipe>;

export interface RecipeListItem {
  slug: string;
  title: unknown;
  frontmatter: IndexedRecipe;
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

/** YYYY-MM-DD for a Date, in UTC, for lexicographic date comparison. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Apply filter semantics:
 * - array filters (season/dietary) match ALL listed values (AND); no tags filter
 * - reject is a HARD gate: a recipe the caller has rejected is always dropped
 *   (opt-out visibility — there is no `status` filter and no effective-draft default)
 * - not_cooked_since admits recipes with null last_cooked (never cooked)
 * - exclude_cooked_within_days drops recipes cooked within N days of `now`
 * - query is the single title+tags text search: tokenize on whitespace, drop
 *   stopwords (connectives), then match when EVERY remaining token is a
 *   case-insensitive substring of the title or any tag (token-AND; deterministic
 *   membership, no ranking). An all-stopword query applies no text narrowing.
 * - makeability gate (kitchen-equipment): a recipe whose requires_equipment is not
 *   a subset of `owned` is dropped by default. Empty `owned` (unknown inventory) is
 *   a no-op — every recipe passes. `include_unmakeable` returns the unmakeable ones
 *   annotated with `missing_equipment` instead of dropping (the named-dish path).
 */

/** Connectives dropped from a query so "chicken and rice" ≡ "chicken rice". */
const QUERY_STOPWORDS = new Set([
  "and",
  "or",
  "with",
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "for",
  "&",
]);

/** Tokenize a query: lowercase, split on whitespace, drop empties and stopwords. */
export function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !QUERY_STOPWORDS.has(t));
}

export function filterRecipes(
  index: RecipeIndex,
  filters: RecipeFilters = {},
  now: Date = new Date(),
  owned: string[] = [],
): RecipeListItem[] {
  const qTokens = queryTokens(filters.query ?? "");

  let cutoffWithin: string | null = null;
  if (typeof filters.exclude_cooked_within_days === "number") {
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - filters.exclude_cooked_within_days);
    cutoffWithin = isoDay(cutoff);
  }

  const out: RecipeListItem[] = [];

  for (const recipe of Object.values(index)) {
    // Reject hard gate: a recipe the caller rejected never surfaces (the shared
    // predicate consumed by both search_recipes modes — membership and ranked).
    if (recipe.reject) continue;
    if (filters.protein !== undefined && recipe.protein !== filters.protein) continue;
    if (filters.cuisine !== undefined && recipe.cuisine !== filters.cuisine) continue;

    // course is matched by CONTAINMENT (not equality): a recipe passes when its
    // course list includes the requested value, so a dual-use `[main, side]` recipe
    // satisfies both `course: "main"` and `course: "side"`. The indexed course is a
    // normalized array; tolerate a scalar defensively.
    if (filters.course !== undefined) {
      const want = filters.course.trim().toLowerCase();
      const courses = (
        Array.isArray(recipe.course) ? recipe.course : recipe.course != null ? [recipe.course] : []
      ).map((c) => String(c).trim().toLowerCase());
      if (!courses.includes(want)) continue;
    }

    if (filters.season?.length) {
      const season = asArray(recipe.season);
      if (!filters.season.every((s) => season.includes(s))) continue;
    }
    if (filters.dietary?.length) {
      const dietary = asArray(recipe.dietary);
      if (!filters.dietary.every((d) => dietary.includes(d))) continue;
    }

    if (qTokens.length) {
      const title = typeof recipe.title === "string" ? recipe.title.toLowerCase() : "";
      const tags = asArray(recipe.tags).map((t) => String(t).toLowerCase());
      const haystack = `${title} ${tags.join(" ")}`;
      if (!qTokens.every((tok) => haystack.includes(tok))) continue;
    }

    if (typeof filters.max_time_total === "number") {
      const t = recipe.time_total;
      if (typeof t !== "number" || t > filters.max_time_total) continue;
    }

    const lastCooked = recipe.last_cooked;
    const cookedStr = typeof lastCooked === "string" ? lastCooked : null;

    // not_cooked_since: keep if never cooked, or cooked strictly before the date.
    if (filters.not_cooked_since !== undefined) {
      if (cookedStr !== null && cookedStr >= filters.not_cooked_since) continue;
    }

    // exclude_cooked_within_days: drop if cooked on/after the cutoff. Never-cooked passes.
    if (cutoffWithin !== null && cookedStr !== null && cookedStr >= cutoffWithin) continue;

    // Makeability gate: requires_equipment ⊆ owned. Empty owned ⇒ no-op (unknown
    // inventory is not "owns nothing"). include_unmakeable surfaces flagged instead.
    let frontmatter: IndexedRecipe = recipe;
    if (owned.length > 0) {
      const missing = asArray(recipe.requires_equipment).filter((e) => !owned.includes(e));
      if (missing.length) {
        if (!filters.include_unmakeable) continue; // hidden from browse/suggest
        frontmatter = { ...recipe, missing_equipment: missing }; // surfaced, flagged
      }
    }

    out.push({ slug: recipe.slug, title: recipe.title, frontmatter });
  }

  return out;
}
