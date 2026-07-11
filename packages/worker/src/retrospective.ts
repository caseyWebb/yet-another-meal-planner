// Pure retrospective aggregation (cooking-history capability). Produces real
// protein/cuisine mixes, cadence, the cook-vs-convenience split, ready-to-eat
// favorites, and underused recipes. No I/O — the tool wrapper supplies the entries,
// the recipe index, and `now`. Each entry's protein/cuisine is ALREADY RESOLVED by
// the caller (the D1 `cooking_log LEFT JOIN recipes` + COALESCE — a recipe entry
// carries its recipe's dims, a non-recipe entry its inline dims), so this layer
// reads them off the row directly. The recipe `index` drives `underused`: LOVED
// recipes (the caller's favorites, plus revealed favorites cooked >=3x in the
// trailing 12 months) that have gone STALE (not cooked in a fixed 30 days) and are
// IN SEASON now. The index must already carry the caller's effective favorite/reject
// flags + last_cooked (overlay/cooking-log merged in); cook counts come from `entries`.

import type { CookingLogEntry } from "./cooking-log.js";
import type { RecipeIndex } from "./recipes.js";
import { normalizeSeason } from "./vocab.js";

// Re-exported so callers and tests reach the shared season canonicalizer from here.
export { normalizeSeason };

