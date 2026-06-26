import { describe, it, expect } from "vitest";
import { retrospective, periodDays } from "../src/retrospective.js";
import type { CookingLogEntry } from "../src/cooking-log.js";
import type { RecipeIndex } from "../src/recipes.js";

const NOW = new Date("2026-06-30T12:00:00Z");

const index: RecipeIndex = {
  salmon: { slug: "salmon", title: "Salmon", protein: "fish", cuisine: "american", last_cooked: "2026-06-20" },
  tacos: { slug: "tacos", title: "Tacos", protein: "beef", cuisine: "mexican", last_cooked: "2026-06-10" },
  stew: { slug: "stew", title: "Stew", protein: "beef", cuisine: "french", last_cooked: null },
  hidden: { slug: "hidden", title: "Hidden", protein: "pork", cuisine: "american", reject: true, last_cooked: null },
};

// protein/cuisine are pre-resolved on each entry by the caller (the D1
// `cooking_log LEFT JOIN recipes` + COALESCE): recipe entries carry their recipe's
// dims, non-recipe entries their inline dims.
const entries: CookingLogEntry[] = [
  { date: "2026-06-20", type: "recipe", recipe: "salmon", protein: "fish", cuisine: "american" },
  { date: "2026-06-10", type: "recipe", recipe: "tacos", protein: "beef", cuisine: "mexican" },
  { date: "2026-06-12", type: "recipe", recipe: "tacos", protein: "beef", cuisine: "mexican" },
  { date: "2026-06-15", type: "ready_to_eat", name: "frozen lasagna", protein: "beef", cuisine: "italian" },
  { date: "2026-06-18", type: "ad_hoc", name: "fried rice", protein: "mixed" },
  { date: "2026-01-01", type: "recipe", recipe: "salmon", protein: "fish", cuisine: "american" }, // outside a 30d window
];

describe("periodDays", () => {
  it("parses Nd, named windows, and all", () => {
    expect(periodDays("30d")).toBe(30);
    expect(periodDays("week")).toBe(7);
    expect(periodDays("quarter")).toBe(90);
    expect(periodDays("all")).toBeNull();
    expect(periodDays("nonsense")).toBe(30);
  });
});

describe("retrospective", () => {
  it("counts every cook event in protein_mix, not one per recipe", () => {
    const r = retrospective(entries, index, "30d", NOW);
    // tacos cooked twice (beef x2) + lasagna beef = 3 beef; salmon fish = 1; ad_hoc mixed = 1
    expect(r.protein_mix.beef).toBe(3);
    expect(r.protein_mix.fish).toBe(1);
    expect(r.protein_mix.mixed).toBe(1);
  });

  it("excludes the out-of-window entry", () => {
    const r = retrospective(entries, index, "30d", NOW);
    const salmon = r.recipes_cooked.find((x) => x.recipe === "salmon")!;
    expect(salmon.count).toBe(1); // the Jan entry is excluded
  });

  it("cadence counts recipe+ad_hoc only; convenience is ready_to_eat", () => {
    const r = retrospective(entries, index, "30d", NOW);
    // in-window cooking events: salmon(1) + tacos(2) + ad_hoc(1) = 4
    expect(r.cadence.cooks).toBe(4);
    expect(r.cook_vs_convenience).toEqual({ cooked: 4, convenience: 1 });
  });

  it("ranks ready_to_eat favorites by frequency", () => {
    const r = retrospective(
      [
        { date: "2026-06-10", type: "ready_to_eat", name: "lasagna" },
        { date: "2026-06-12", type: "ready_to_eat", name: "lasagna" },
        { date: "2026-06-13", type: "ready_to_eat", name: "burrito" },
      ],
      index,
      "30d",
      NOW,
    );
    expect(r.ready_to_eat_favorites).toEqual([
      { name: "lasagna", count: 2 },
      { name: "burrito", count: 1 },
    ]);
  });

  it("surfaces underused non-rejected recipes (never-cooked + stale), excluding rejected", () => {
    const r = retrospective(entries, index, "7d", NOW); // window starts 2026-06-23
    const slugs = r.underused.map((u) => u.slug);
    expect(slugs).toContain("stew"); // never cooked
    expect(slugs).toContain("salmon"); // last cooked 06-20, before window
    expect(slugs).toContain("tacos");
    expect(slugs).not.toContain("hidden"); // rejected → excluded from rotation
    // never-cooked sorts first
    expect(r.underused[0].slug).toBe("stew");
  });

  it("buckets missing dimensions under unknown", () => {
    const r = retrospective(
      [{ date: "2026-06-15", type: "ad_hoc", name: "leftovers" }],
      index,
      "30d",
      NOW,
    );
    expect(r.protein_mix.unknown).toBe(1);
    expect(r.cuisine_mix.unknown).toBe(1);
  });
});
