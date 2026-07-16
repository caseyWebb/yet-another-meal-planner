import { describe, it, expect } from "vitest";
import { mapInsights, rankRows, domainOf, type InsightsInput } from "../src/insights.js";

// A fixed "now" so windowing/heatmap output is deterministic.
const NOW = Date.parse("2026-07-01T12:00:00Z");
const DAY = 86_400_000;

/** The `YYYY-MM-DD` day string `n` days before 2026-07-01 (UTC). */
function dayAgo(n: number): string {
  return new Date(Date.parse("2026-07-01T00:00:00Z") - n * DAY).toISOString().slice(0, 10);
}

function input(over: Partial<InsightsInput> = {}): InsightsInput {
  return { cooks: [], overlay: [], recipes: [], feeds: [], ...over };
}

describe("mapInsights — window scoping", () => {
  const base = input({
    recipes: [{ slug: "dal", title: "Red Lentil Dal", cuisine: "Indian", source_url: "https://cooking.nytimes.com/x" }],
    // cooked today, 5d ago, 20d ago, 200d ago
    cooks: [dayAgo(0), dayAgo(5), dayAgo(20), dayAgo(200)].map((date) => ({ date, type: "recipe", recipe: "dal" })),
    overlay: [
      { recipe: "dal", favorite: 1 },
      { recipe: "dal", favorite: 1 },
      { recipe: "dal", favorite: 1 },
    ],
  });

  it("scopes times-cooked to the selected window", () => {
    const p = mapInsights(base, NOW);
    const cooks = (w: "all" | "year" | "month" | "week") => p.perWindow[w].recipes.find((r) => r.slug === "dal")!.cooks;
    expect(cooks("week")).toBe(2); // today + 5d ago
    expect(cooks("month")).toBe(3); // + 20d ago
    expect(cooks("year")).toBe(4); // + 200d ago
    expect(cooks("all")).toBe(4);
  });

  it("keeps favorites identical across every window (favorites are current state)", () => {
    const p = mapInsights(base, NOW);
    for (const w of ["all", "year", "month", "week"] as const) {
      expect(p.perWindow[w].recipes.find((r) => r.slug === "dal")!.favorites).toBe(3);
    }
  });

  it("reports the most-recent in-window cook as the last-cooked label", () => {
    const p = mapInsights(base, NOW);
    expect(p.perWindow.week.recipes.find((r) => r.slug === "dal")!.lastCookedLabel).toBe("today");
  });
});

describe("mapInsights — cook-type semantics", () => {
  const p = mapInsights(
    input({
      recipes: [{ slug: "dal", title: "Dal", cuisine: null, source_url: null }],
      cooks: [
        { date: dayAgo(0), type: "recipe", recipe: "dal" },
        { date: dayAgo(0), type: "ad_hoc", recipe: null }, // home cooking, not a corpus recipe
        { date: dayAgo(0), type: "ready_to_eat", recipe: null }, // historical row (retired type, remove-ready-to-eat) — excluded, never errors
        { date: dayAgo(1), type: "recipe", recipe: "ghost" }, // slug not in the corpus — ignored by boards
      ],
    }),
    NOW,
  );

  it("counts recipe + ad_hoc toward the Cook-events total, excluding a historical ready_to_eat row", () => {
    expect(p.perWindow.all.totals.cooks).toBe(3); // recipe + ad_hoc + ghost-recipe; not the retired ready_to_eat row
  });

  it("does not credit ad_hoc or out-of-corpus cooks to any recipe's times-cooked", () => {
    expect(p.perWindow.all.recipes.find((r) => r.slug === "dal")!.cooks).toBe(1);
    expect(p.perWindow.all.recipes.some((r) => r.slug === "ghost")).toBe(false);
  });

  it("counts the ad_hoc day toward the heatmap", () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    expect(p.heatmap.cells.find((c) => c.date === today)!.count).toBe(2); // recipe + ad_hoc on today
  });
});

