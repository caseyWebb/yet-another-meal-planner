// Pure list_recipes filtering (design D5). No I/O here so it is unit-testable;
// the tool wrapper supplies the index and the reference "now".

export interface RecipeFilters {
  status?: string;
  protein?: string;
  cuisine?: string;
  query?: string;
  tags?: string[];
  season?: string[];
  dietary?: string[];
  max_time_total?: number;
  not_cooked_since?: string;
  exclude_cooked_within_days?: number;
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
 * - array filters (tags/season/dietary) match ALL listed values (AND)
 * - status defaults to "active"; status "all" disables status filtering
 * - not_cooked_since admits recipes with null last_cooked (never cooked)
 * - exclude_cooked_within_days drops recipes cooked within N days of `now`
 * - query matches when EVERY whitespace-separated token is a case-insensitive
 *   substring of the title or any tag (token-AND; deterministic membership, no ranking)
 */
export function filterRecipes(
  index: RecipeIndex,
  filters: RecipeFilters = {},
  now: Date = new Date(),
): RecipeListItem[] {
  const wantStatus = filters.status === "all" ? null : (filters.status ?? "active");

  const queryTokens = (filters.query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  let cutoffWithin: string | null = null;
  if (typeof filters.exclude_cooked_within_days === "number") {
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - filters.exclude_cooked_within_days);
    cutoffWithin = isoDay(cutoff);
  }

  const out: RecipeListItem[] = [];

  for (const recipe of Object.values(index)) {
    if (wantStatus !== null && recipe.status !== wantStatus) continue;
    if (filters.protein !== undefined && recipe.protein !== filters.protein) continue;
    if (filters.cuisine !== undefined && recipe.cuisine !== filters.cuisine) continue;

    if (filters.tags?.length) {
      const tags = asArray(recipe.tags);
      if (!filters.tags.every((t) => tags.includes(t))) continue;
    }
    if (filters.season?.length) {
      const season = asArray(recipe.season);
      if (!filters.season.every((s) => season.includes(s))) continue;
    }
    if (filters.dietary?.length) {
      const dietary = asArray(recipe.dietary);
      if (!filters.dietary.every((d) => dietary.includes(d))) continue;
    }

    if (queryTokens.length) {
      const title = typeof recipe.title === "string" ? recipe.title.toLowerCase() : "";
      const tags = asArray(recipe.tags).map((t) => String(t).toLowerCase());
      const haystack = `${title} ${tags.join(" ")}`;
      if (!queryTokens.every((tok) => haystack.includes(tok))) continue;
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

    out.push({ slug: recipe.slug, title: recipe.title, frontmatter: recipe });
  }

  return out;
}
