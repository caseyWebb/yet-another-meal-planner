import { describe, it, expect } from "vitest";
import { filterRecipes, type RecipeIndex } from "../src/recipes.js";

const index: RecipeIndex = {
  active1: {
    slug: "active1",
    title: "Active One",
    status: "active",
    protein: "beef",
    cuisine: "american",
    tags: ["weeknight", "beef", "one-pot"],
    season: ["fall"],
    dietary: ["dairy-free"],
    time_total: 40,
    last_cooked: null,
  },
  active2: {
    slug: "active2",
    title: "Active Two",
    status: "active",
    protein: "chicken",
    cuisine: "italian",
    tags: ["weeknight"],
    season: [],
    dietary: [],
    time_total: 90,
    last_cooked: "2026-06-05", // 3 days before the fixed now
  },
  draft1: {
    slug: "draft1",
    title: "Draft One",
    status: "draft",
    protein: "beef",
    tags: ["beef"],
    time_total: 20,
    last_cooked: "2025-01-01",
  },
};

const NOW = new Date("2026-06-08T00:00:00Z");

describe("filterRecipes", () => {
  it("defaults to active status", () => {
    const out = filterRecipes(index, {}, NOW).map((r) => r.slug);
    expect(out.sort()).toEqual(["active1", "active2"]);
  });

  it("status 'all' returns every status", () => {
    const out = filterRecipes(index, { status: "all" }, NOW).map((r) => r.slug);
    expect(out.sort()).toEqual(["active1", "active2", "draft1"]);
  });

  it("selects an explicit non-active status", () => {
    const out = filterRecipes(index, { status: "draft" }, NOW).map((r) => r.slug);
    expect(out).toEqual(["draft1"]);
  });

  it("array filters match ALL listed values (AND)", () => {
    expect(filterRecipes(index, { tags: ["weeknight", "beef"] }, NOW).map((r) => r.slug)).toEqual([
      "active1",
    ]);
    expect(filterRecipes(index, { tags: ["weeknight"] }, NOW).map((r) => r.slug).sort()).toEqual([
      "active1",
      "active2",
    ]);
  });

  it("filters by scalar fields and max_time_total", () => {
    expect(filterRecipes(index, { cuisine: "italian" }, NOW).map((r) => r.slug)).toEqual([
      "active2",
    ]);
    expect(filterRecipes(index, { max_time_total: 50 }, NOW).map((r) => r.slug)).toEqual([
      "active1",
    ]);
  });

  it("not_cooked_since admits never-cooked recipes (null last_cooked)", () => {
    const out = filterRecipes(index, { not_cooked_since: "2026-01-01" }, NOW).map((r) => r.slug);
    // active1 (null) passes; active2 cooked 2026-06-05 (>= date) is excluded.
    expect(out).toEqual(["active1"]);
  });

  it("exclude_cooked_within_days drops recently cooked, keeps never-cooked", () => {
    const out = filterRecipes(
      index,
      { status: "all", exclude_cooked_within_days: 14 },
      NOW,
    ).map((r) => r.slug);
    // active2 cooked 3 days ago -> excluded. active1 (null) and draft1 (2025) kept.
    expect(out.sort()).toEqual(["active1", "draft1"]);
  });

  it("returns slug, title, and frontmatter for matches", () => {
    const [item] = filterRecipes(index, { status: "draft" }, NOW);
    expect(item.slug).toBe("draft1");
    expect(item.title).toBe("Draft One");
    expect(item.frontmatter.protein).toBe("beef");
  });
});

const queryIndex: RecipeIndex = {
  "chicken-and-rice": {
    slug: "chicken-and-rice",
    title: "Chicken and Rice",
    status: "active",
    protein: "chicken",
    tags: ["weeknight", "comfort-food"],
    last_cooked: null,
  },
  "arroz-caldo": {
    slug: "arroz-caldo",
    title: "Arroz Caldo",
    status: "active",
    protein: "chicken",
    tags: ["chicken", "rice", "filipino"],
    last_cooked: null,
  },
  "lemon-chicken": {
    slug: "lemon-chicken",
    title: "Lemon Chicken",
    status: "active",
    protein: "chicken",
    tags: ["weeknight"],
    last_cooked: null,
  },
  "beef-stew": {
    slug: "beef-stew",
    title: "Beef Stew",
    status: "draft",
    protein: "beef",
    tags: ["comfort-food"],
    last_cooked: null,
  },
};

describe("filterRecipes query", () => {
  it("returns the exact-title named dish", () => {
    const out = filterRecipes(queryIndex, { query: "chicken rice" }, NOW).map((r) => r.slug);
    // "Chicken and Rice" (title has both tokens) and Arroz Caldo (tags have both) match.
    expect(out.sort()).toEqual(["arroz-caldo", "chicken-and-rice"]);
  });

  it("requires every token (AND) across title or tags", () => {
    // Lemon Chicken lacks the "rice" token in title and tags -> excluded.
    const out = filterRecipes(queryIndex, { query: "chicken rice" }, NOW).map((r) => r.slug);
    expect(out).not.toContain("lemon-chicken");
  });

  it("matches a token as a substring of a tag", () => {
    const out = filterRecipes(queryIndex, { query: "comfort" }, NOW).map((r) => r.slug);
    // comfort matches the comfort-food tag on chicken-and-rice (active default).
    expect(out).toEqual(["chicken-and-rice"]);
  });

  it("composes with other filters (AND)", () => {
    const out = filterRecipes(
      queryIndex,
      { query: "chicken", status: "active", protein: "chicken" },
      NOW,
    ).map((r) => r.slug);
    expect(out.sort()).toEqual(["arroz-caldo", "chicken-and-rice", "lemon-chicken"]);
  });

  it("absent or empty query preserves prior behavior", () => {
    const without = filterRecipes(queryIndex, {}, NOW).map((r) => r.slug).sort();
    const emptyQuery = filterRecipes(queryIndex, { query: "   " }, NOW).map((r) => r.slug).sort();
    expect(emptyQuery).toEqual(without);
    expect(without).toEqual(["arroz-caldo", "chicken-and-rice", "lemon-chicken"]);
  });
});
