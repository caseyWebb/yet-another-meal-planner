import { describe, it, expect } from "vitest";
import {
  findRecipe,
  normalizeRecipe,
  flattenInstructions,
  parseDurationMinutes,
  normalizeYield,
} from "../src/jsonld.js";

// Fixtures mirror the shapes the 2026-06-10 feed spike found on each validated feed.

// Budget Bytes: top-level Recipe, HowToStep, recipeYield as array, ISO durations.
const BUDGET = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "One-Pot Chili",
  recipeIngredient: ["1 lb ground beef", "1 can beans"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Brown the beef." },
    { "@type": "HowToStep", text: "Add the beans and simmer." },
  ],
  recipeYield: ["4", "4 servings"],
  totalTime: "PT30M",
  prepTime: "PT10M",
  url: "https://budgetbytes.com/chili",
};

// RecipeTin Eats: @graph wrapper, @type as array, HowToSection → HowToStep.
const RECIPETIN = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage" },
    {
      "@type": ["Recipe"],
      name: "Chicken Curry",
      recipeIngredient: ["chicken thighs", "curry powder"],
      recipeInstructions: [
        { "@type": "HowToSection", name: "Prep", itemListElement: [{ "@type": "HowToStep", text: "Chop chicken." }] },
        { "@type": "HowToSection", name: "Cook", itemListElement: [{ "@type": "HowToStep", text: "Simmer 1 hour." }] },
      ],
      recipeYield: ["6", "6 to 8"],
      totalTime: "PT70M",
    },
  ],
};

// The Kitchn: mixed HowToStep + a HowToSection whose inner items are HowToTip
// (must be skipped), seconds-form durations, numeric yield.
const KITCHN_BLOCKS = [
  { "@type": "WebSite" },
  {
    "@type": "Recipe",
    name: "Simple Soup",
    recipeIngredient: ["water", "salt"],
    recipeInstructions: [
      { "@type": "HowToStep", text: "Boil the water." },
      { "@type": "HowToSection", name: "Recipe Notes", itemListElement: [{ "@type": "HowToTip", text: "Store leftovers up to 3 days." }] },
    ],
    totalTime: "PT600S",
    prepTime: "PT3000S",
    recipeYield: 6,
  },
];

