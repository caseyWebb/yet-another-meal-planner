import { describe, it, expect } from "vitest";
import { filterRecipes, isMealCourse, type RecipeIndex } from "../src/recipes.js";

// Entries carry the caller's effective per-tenant view (overlay-merged): `reject` is
// the only disposition the filter gates on. There is no `status` and no active set —
// visibility is opt-out, so a recipe surfaces unless the caller has rejected it.
const index: RecipeIndex = {
  visible1: {
    slug: "visible1",
    title: "Visible One",
    protein: "beef",
    cuisine: "american",
    course: ["main"],
    tags: ["weeknight", "beef", "one-pot"],
    season: ["fall"],
    dietary: ["dairy-free"],
    time_total: 40,
    last_cooked: null,
  },
  visible2: {
    slug: "visible2",
    title: "Visible Two",
    protein: "chicken",
    cuisine: "italian",
    course: ["main", "side"], // dual-use
    tags: ["weeknight"],
    season: [],
    dietary: [],
    time_total: 90,
    last_cooked: "2026-06-05", // 3 days before the fixed now
  },
  hidden1: {
    slug: "hidden1",
    title: "Hidden One",
    reject: true, // the caller rejected this — never surfaces
    protein: "beef",
    course: ["side"],
    tags: ["beef"],
    time_total: 20,
    last_cooked: "2025-01-01",
  },
};

const NOW = new Date("2026-06-08T00:00:00Z");

describe("filterRecipes", () => {
  it("returns every non-rejected recipe by default", () => {
    const out = filterRecipes(index, {}, NOW).map((r) => r.slug);
    expect(out.sort()).toEqual(["visible1", "visible2"]);
  });

  it("reject is a hard gate: a rejected recipe never surfaces, even when a filter matches it", () => {
    // hidden1 is a beef [side] recipe; neither a protein nor a course filter admits it.
    expect(filterRecipes(index, { protein: "beef" }, NOW).map((r) => r.slug)).toEqual(["visible1"]);
    expect(filterRecipes(index, { course: "side" }, NOW).map((r) => r.slug)).toEqual(["visible2"]);
  });

  it("array filters (dietary/season) match ALL listed values (AND)", () => {
    // visible1: dietary ["dairy-free"], season ["fall"]
    expect(filterRecipes(index, { dietary: ["dairy-free"] }, NOW).map((r) => r.slug)).toEqual([
      "visible1",
    ]);
    // requires BOTH values → visible1 has only "dairy-free" → excluded
    expect(filterRecipes(index, { dietary: ["dairy-free", "gluten-free"] }, NOW).map((r) => r.slug)).toEqual([]);
    expect(filterRecipes(index, { season: ["fall"] }, NOW).map((r) => r.slug)).toEqual(["visible1"]);
  });

  it("course matches by containment, including dual-use recipes", () => {
    // visible1 [main], visible2 [main, side] → both are mains
    expect(filterRecipes(index, { course: "main" }, NOW).map((r) => r.slug).sort()).toEqual([
      "visible1",
      "visible2",
    ]);
    // visible2 [main, side] is the only non-rejected side (hidden1 [side] is gated out)
    expect(filterRecipes(index, { course: "side" }, NOW).map((r) => r.slug)).toEqual(["visible2"]);
    // case/whitespace-insensitive
    expect(filterRecipes(index, { course: " Side " }, NOW).map((r) => r.slug)).toEqual(["visible2"]);
    expect(filterRecipes(index, { course: "dessert" }, NOW).map((r) => r.slug)).toEqual([]);
  });

  it("course is ANDed with other filters", () => {
    // course main AND cuisine italian → only visible2
    expect(filterRecipes(index, { course: "main", cuisine: "italian" }, NOW).map((r) => r.slug)).toEqual([
      "visible2",
    ]);
  });

  it("tags is no longer a filter — passing it is ignored", () => {
    const withTags = filterRecipes(index, { tags: ["beef"] } as never, NOW).map((r) => r.slug).sort();
    const without = filterRecipes(index, {}, NOW).map((r) => r.slug).sort();
    expect(withTags).toEqual(without);
  });

  it("filters by scalar fields and max_time_total", () => {
    expect(filterRecipes(index, { cuisine: "italian" }, NOW).map((r) => r.slug)).toEqual([
      "visible2",
    ]);
    expect(filterRecipes(index, { max_time_total: 50 }, NOW).map((r) => r.slug)).toEqual([
      "visible1",
    ]);
  });

  it("not_cooked_since admits never-cooked recipes (null last_cooked)", () => {
    const out = filterRecipes(index, { not_cooked_since: "2026-01-01" }, NOW).map((r) => r.slug);
    // visible1 (null) passes; visible2 cooked 2026-06-05 (>= date) is excluded.
    expect(out).toEqual(["visible1"]);
  });

  it("exclude_cooked_within_days drops recently cooked, keeps never-cooked", () => {
    const out = filterRecipes(index, { exclude_cooked_within_days: 14 }, NOW).map((r) => r.slug);
    // visible2 cooked 3 days ago -> excluded. visible1 (null) kept; hidden1 is rejected.
    expect(out.sort()).toEqual(["visible1"]);
  });

  it("returns slug, title, and frontmatter for matches", () => {
    const [item] = filterRecipes(index, { max_time_total: 50 }, NOW);
    expect(item.slug).toBe("visible1");
    expect(item.title).toBe("Visible One");
    expect(item.frontmatter.protein).toBe("beef");
  });
});

