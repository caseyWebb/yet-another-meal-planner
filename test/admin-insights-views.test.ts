// SSR tests for the Insights area (group-insights): the shared InsightsView renders correctly at
// its default (SSR) state — window pills, summary tiles, the cooking-activity heatmap (with
// out-of-window dimming), the recipe + source leaderboards, deep-links, and source expand — and
// the InsightsPage shell emits the island's props block + script.

import { describe, it, expect } from "vitest";
import { InsightsView, InsightsPage } from "../src/admin/pages/insights.js";
import { mapInsights, type InsightsInput } from "../src/insights.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();
const NOW = Date.parse("2026-07-01T12:00:00Z");
const DAY = 86_400_000;
const dayAgo = (n: number): string => new Date(Date.parse("2026-07-01T00:00:00Z") - n * DAY).toISOString().slice(0, 10);

const payload = mapInsights(
  {
    recipes: [
      { slug: "pizza", title: "Margherita", cuisine: "Italian", source_url: "https://smittenkitchen.com/pizza" },
      { slug: "cake", title: "Apple Cake", cuisine: "American", source_url: null }, // member-authored
    ],
    cooks: [
      { date: dayAgo(0), type: "recipe", recipe: "pizza" },
      { date: dayAgo(3), type: "recipe", recipe: "pizza" },
      { date: dayAgo(0), type: "recipe", recipe: "cake" },
      { date: dayAgo(0), type: "ad_hoc", recipe: null },
    ],
    overlay: [
      { recipe: "pizza", favorite: 1 },
      { recipe: "pizza", favorite: 1 },
      { recipe: "cake", favorite: 1 },
    ],
    feeds: [{ url: "https://smittenkitchen.com/feed" }],
  } satisfies InsightsInput,
  NOW,
);

describe("InsightsView — default SSR render", () => {
  const html = render(InsightsView({ payload, win: "all", sort: "cooks", openSource: null }));

  it("renders the window pills and the section labels", () => {
    expect(html).toContain("All time");
    expect(html).toContain("Week");
    expect(html).toContain("Cooking activity");
    expect(html).toContain("Most popular recipes");
    expect(html).toContain("Top sources");
  });

  it("renders the four summary tiles", () => {
    for (const label of ["Cook events", "Favorites", "Top recipe", "Top source"]) {
      expect(html).toContain(label);
    }
  });

  it("renders the cooking-activity heatmap", () => {
    expect(html).toContain("cal-wrap");
    expect(html).toMatch(/cal-cell lvl-\d/);
  });

  it("deep-links a recipe row to the Data explorer", () => {
    expect(html).toContain('href="/admin/data/recipes/pizza"');
    expect(html).toContain("Margherita");
  });

  it("tags a discovery-feed source and badges the member-authored bucket", () => {
    expect(html).toContain("discovery feed"); // smittenkitchen.com is a configured feed
    expect(html).toContain("authored in-group"); // cake has no source_url
  });
});

describe("InsightsView — window + expand state", () => {
  it("dims heatmap days outside a narrow window", () => {
    const html = render(InsightsView({ payload, win: "week", sort: "cooks", openSource: null }));
    // The grid always spans 53 weeks; days older than the week window carry the `out` class.
    expect(html).toMatch(/cal-cell lvl-\d out/);
  });

  it("reveals a source's recipes when it is expanded", () => {
    const collapsed = render(InsightsView({ payload, win: "all", sort: "cooks", openSource: null }));
    expect(collapsed).not.toContain("ins-sub-recipes");
    const expanded = render(InsightsView({ payload, win: "all", sort: "cooks", openSource: "smittenkitchen.com" }));
    expect(expanded).toContain("ins-sub-recipes");
    expect(expanded).toContain('href="/admin/data/recipes/pizza"');
  });
});

describe("InsightsPage — island wiring", () => {
  const html = render(InsightsPage({ payload }));

  it("emits the island host, the props block, and the island script", () => {
    expect(html).toContain('id="insights-island"');
    expect(html).toContain('id="insights-props"');
    expect(html).toContain('src="/admin/islands/insights.js"');
  });

  it("seeds the props block with the serialized payload (escaping < )", () => {
    expect(html).toContain('"perWindow"');
    expect(html).not.toContain("</script></script>");
  });
});