export interface RetrospectiveResult {
  period: string;
  window: { from: string; to: string; days: number };
  recipes_cooked: { recipe: string; count: number; dates: string[] }[];
  protein_mix: Record<string, number>;
  cuisine_mix: Record<string, number>;
  cadence: {
    cooks: number;
    weeks: number;
    cooks_per_week: number;
    /** Cooks per meal over rows whose `meal` is set (recipe + ad_hoc, in-window). */
    by_meal: { breakfast: number; lunch: number; dinner: number; project: number };
    /** In-window cooks whose `meal` is NULL (pre-meal-dimension rows; counted in the
     *  overall figure, reported unknown — never fabricated). */
    meal_unknown: number;
  };
  cook_vs_convenience: { cooked: number; convenience: number };
  ready_to_eat_favorites: { name: string; count: number }[];
  underused: {
    slug: string;
    title: unknown;
    last_cooked: string | null;
    /** Why it surfaced: an explicit favorite, or a revealed one (cooked repeatedly). */
    why: "favorite" | "revealed";
    /** The caller's all-time cook count for this recipe (for the revival nudge). */
    cook_count: number;
  }[];
  /** Total recipes that qualified as underused before the cap (>= underused.length). */
  underused_count: number;
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

/** Canonical season tokens (Northern hemisphere). Mirrors SEASON_VOCAB in src/vocab.js. */
export type Season = "spring" | "summer" | "fall" | "winter";

/** Current meteorological season for a Date, by UTC month, Northern hemisphere. */
export function seasonOf(d: Date): Season {
  const m = d.getUTCMonth(); // 0 = January
  if (m === 11 || m <= 1) return "winter"; // Dec, Jan, Feb
  if (m <= 4) return "spring"; // Mar, Apr, May
  if (m <= 7) return "summer"; // Jun, Jul, Aug
  return "fall"; // Sep, Oct, Nov
}

/** In season when the season list is empty (year-round) or includes the current season. */
function inSeason(seasonValue: unknown, current: Season): boolean {
  if (!Array.isArray(seasonValue) || seasonValue.length === 0) return true;
  return seasonValue.some((s) => normalizeSeason(String(s)) === current);
}

/** Per-member retrospective preferences; absent fields fall back to the compiled defaults. */
export interface RetroConfig {
  staleAfterDays?: number;
  revealedMonths?: number;
  revealedMinCooks?: number;
}

const DEFAULT_RETRO_CONFIG: Required<RetroConfig> = {
  staleAfterDays: 30,
  revealedMonths: 12,
  revealedMinCooks: 3,
};

/** Cap on returned underused items; the full qualifying total rides in underused_count. */
const UNDERUSED_CAP = 15;

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function retrospective(
  entries: CookingLogEntry[],
  index: RecipeIndex,
  period: string,
  now: Date = new Date(),
  retroConfig: RetroConfig = {},
): RetrospectiveResult {
  const STALE_AFTER_DAYS = retroConfig.staleAfterDays ?? DEFAULT_RETRO_CONFIG.staleAfterDays;
  const REVEALED_MONTHS = retroConfig.revealedMonths ?? DEFAULT_RETRO_CONFIG.revealedMonths;
  const REVEALED_MIN_COOKS = retroConfig.revealedMinCooks ?? DEFAULT_RETRO_CONFIG.revealedMinCooks;
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
  const by_meal = { breakfast: 0, lunch: 0, dinner: 0, project: 0 };
  let meal_unknown = 0;

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
      // recipe + ad_hoc are cooking events. The meal-aware split: rows with a meal
      // count under it; NULL-meal rows land in meal_unknown (still in `cooked`).
      cooked++;
      if (e.meal && e.meal in by_meal) by_meal[e.meal]++;
      else meal_unknown++;
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

  // Cook counts over ALL entries (not just the window): the all-time count per slug
  // (surfaced as cook_count) and the trailing-window count that qualifies a revealed
  // favorite. Both come from the rows already in hand — no extra query.
  const revealedStart = new Date(now);
  revealedStart.setUTCMonth(revealedStart.getUTCMonth() - REVEALED_MONTHS);
  const revealedFrom = isoDay(revealedStart);
  const allTimeCooks = new Map<string, number>();
  const trailingCooks = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "recipe" || !e.recipe || !e.date) continue;
    allTimeCooks.set(e.recipe, (allTimeCooks.get(e.recipe) ?? 0) + 1);
    if (e.date >= revealedFrom) {
      trailingCooks.set(e.recipe, (trailingCooks.get(e.recipe) ?? 0) + 1);
    }
  }

  // Underused: LOVED (the caller favorited it, OR cooked it >= REVEALED_MIN_COOKS times
  // in the trailing window) AND STALE (never cooked, or last cooked before a FIXED
  // 30-day cutoff — independent of `period`) AND IN SEASON now. Rejected recipes never
  // surface. Sorted stalest-first; underused_count is the pre-cap total.
  const staleStart = new Date(now);
  staleStart.setUTCDate(staleStart.getUTCDate() - STALE_AFTER_DAYS);
  const staleCutoff = isoDay(staleStart);
  const currentSeason = seasonOf(now);

  const allUnderused: RetrospectiveResult["underused"] = [];
  for (const r of Object.values(index)) {
    if (r.reject) continue;
    const declared = Boolean(r.favorite);
    const revealed = !declared && (trailingCooks.get(r.slug) ?? 0) >= REVEALED_MIN_COOKS;
    if (!declared && !revealed) continue;

    const lc = typeof r.last_cooked === "string" ? r.last_cooked : null;
    if (lc !== null && lc >= staleCutoff) continue; // cooked within 30 days -> still fresh
    if (!inSeason(r.season, currentSeason)) continue;

    allUnderused.push({
      slug: r.slug,
      title: r.title,
      last_cooked: lc,
      why: declared ? "favorite" : "revealed",
      cook_count: allTimeCooks.get(r.slug) ?? 0,
    });
  }
  allUnderused.sort((a, b) => {
    if (a.last_cooked === b.last_cooked) return a.slug.localeCompare(b.slug);
    if (a.last_cooked === null) return -1;
    if (b.last_cooked === null) return 1;
    return a.last_cooked < b.last_cooked ? -1 : 1;
  });
  const underused = allUnderused.slice(0, UNDERUSED_CAP);

  return {
    period,
    window: { from, to, days: windowDays },
    recipes_cooked,
    protein_mix,
    cuisine_mix,
    cadence: { cooks: cooked, weeks: Math.round(weeks * 100) / 100, cooks_per_week, by_meal, meal_unknown },
    cook_vs_convenience: { cooked, convenience },
    ready_to_eat_favorites,
    underused,
    underused_count: allUnderused.length,
  };
}
