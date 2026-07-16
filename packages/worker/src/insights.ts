// Group-popularity insights (group-insights capability). Backs the operator Insights view
// (server-rendered at `/admin/insights`): a group-wide popularity dashboard over the recipe
// corpus — windowed summary tiles, a GitHub-style cooking-activity heatmap, and recipe + source
// leaderboards.
//
// "Group" = every member-tenant on the deployment; the admin surface is deliberately cross-tenant
// (see src/admin-data.ts), so a group aggregate simply omits the tenant filter. Every input is
// already in D1: `cooking_log` (one row per cook, with a day-granular `date` and a `type`),
// `overlay` (per-member `favorite` flags), `recipes` (title/cuisine/source_url), and `feeds` (the
// discovery feed URLs). This module reads none of them directly — it goes through `src/db.ts` —
// and NEVER writes.
//
// The pure mapping (`mapInsights`) is split from the IO (`readInsights`) so the windowing,
// ranking, rollup, and heatmap-bucketing logic is unit-testable offline, the same discipline as
// src/usage.ts. `nowMs` is injected (never `Date.now()` inside the pure fn) so tests are
// deterministic.
//
// Cook-type semantics (design.md Decision 4): a recipe's *times cooked* counts only
// `type='recipe'` rows whose slug is in the corpus; the heatmap and the Cook-events total count
// `type IN ('recipe','ad_hoc')` (all home cooking). A historical row stored with the
// retired `ready_to_eat` type (remove-ready-to-eat — no longer writable) is excluded from
// both, exactly as before that type's retirement, and never errors this read. Favorites are
// current state (`overlay` carries no timestamp), so favorite counts do NOT vary by window.

import type { Env } from "./env.js";
import { db } from "./db.js";

const DAY = 86_400_000;

/** The four popularity windows, in display order. `all` is unbounded. */
export type WindowKey = "all" | "year" | "month" | "week";

/** The leaderboard rank metric. */
export type SortKey = "cooks" | "favorites";

/** Trailing-day span of each window (`all` = Infinity → no cutoff). */
const WINDOW_DAYS: Record<WindowKey, number> = { all: Infinity, year: 365, month: 30, week: 7 };

export interface InsightsWindowDef {
  key: WindowKey;
  label: string;
}