describe("isMealCourse — the default meal-candidate gate", () => {
  it("admits a course set containing main (alone or dual-use)", () => {
    expect(isMealCourse(["main"])).toBe(true);
    expect(isMealCourse(["main", "side"])).toBe(true);
    expect(isMealCourse(["side", "main"])).toBe(true);
  });

  it("rejects a non-empty set without main", () => {
    expect(isMealCourse(["side"])).toBe(false);
    expect(isMealCourse(["component"])).toBe(false);
    expect(isMealCourse(["baked_good"])).toBe(false);
    expect(isMealCourse(["dessert", "snack"])).toBe(false);
  });

  it("fails OPEN for an empty/missing course (not yet classified — never silently hidden)", () => {
    expect(isMealCourse([])).toBe(true);
    expect(isMealCourse(undefined)).toBe(true);
    expect(isMealCourse(null)).toBe(true);
  });

  it("tolerates a defensive scalar and case/whitespace", () => {
    expect(isMealCourse("main")).toBe(true);
    expect(isMealCourse("side")).toBe(false);
    expect(isMealCourse([" Main "])).toBe(true);
    expect(isMealCourse(["SIDE"])).toBe(false);
  });
});

const queryIndex: RecipeIndex = {
  "chicken-and-rice": {
    slug: "chicken-and-rice",
    title: "Chicken and Rice",
    protein: "chicken",
    tags: ["weeknight", "comfort-food"],
    last_cooked: null,
  },
  "arroz-caldo": {
    slug: "arroz-caldo",
    title: "Arroz Caldo",
    protein: "chicken",
    tags: ["chicken", "rice", "filipino"],
    last_cooked: null,
  },
  "lemon-chicken": {
    slug: "lemon-chicken",
    title: "Lemon Chicken",
    protein: "chicken",
    tags: ["weeknight"],
    last_cooked: null,
  },
  "beef-stew": {
    slug: "beef-stew",
    title: "Beef Stew",
    reject: true, // rejected → excluded from every result
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
    // comfort matches the comfort-food tag on chicken-and-rice (beef-stew is rejected).
    expect(out).toEqual(["chicken-and-rice"]);
  });

  it("composes with other filters (AND)", () => {
    const out = filterRecipes(
      queryIndex,
      { query: "chicken", protein: "chicken" },
      NOW,
    ).map((r) => r.slug);
    expect(out.sort()).toEqual(["arroz-caldo", "chicken-and-rice", "lemon-chicken"]);
  });

  it("absent or empty query preserves prior behavior", () => {
    const without = filterRecipes(queryIndex, {}, NOW).map((r) => r.slug).sort();
    const emptyQuery = filterRecipes(queryIndex, { query: "   " }, NOW).map((r) => r.slug).sort();
    expect(emptyQuery).toEqual(without);
    // beef-stew is rejected → the default is the three non-rejected chicken dishes.
    expect(without).toEqual(["arroz-caldo", "chicken-and-rice", "lemon-chicken"]);
  });

  it("drops connective stopwords so the natural phrase matches", () => {
    const out = filterRecipes(queryIndex, { query: "chicken and rice" }, NOW).map((r) => r.slug).sort();
    expect(out).toEqual(["arroz-caldo", "chicken-and-rice"]);
  });

  it("finds a title-only keyword (tag absent)", () => {
    const out = filterRecipes(queryIndex, { query: "rice" }, NOW).map((r) => r.slug);
    expect(out).toContain("chicken-and-rice");
  });

  it("an all-stopword query applies no text narrowing", () => {
    const out = filterRecipes(queryIndex, { query: "and the" }, NOW).map((r) => r.slug).sort();
    const without = filterRecipes(queryIndex, {}, NOW).map((r) => r.slug).sort();
    expect(out).toEqual(without);
  });
});