describe("rankRows — metric + combined tiebreak", () => {
  const rows = [
    { slug: "a", favorites: 2, cooks: 5, combined: 40 },
    { slug: "b", favorites: 9, cooks: 1, combined: 60 },
    { slug: "c", favorites: 9, cooks: 1, combined: 80 }, // ties b on favorites, wins on combined
  ];
  it("ranks by cooks when sort=cooks", () => {
    expect(rankRows(rows, "cooks").map((r) => r.slug)).toEqual(["a", "c", "b"]);
  });
  it("ranks by favorites, breaking ties with combined", () => {
    expect(rankRows(rows, "favorites").map((r) => r.slug)).toEqual(["c", "b", "a"]);
  });
});

describe("mapInsights — source rollup", () => {
  const p = mapInsights(
    input({
      recipes: [
        { slug: "dal", title: "Dal", cuisine: "Indian", source_url: "https://www.seriouseats.com/dal" },
        { slug: "cake", title: "Apple Cake", cuisine: "American", source_url: null }, // member-authored
        { slug: "pizza", title: "Margherita", cuisine: "Italian", source_url: "https://smittenkitchen.com/pizza" },
      ],
      cooks: [
        { date: dayAgo(1), type: "recipe", recipe: "dal" },
        { date: dayAgo(1), type: "recipe", recipe: "cake" },
        { date: dayAgo(1), type: "recipe", recipe: "pizza" },
      ],
      overlay: [{ recipe: "cake", favorite: 1 }],
      feeds: [{ url: "https://smittenkitchen.com/feed" }], // pizza's domain is a discovery feed
    }),
    NOW,
  );
  const sources = p.perWindow.all.sources;

  it("groups member-authored recipes into their own bucket", () => {
    const member = sources.find((s) => s.key === "__member__")!;
    expect(member.isMember).toBe(true);
    expect(member.recipeCount).toBe(1);
    expect(member.recipes[0].slug).toBe("cake");
  });

  it("tags a source whose domain matches a discovery feed", () => {
    expect(sources.find((s) => s.domain === "smittenkitchen.com")!.isFeed).toBe(true);
    expect(sources.find((s) => s.domain === "seriouseats.com")!.isFeed).toBe(false);
  });

  it("resolves a friendly source name and strips www.", () => {
    expect(sources.find((s) => s.domain === "seriouseats.com")!.name).toBe("Serious Eats");
  });
});

describe("mapInsights — heatmap + empty state", () => {
  it("builds a trailing-53-week grid with no future days", () => {
    const p = mapInsights(input(), NOW);
    const today = new Date(NOW).toISOString().slice(0, 10);
    expect(p.heatmap.weeks).toBe(53);
    expect(p.heatmap.cells.length).toBeGreaterThan(52 * 7); // full grid minus this week's future tail
    expect(p.heatmap.cells.every((c) => c.date <= today)).toBe(true);
    expect(p.heatmap.cells.at(-1)!.date).toBe(today); // last cell is today
  });

  it("returns well-formed zero-filled windows on empty input, never throwing", () => {
    const p = mapInsights(input(), NOW);
    for (const w of ["all", "year", "month", "week"] as const) {
      expect(p.perWindow[w].recipes).toEqual([]);
      expect(p.perWindow[w].sources).toEqual([]);
      expect(p.perWindow[w].totals).toEqual({ cooks: 0, favorites: 0, activeDays: 0 });
    }
    expect(p.heatmap.cells.every((c) => c.level === 0)).toBe(true);
  });
});

describe("domainOf", () => {
  it("lowercases the host and strips a leading www.", () => {
    expect(domainOf("https://WWW.Food52.com/recipes/1")).toBe("food52.com");
  });
  it("returns null for absent or malformed URLs (→ member-authored bucket)", () => {
    expect(domainOf(null)).toBeNull();
    expect(domainOf("not a url")).toBeNull();
    expect(domainOf("")).toBeNull();
  });
});
