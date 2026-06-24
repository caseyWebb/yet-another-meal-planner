// Pure retrospective aggregation (cooking-history capability). Produces real
// protein/cuisine mixes, cadence, the cook-vs-convenience split, ready-to-eat
// favorites, and underused recipes. No I/O — the tool wrapper supplies the entries,
// the recipe index, and `now`. Each entry's protein/cuisine is ALREADY RESOLVED by
// the caller (the D1 `cooking_log LEFT JOIN recipes` + COALESCE — a recipe entry
// carries its recipe's dims, a non-recipe entry its inline dims), so this layer
// reads them off the row directly. The recipe `index` is used only for `underused`
// (active recipes not cooked in the window), where it must already carry the
// caller's effective status + last_cooked (overlay/cooking-log merged in).

import type { CookingLogEntry } from "./cooking-log.js";
import type { RecipeIndex } from "./recipes.js";

export interface RetrospectiveResult {
  period: string;
  window: { from: string; to: string; days: number };
  recipes_cooked: { recipe: string; count: number; dates: string[] }[];
  protein_mix: Record<string, number>;
  cuisine_mix: Record<string, number>;
  cadence: { cooks: number; weeks: number; cooks_per_week: number };
  cook_vs_convenience: { cooked: number; convenience: number };
  ready_to_eat_favorites: { name: string; count: number }[];
  underused: { slug: string; title: unknown; last_cooked: string | null }[];
}

/** YYYY-MM-DD for a Date in UTC (lexicographically comparable). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a period string to a number of days. Accepts `"Nd"` (e.g. "30d"),
 * `"week"`, `"month"`, `"quarter"`, `"year"`, or `"all"` (returns null = no
 * lower bound). Unrecognized input falls back to 30 days.
 */
export function periodDays(period: string): number | null {
  const p = period.trim().toLowerCase();
  if (p === "all") return null;
  const m = /^(\d+)\s*d$/.exec(p);
  if (m) return Number(m[1]);
  switch (p) {
    case "week":
      return 7;
    case "month":
      return 30;
    case "quarter":
      return 90;
    case "year":
      return 365;
    default:
      return 30;
  }
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function retrospective(
  entries: CookingLogEntry[],
  index: RecipeIndex,
  period: string,
  now: Date = new Date(),
): RetrospectiveResult {
  const days = periodDays(period);
  const to = isoDay(now);
  let from: string;
  if (days === null) {
    // "all": window starts at the earliest entry (or today if none).
    const earliest = entries.reduce<string | null>(
      (min, e) => (e.date && (min === null || e.date < min) ? e.date : min),
      null,
    );
    from = earliest ?? to;
  } else {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - days);
    from = isoDay(start);
  }

  const inWindow = entries.filter((e) => e.date && e.date >= from && e.date <= to);

  const protein_mix: Record<string, number> = {};
  const cuisine_mix: Record<string, number> = {};
  const cookedDates: Map<string, string[]> = new Map();
  const favorites: Map<string, number> = new Map();
  let cooked = 0;
  let convenience = 0;

  for (const e of inWindow) {
    // protein/cuisine are already resolved on the entry (recipe-derived for recipe
    // entries via the JOIN, inline for non-recipe entries via COALESCE).
    if (e.type === "recipe" && e.recipe) {
      const dates = cookedDates.get(e.recipe) ?? [];
      dates.push(e.date);
      cookedDates.set(e.recipe, dates);
    }
    bump(protein_mix, e.protein ?? "unknown");
    bump(cuisine_mix, e.cuisine ?? "unknown");

    if (e.type === "ready_to_eat") {
      convenience++;
      if (e.name) favorites.set(e.name, (favorites.get(e.name) ?? 0) + 1);
    } else {
      // recipe + ad_hoc are cooking events
      cooked++;
    }
  }

  const recipes_cooked = [...cookedDates.entries()]
    .map(([recipe, dates]) => ({ recipe, count: dates.length, dates: dates.sort() }))
    .sort((a, b) => b.count - a.count || a.recipe.localeCompare(b.recipe));

  const ready_to_eat_favorites = [...favorites.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Cadence: cooking events (recipe + ad_hoc) per week over the window.
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const windowDays = Math.max(1, Math.round((toMs - fromMs) / 86_400_000));
  const weeks = windowDays / 7;
  const cooks_per_week = weeks > 0 ? Math.round((cooked / weeks) * 100) / 100 : cooked;

  // Underused: active recipes not cooked within the window (by derived last_cooked).
  const underused: { slug: string; title: unknown; last_cooked: string | null }[] = [];
  for (const r of Object.values(index)) {
    if (r.status !== "active") continue;
    const lc = typeof r.last_cooked === "string" ? r.last_cooked : null;
    if (lc === null || lc < from) {
      underused.push({ slug: r.slug, title: r.title, last_cooked: lc });
    }
  }
  underused.sort((a, b) => {
    if (a.last_cooked === b.last_cooked) return a.slug.localeCompare(b.slug);
    if (a.last_cooked === null) return -1;
    if (b.last_cooked === null) return 1;
    return a.last_cooked < b.last_cooked ? -1 : 1;
  });

  return {
    period,
    window: { from, to, days: windowDays },
    recipes_cooked,
    protein_mix,
    cuisine_mix,
    cadence: { cooks: cooked, weeks: Math.round(weeks * 100) / 100, cooks_per_week },
    cook_vs_convenience: { cooked, convenience },
    ready_to_eat_favorites,
    underused,
  };
}