// Bon Appétit: plain-text (non-ISO) totalTime, string yield.
const BONAPPETIT = {
  "@type": "http://schema.org/Recipe",
  name: "Olive Oil Cake",
  recipeIngredient: ["flour", "olive oil"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Bake at 350." }],
  totalTime: "45 minutes",
  recipeYield: "8 servings",
};

// Plain-string recipeInstructions.
const STRING_INSTR = {
  "@type": "Recipe",
  name: "Buttered Toast",
  recipeIngredient: ["bread", "butter"],
  recipeInstructions: "Toast the bread. Spread the butter.",
};

describe("findRecipe", () => {
  it("finds a top-level Recipe", () => {
    expect(findRecipe([BUDGET])?.name).toBe("One-Pot Chili");
  });
  it("finds a Recipe inside @graph with @type as an array", () => {
    expect(findRecipe([RECIPETIN])?.name).toBe("Chicken Curry");
  });
  it("finds a Recipe across multiple blocks (The Kitchn)", () => {
    expect(findRecipe(KITCHN_BLOCKS)?.name).toBe("Simple Soup");
  });
  it("matches the schema.org/Recipe @type form", () => {
    expect(findRecipe([BONAPPETIT])?.name).toBe("Olive Oil Cake");
  });
  it("returns null when no Recipe is present", () => {
    expect(findRecipe([{ "@type": "WebPage" }, { "@type": "Article" }])).toBeNull();
  });
});

describe("flattenInstructions", () => {
  it("flattens HowToStep arrays", () => {
    expect(flattenInstructions(BUDGET.recipeInstructions)).toEqual(["Brown the beef.", "Add the beans and simmer."]);
  });
  it("flattens HowToSection itemListElement", () => {
    const recipe = findRecipe([RECIPETIN])!;
    expect(flattenInstructions(recipe.recipeInstructions)).toEqual(["Chop chicken.", "Simmer 1 hour."]);
  });
  it("skips HowToTip notes but keeps real steps", () => {
    const recipe = findRecipe(KITCHN_BLOCKS)!;
    expect(flattenInstructions(recipe.recipeInstructions)).toEqual(["Boil the water."]);
  });
  it("accepts a plain string", () => {
    expect(flattenInstructions("Toast the bread. Spread the butter.")).toEqual([
      "Toast the bread. Spread the butter.",
    ]);
  });
});

describe("parseDurationMinutes", () => {
  it("parses ISO minutes and hours", () => {
    expect(parseDurationMinutes("PT30M")).toBe(30);
    expect(parseDurationMinutes("PT1H30M")).toBe(90);
  });
  it("parses ISO seconds form", () => {
    expect(parseDurationMinutes("PT600S")).toBe(10);
    expect(parseDurationMinutes("PT3000S")).toBe(50);
  });
  it("parses plain-text durations", () => {
    expect(parseDurationMinutes("45 minutes")).toBe(45);
    expect(parseDurationMinutes("1 hour 30 minutes")).toBe(90);
  });
  it("returns null for zero/garbage/non-string", () => {
    expect(parseDurationMinutes("PT0M")).toBeNull();
    expect(parseDurationMinutes("soon")).toBeNull();
    expect(parseDurationMinutes(undefined)).toBeNull();
  });
  it("treats a bare number as minutes", () => {
    expect(parseDurationMinutes(25)).toBe(25);
  });
});

describe("normalizeYield", () => {
  it("prefers an integer from an array", () => {
    expect(normalizeYield(["4", "4 servings (¼ loaf each)"])).toBe(4);
    expect(normalizeYield(["6", "6 to 8"])).toBe(6);
  });
  it("extracts the leading integer from a string", () => {
    expect(normalizeYield("8 servings")).toBe(8);
  });
  it("passes a number through", () => {
    expect(normalizeYield(6)).toBe(6);
  });
  it("keeps a digit-free string, nulls absent", () => {
    expect(normalizeYield("a few")).toBe("a few");
    expect(normalizeYield(null)).toBeNull();
  });
});

describe("normalizeRecipe", () => {
  it("normalizes Budget Bytes", () => {
    const r = normalizeRecipe(BUDGET);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.recipe).toMatchObject({
        title: "One-Pot Chili",
        ingredients: ["1 lb ground beef", "1 can beans"],
        instructions: ["Brown the beef.", "Add the beans and simmer."],
        servings: 4,
        time_total: 30,
        time_active: 10,
        source: "https://budgetbytes.com/chili",
      });
    }
  });

  it("normalizes The Kitchn (seconds durations, tip skipped, no source)", () => {
    const r = normalizeRecipe(findRecipe(KITCHN_BLOCKS)!);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipe.instructions).toEqual(["Boil the water."]);
      expect(r.recipe.time_total).toBe(10);
      expect(r.recipe.time_active).toBe(50);
      expect(r.recipe.servings).toBe(6);
      expect(r.recipe.source).toBeNull();
    }
  });

  it("normalizes Bon Appétit's plain-text totalTime", () => {
    const r = normalizeRecipe(BONAPPETIT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipe.time_total).toBe(45);
      expect(r.recipe.servings).toBe(8);
    }
  });

  it("handles plain-string instructions", () => {
    const r = normalizeRecipe(STRING_INSTR);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recipe.instructions).toEqual(["Toast the bread. Spread the butter."]);
  });

  it("surfaces schema.org tool as a non-authoritative tools_hint (HowToTool objects and strings)", () => {
    const base = { recipeIngredient: ["1 thing"], recipeInstructions: ["do it"] };
    const objs = normalizeRecipe({
      ...base,
      tool: [
        { "@type": "HowToTool", name: "Blender" },
        { "@type": "HowToTool", name: "Mixing bowl" },
      ],
    });
    expect(objs.ok && objs.recipe.tools_hint).toEqual(["Blender", "Mixing bowl"]);
    const strs = normalizeRecipe({ ...base, tool: ["Whisk", "Sauté pan"] });
    expect(strs.ok && strs.recipe.tools_hint).toEqual(["Whisk", "Sauté pan"]);
  });

  it("omits tools_hint when the page lists no tool", () => {
    const r = normalizeRecipe({ recipeIngredient: ["1 thing"], recipeInstructions: ["do it"] });
    expect(r.ok && "tools_hint" in r.recipe).toBe(false);
  });

  it("falls back to prep+cook when totalTime is absent", () => {
    const r = normalizeRecipe({
      "@type": "Recipe",
      name: "X",
      recipeIngredient: ["a"],
      recipeInstructions: [{ "@type": "HowToStep", text: "do" }],
      prepTime: "PT15M",
      cookTime: "PT45M",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recipe.time_total).toBe(60);
  });

  it("reports missing instructions", () => {
    const r = normalizeRecipe({ "@type": "Recipe", name: "X", recipeIngredient: ["a"], recipeInstructions: [] });
    expect(r).toEqual({ ok: false, missing: ["instructions"] });
  });

  it("reports missing ingredients", () => {
    const r = normalizeRecipe({
      "@type": "Recipe",
      name: "X",
      recipeInstructions: [{ "@type": "HowToStep", text: "do" }],
    });
    expect(r).toEqual({ ok: false, missing: ["ingredients"] });
  });
});
