import { describe, it, expect } from "vitest";
import { rankByKeyword, toHit, WEIGHTS } from "../src/cookbook-search.js";
import type { RecipeIndex } from "../src/recipes.js";

/** Build a RecipeIndex from loose frontmatter records (slug required). */
function index(recipes: Record<string, unknown>[]): RecipeIndex {
  const idx: RecipeIndex = {};
  for (const r of recipes) idx[String(r.slug)] = { ...r, slug: String(r.slug) };
  return idx;
}
const slugs = (hits: { slug: string }[]) => hits.map((h) => h.slug);

describe("rankByKeyword", () => {
  it("ranks a title match above a description-only match", () => {
    const idx = index([
      { slug: "bean-soup", title: "Bean Soup" },
      { slug: "green-salad", title: "Green Salad", description: "tossed with bean sprouts" },
    ]);
    expect(slugs(rankByKeyword(idx, "bean"))).toEqual(["bean-soup", "green-salad"]);
  });

  it("matches a facet value (cuisine) even when absent from the title", () => {
    const idx = index([
      { slug: "pad-thai", title: "Rice Noodles", cuisine: "thai" },
      { slug: "carbonara", title: "Carbonara", cuisine: "italian" },
    ]);
    expect(slugs(rankByKeyword(idx, "thai"))).toEqual(["pad-thai"]);
  });

  it("ranks a full-coverage match above a partial-coverage match", () => {
    const idx = index([
      { slug: "chicken-tacos", title: "Chicken Tacos" },
      { slug: "chicken-soup", title: "Chicken Soup" },
    ]);
    expect(slugs(rankByKeyword(idx, "chicken tacos"))).toEqual(["chicken-tacos", "chicken-soup"]);
  });

  it("gives a typeahead prefix of the title a boost", () => {
    const idx = index([
      { slug: "chicken-tacos", title: "Chicken Tacos" },
      { slug: "tacos-chicken", title: "Tacos with Chicken" },
    ]);
    // "chicken ta" is a literal prefix of "Chicken Tacos" → it ranks first
    expect(slugs(rankByKeyword(idx, "chicken ta"))[0]).toBe("chicken-tacos");
  });

  it("matches a partial token (typeahead), so 'chick' reaches 'Chicken'", () => {
    const idx = index([{ slug: "chicken-pie", title: "Chicken Pie" }, { slug: "beef-pie", title: "Beef Pie" }]);
    expect(slugs(rankByKeyword(idx, "chick"))).toEqual(["chicken-pie"]);
  });

  it("excludes recipes that match no query token", () => {
    const idx = index([
      { slug: "tacos", title: "Tacos" },
      { slug: "sushi", title: "Sushi" },
    ]);
    expect(slugs(rankByKeyword(idx, "tacos"))).toEqual(["tacos"]);
  });

  it("breaks score ties by title then slug", () => {
    const idx = index([
      { slug: "z", title: "Taco Bravo" },
      { slug: "a", title: "Taco Bravo" },
      { slug: "m", title: "Taco Alpha" },
    ]);
    // identical "taco" title hit → equal score; order by title (Alpha<Bravo) then slug (a<z)
    expect(slugs(rankByKeyword(idx, "taco"))).toEqual(["m", "a", "z"]);
  });

  it("returns nothing for an empty or all-stopword query", () => {
    const idx = index([{ slug: "tacos", title: "Tacos" }]);
    expect(rankByKeyword(idx, "")).toEqual([]);
    expect(rankByKeyword(idx, "   ")).toEqual([]);
    expect(rankByKeyword(idx, "and the")).toEqual([]);
  });

  it("tokenizes punctuation and hyphens cleanly", () => {
    const idx = index([{ slug: "stir-fry", title: "Stir Fry" }]);
    expect(slugs(rankByKeyword(idx, "stir-fry!"))).toEqual(["stir-fry"]);
  });

  it("keeps accented words whole, with no 1-char-token leakage", () => {
    const idx = index([
      { slug: "jalapeno-poppers", title: "Jalapeño Poppers" },
      { slug: "plain-toast", title: "Plain Toast" }, // contains an "o"
    ]);
    // "jalapeño" stays one token (not ["jalape","o"]): it matches the accented title and
    // the stray "o" no longer drags in unrelated recipes.
    expect(slugs(rankByKeyword(idx, "jalapeño"))).toEqual(["jalapeno-poppers"]);
  });

  it("earns the typeahead prefix bonus across a hyphen separator", () => {
    const idx = index([
      { slug: "chicken-tacos", title: "Chicken Tacos" },
      { slug: "tacos-chicken", title: "Tacos with Chicken" },
    ]);
    expect(slugs(rankByKeyword(idx, "chicken-ta"))[0]).toBe("chicken-tacos");
  });

  it("scores across multiple metadata fields (tags, course, ingredients)", () => {
    const idx = index([
      { slug: "a", title: "Mystery Dish", tags: ["weeknight"], course: ["main"], ingredients_key: ["lentil"] },
      { slug: "b", title: "Other Dish" },
    ]);
    expect(slugs(rankByKeyword(idx, "lentil"))).toEqual(["a"]);
    expect(slugs(rankByKeyword(idx, "weeknight"))).toEqual(["a"]);
  });

  it("weights title above description", () => {
    expect(WEIGHTS.title.word).toBeGreaterThan(WEIGHTS.description.word);
  });
});

describe("toHit", () => {
  it("falls back to the slug when the title is missing or empty", () => {
    expect(toHit({ slug: "x" }).title).toBe("x");
    expect(toHit({ slug: "x", title: "" }).title).toBe("x");
  });

  it("carries the compact render fields, coercing non-strings to null", () => {
    expect(toHit({ slug: "s", title: "T", description: "D", protein: "fish", cuisine: 7 })).toEqual({
      slug: "s",
      title: "T",
      description: "D",
      protein: "fish",
      cuisine: null,
    });
  });
});