describe("filterRecipes makeability gate", () => {
  const gateIndex: RecipeIndex = {
    plain: { slug: "plain", title: "Plain", last_cooked: null },
    needs: {
      slug: "needs",
      title: "Sous Vide Steak",
      last_cooked: null,
      requires_equipment: ["sous-vide-circulator"],
    },
    twoNeeds: {
      slug: "twoNeeds",
      title: "Fancy",
      last_cooked: null,
      requires_equipment: ["blender", "ice-cream-maker"],
    },
  };

  it("empty owned is a no-op (unknown inventory shows everything)", () => {
    const out = filterRecipes(gateIndex, {}, NOW, []).map((r) => r.slug).sort();
    expect(out).toEqual(["needs", "plain", "twoNeeds"]);
  });

  it("drops recipes whose requires_equipment is not a subset of owned", () => {
    const out = filterRecipes(gateIndex, {}, NOW, ["blender"]).map((r) => r.slug).sort();
    // plain (needs nothing) passes; needs (sous-vide) and twoNeeds (needs ice-cream-maker too) are gated out.
    expect(out).toEqual(["plain"]);
  });

  it("keeps a recipe when owned is a superset of its requirement", () => {
    const out = filterRecipes(gateIndex, {}, NOW, ["sous-vide-circulator", "blender"])
      .map((r) => r.slug)
      .sort();
    expect(out).toEqual(["needs", "plain"]);
  });

  it("include_unmakeable returns gated recipes annotated with missing_equipment", () => {
    const out = filterRecipes(gateIndex, { include_unmakeable: true }, NOW, ["blender"]);
    const needs = out.find((r) => r.slug === "needs");
    const twoNeeds = out.find((r) => r.slug === "twoNeeds");
    const plain = out.find((r) => r.slug === "plain");
    expect(needs?.frontmatter.missing_equipment).toEqual(["sous-vide-circulator"]);
    // twoNeeds owns blender but not ice-cream-maker → only the missing one is flagged.
    expect(twoNeeds?.frontmatter.missing_equipment).toEqual(["ice-cream-maker"]);
    // a makeable recipe carries no annotation.
    expect(plain?.frontmatter.missing_equipment).toBeUndefined();
  });

  it("gate ANDs with other filters", () => {
    const out = filterRecipes(gateIndex, {}, NOW, ["blender"]).map((r) => r.slug).sort();
    expect(out).toEqual(["plain"]);
  });

  it("a rejected recipe is gated out before the makeability check", () => {
    const rejectedGate: RecipeIndex = {
      ...gateIndex,
      plain: { slug: "plain", title: "Plain", reject: true, last_cooked: null },
    };
    const out = filterRecipes(rejectedGate, {}, NOW, ["sous-vide-circulator", "blender", "ice-cream-maker"])
      .map((r) => r.slug)
      .sort();
    expect(out).toEqual(["needs", "twoNeeds"]); // plain is rejected, the other two are now makeable
  });
});