const WINDOW_DEFS: InsightsWindowDef[] = [
  { key: "all", label: "All time" },
  { key: "year", label: "Year" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
];

/** One recipe's popularity row within a window. `favorites` is window-invariant (favorites carry
 *  no timestamp); `cooks`/`lastCookedLabel` are window-scoped. `combined` blends both for the
 *  rank tiebreak. */
export interface InsightsRecipeRow {
  slug: string;
  title: string;
  cuisine: string | null;
  /** Friendly source name (a mapped/bare `source_url` domain, or "Member submissions"). */
  sourceName: string;
  favorites: number;
  cooks: number;
  combined: number;
  /** Relative age of the most recent in-window cook ("today" / "3d ago" / "never"). */
  lastCookedLabel: string;
}

/** One source (a `source_url` domain, or the member-authored bucket) rolled up from its recipes. */
export interface InsightsSourceRow {
  /** Stable key: the domain, or `__member__` for the member-authored bucket. */
  key: string;
  domain: string | null;
  name: string;
  /** True for the member-authored bucket (no usable `source_url`). */
  isMember: boolean;
  /** True when the domain matches a configured discovery feed. */
  isFeed: boolean;
  recipeCount: number;
  favorites: number;
  cooks: number;
  combined: number;
  /** This source's recipes (for the expand-to-recipes row). */
  recipes: InsightsRecipeRow[];
}

/** Window-scoped headline totals. `favorites` is window-invariant. */
export interface InsightsTotals {
  cooks: number;
  favorites: number;
  activeDays: number;
}

/** Everything the leaderboards + tiles need for one window (ranking + top-N happens in the view). */
export interface InsightsWindowView {
  recipes: InsightsRecipeRow[];
  sources: InsightsSourceRow[];
  totals: InsightsTotals;
}

/** One heatmap cell: a day, its cooking-activity count, and its 0–4 intensity level. */
export interface HeatCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

/** A month header segment spanning `span` week-columns of the heatmap grid. */
export interface HeatMonth {
  label: string;
  span: number;
}

/** The trailing-53-week cooking-activity heatmap. Cells are column-major (week by week, each
 *  week Sun→Sat); future days (past `today`) are omitted. `count` is `type IN ('recipe','ad_hoc')`. */
export interface InsightsHeatmap {
  today: string;
  weeks: number;
  cells: HeatCell[];
  months: HeatMonth[];
}

/** The full Insights payload: every window precomputed (so the island toggles with no refetch),
 *  the window cutoffs (for the heatmap's out-of-window dimming), and the heatmap grid. */
export interface InsightsPayload {
  windows: InsightsWindowDef[];
  /** Lexicographic `date` cutoff per window (`""` for `all` — every date sorts ≥ it). */
  windowStart: Record<WindowKey, string>;
  perWindow: Record<WindowKey, InsightsWindowView>;
  heatmap: InsightsHeatmap;
  generatedAt: number;
}

/** The raw rows `mapInsights` consumes (what `readInsights` selects from D1). */
export interface InsightsInput {
  cooks: { date: string; type: string; recipe: string | null }[];
  overlay: { recipe: string; favorite: number | null }[];
  recipes: { slug: string; title: string | null; cuisine: string | null; source_url: string | null }[];
  feeds: { url: string }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A small friendly-name table for the common recipe-source domains (display nicety only; an
 *  unmapped domain shows verbatim). */
const SOURCE_NAMES: Record<string, string> = {
  "nytimes.com": "NYT Cooking",
  "cooking.nytimes.com": "NYT Cooking",
  "smittenkitchen.com": "Smitten Kitchen",
  "seriouseats.com": "Serious Eats",
  "bonappetit.com": "Bon Appétit",
  "food52.com": "Food52",
  "kingarthurbaking.com": "King Arthur Baking",
  "thewoksoflife.com": "The Woks of Life",
  "justonecookbook.com": "Just One Cookbook",
  "cookieandkate.com": "Cookie and Kate",
  "gimmesomeoven.com": "Gimme Some Oven",
};

/** The `YYYY-MM-DD` UTC day for an epoch-ms instant. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` day string to its UTC-midnight epoch ms. */
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** The domain of a `source_url` (host, lowercased, `www.` stripped), or null when absent/malformed
 *  (→ the member-authored bucket). Never throws. */
export function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** A source's friendly label: the mapped name, the bare domain, or the member-authored bucket. */
function sourceLabel(domain: string | null): string {
  return domain ? (SOURCE_NAMES[domain] ?? domain) : "Member submissions";
}

/** A 0–4 heatmap intensity level from a day's cooking-activity count. */
function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/** Relative age of the most-recent in-window cook, from `today0` (UTC midnight) and a day string. */
function relAgeLabel(today0: number, date: string | null): string {
  if (!date) return "never";
  const days = Math.round((today0 - dayMs(date)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** The lexicographic `date` cutoff for a window: `""` (unbounded) for `all`, else `today` minus
 *  `days-1` (so a 7-day window is today plus the six prior calendar days, inclusive). */
function windowCutoff(today0: number, key: WindowKey): string {
  const days = WINDOW_DAYS[key];
  return days === Infinity ? "" : utcDay(today0 - (days - 1) * DAY);
}

/** Rank rows by the selected metric descending, ties broken by the blended `combined` score.
 *  Shared by the leaderboards (recipes + sources) so SSR and the island rank identically. */
export function rankRows<T extends { favorites: number; cooks: number; combined: number }>(rows: T[], sort: SortKey): T[] {
  const metric = (r: T): number => (sort === "favorites" ? r.favorites : r.cooks);
  return [...rows].sort((a, b) => (metric(b) !== metric(a) ? metric(b) - metric(a) : b.combined - a.combined));
}

/**
 * Pure aggregation of the raw D1 rows into the Insights payload — group-wide (no tenant filter),
 * one pass computing all four windows plus the trailing-53-week heatmap. No IO, no `Date.now()`;
 * `nowMs` is injected so the output is deterministic. Degrades gracefully on empty input (well-
 * formed zero-filled windows, an all-level-0 heatmap) rather than throwing.
 */
export function mapInsights(input: InsightsInput, nowMs: number): InsightsPayload {
  const today = utcDay(nowMs);
  const today0 = dayMs(today);

  // Per-recipe identity for slugs in the corpus (a cook/overlay row for a slug absent here is
  // ignored by the leaderboards — it isn't an in-corpus recipe).
  const meta = new Map<string, { title: string; cuisine: string | null; domain: string | null; sourceName: string }>();
  for (const r of input.recipes) {
    const domain = domainOf(r.source_url);
    meta.set(r.slug, { title: r.title ?? r.slug, cuisine: r.cuisine, domain, sourceName: sourceLabel(domain) });
  }

  // Group favorite count per slug (favorites are current state — window-invariant).
  const favBySlug = new Map<string, number>();
  for (const o of input.overlay) {
    if (!o.favorite) continue;
    favBySlug.set(o.recipe, (favBySlug.get(o.recipe) ?? 0) + 1);
  }

  // Recipe cooks (leaderboard signal) vs. all cooking activity (heatmap/totals signal).
  const recipeCooks = input.cooks.filter((c) => c.type === "recipe" && c.recipe != null && meta.has(c.recipe)) as {
    date: string;
    recipe: string;
  }[];
  const activity = input.cooks.filter((c) => c.type === "recipe" || c.type === "ad_hoc");

  // Discovery-feed domains, for the source "discovery feed" tag.
  const feedDomains = new Set<string>();
  for (const f of input.feeds) {
    const d = domainOf(f.url);
    if (d) feedDomains.add(d);
  }

  // Heatmap activity counts per day (all trailing time; the grid selects the trailing 53 weeks).
  const activityByDate = new Map<string, number>();
  for (const e of activity) activityByDate.set(e.date, (activityByDate.get(e.date) ?? 0) + 1);

  // Candidate recipes (window-invariant): any corpus recipe with a favorite or an all-time cook.
  const allTimeCook = new Map<string, number>();
  for (const e of recipeCooks) allTimeCook.set(e.recipe, (allTimeCook.get(e.recipe) ?? 0) + 1);
  const candidates = [...meta.keys()]
    .filter((slug) => (favBySlug.get(slug) ?? 0) > 0 || (allTimeCook.get(slug) ?? 0) > 0)
    .sort();

  const rollupSources = (rows: InsightsRecipeRow[], rowDomain: Map<string, string | null>): InsightsSourceRow[] => {
    const map = new Map<string, InsightsSourceRow>();
    for (const r of rows) {
      const domain = rowDomain.get(r.slug) ?? null;
      const key = domain ?? "__member__";
      let s = map.get(key);
      if (!s) {
        s = {
          key,
          domain,
          name: r.sourceName,
          isMember: !domain,
          isFeed: domain ? feedDomains.has(domain) : false,
          recipeCount: 0,
          favorites: 0,
          cooks: 0,
          combined: 0,
          recipes: [],
        };
        map.set(key, s);
      }
      s.favorites += r.favorites;
      s.cooks += r.cooks;
      s.recipeCount += 1;
      s.recipes.push(r);
    }
    const out = [...map.values()];
    const maxFav = Math.max(1, ...out.map((s) => s.favorites));
    const maxCook = Math.max(1, ...out.map((s) => s.cooks));
    for (const s of out) s.combined = Math.round((s.favorites / maxFav) * 50 + (s.cooks / maxCook) * 50);
    return out;
  };

  const rowDomain = new Map<string, string | null>();
  for (const slug of candidates) rowDomain.set(slug, meta.get(slug)?.domain ?? null);

  const buildWindow = (key: WindowKey): InsightsWindowView => {
    const cutoff = windowCutoff(today0, key);
    const cookBySlug = new Map<string, number>();
    const lastBySlug = new Map<string, string>();
    for (const e of recipeCooks) {
      if (e.date < cutoff) continue;
      cookBySlug.set(e.recipe, (cookBySlug.get(e.recipe) ?? 0) + 1);
      const prev = lastBySlug.get(e.recipe);
      if (prev == null || e.date > prev) lastBySlug.set(e.recipe, e.date);
    }

    const rows: InsightsRecipeRow[] = candidates.map((slug) => {
      const m = meta.get(slug)!;
      return {
        slug,
        title: m.title,
        cuisine: m.cuisine,
        sourceName: m.sourceName,
        favorites: favBySlug.get(slug) ?? 0,
        cooks: cookBySlug.get(slug) ?? 0,
        combined: 0,
        lastCookedLabel: relAgeLabel(today0, lastBySlug.get(slug) ?? null),
      };
    });
    const maxFav = Math.max(1, ...rows.map((r) => r.favorites));
    const maxCook = Math.max(1, ...rows.map((r) => r.cooks));
    for (const r of rows) r.combined = Math.round((r.favorites / maxFav) * 50 + (r.cooks / maxCook) * 50);

    let cooks = 0;
    const activeDays = new Set<string>();
    for (const e of activity) {
      if (e.date < cutoff) continue;
      cooks += 1;
      activeDays.add(e.date);
    }
    const favorites = rows.reduce((n, r) => n + r.favorites, 0);

    return {
      recipes: rows,
      sources: rollupSources(rows, rowDomain),
      totals: { cooks, favorites, activeDays: activeDays.size },
    };
  };

  const perWindow = {
    all: buildWindow("all"),
    year: buildWindow("year"),
    month: buildWindow("month"),
    week: buildWindow("week"),
  };
  const windowStart: Record<WindowKey, string> = {
    all: windowCutoff(today0, "all"),
    year: windowCutoff(today0, "year"),
    month: windowCutoff(today0, "month"),
    week: windowCutoff(today0, "week"),
  };

  return {
    windows: WINDOW_DEFS,
    windowStart,
    perWindow,
    heatmap: buildHeatmap(today0, today, activityByDate),
    generatedAt: nowMs,
  };
}

/** Build the trailing-53-week heatmap grid (column-major, Sun→Sat) plus its month header segments.
 *  Future days (past `today`) are omitted — they are the tail of the final column. */
function buildHeatmap(today0: number, today: string, activityByDate: Map<string, number>): InsightsHeatmap {
  const WEEKS = 53;
  const endDow = new Date(today0).getUTCDay(); // 0 = Sun … 6 = Sat
  const gridEnd = today0 + (6 - endDow) * DAY; // Saturday of this week
  const gridStart = gridEnd - (WEEKS * 7 - 1) * DAY; // Sunday, 53 weeks back

  const cells: HeatCell[] = [];
  for (let c = 0; c < WEEKS; c++) {
    for (let r = 0; r < 7; r++) {
      const at = gridStart + (c * 7 + r) * DAY;
      if (at > today0) continue; // future day — omit
      const date = utcDay(at);
      const count = activityByDate.get(date) ?? 0;
      cells.push({ date, count, level: heatLevel(count) });
    }
  }

  // Month header segments — group consecutive week-columns by their mid-week month, so a label
  // spans exactly its weeks. A single-week leading segment is left unlabelled (matches the mock).
  const months: HeatMonth[] = [];
  for (let c = 0; c < WEEKS; c++) {
    const m = new Date(gridStart + (c * 7 + 3) * DAY).getUTCMonth();
    const last = months[months.length - 1];
    if (last && last.label === MONTHS[m]) last.span += 1;
    else months.push({ label: MONTHS[m], span: 1 });
  }
  // Blank the very first label unless it owns ≥2 columns (the leading partial month is ambiguous).
  if (months.length > 0 && months[0].span < 2) months[0] = { label: "", span: months[0].span };

  return { today, weeks: WEEKS, cells, months };
}

/**
 * Read the group-wide Insights payload from D1. Four bulk reads (`cooking_log`, favorited
 * `overlay` rows, `recipes`, `feeds`) through `src/db.ts` (throw-free `storage_error`), then the
 * pure `mapInsights`. No tenant filter — the aggregate is group-wide by design (the admin surface
 * is cross-tenant). `nowMs` is injectable for tests.
 */
export async function readInsights(env: Env, nowMs: number = Date.now()): Promise<InsightsPayload> {
  const [cooks, overlay, recipes, feeds] = await Promise.all([
    db(env).all<{ date: string; type: string; recipe: string | null }>("SELECT date, type, recipe FROM cooking_log"),
    db(env).all<{ recipe: string; favorite: number | null }>("SELECT recipe, favorite FROM overlay WHERE favorite = 1"),
    db(env).all<{ slug: string; title: string | null; cuisine: string | null; source_url: string | null }>(
      "SELECT slug, title, cuisine, source_url FROM recipes",
    ),
    db(env).all<{ url: string }>("SELECT url FROM feeds"),
  ]);
  return mapInsights({ cooks, overlay, recipes, feeds }, nowMs);
}
