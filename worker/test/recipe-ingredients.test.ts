import { describe, it, expect } from "vitest";
import { parseRecipeIngredient, extractIngredientLines } from "../src/recipe-ingredients.js";

describe("parseRecipeIngredient", () => {
  it("reduces a fully annotated line to a clean name", () => {
    expect(
      parseRecipeIngredient("1.25 lbs. boneless, skinless chicken thighs (4-5 thighs) ($4.59)", {}),
    ).toEqual({ name: "chicken thighs", optional: false });
  });

  it("strips a trailing prep clause and the price", () => {
    expect(parseRecipeIngredient("1 yellow onion, diced ($0.32)", {})).toEqual({
      name: "yellow onion",
      optional: false,
    });
  });

  it("strips a parenthetical directive but keeps the name", () => {
    expect(parseRecipeIngredient("1 cup long-grain white rice (uncooked) ($0.32)", {})).toEqual({
      name: "long-grain white rice",
      optional: false,
    });
  });

  it("keeps a meaningful leading word that is not a descriptor", () => {
    expect(parseRecipeIngredient("2 Tbsp cooking oil, divided ($0.08)", {})).toEqual({
      name: "cooking oil",
      optional: false,
    });
  });

  it("flags an optional garnish and does not leak the marker into the name", () => {
    expect(parseRecipeIngredient("1 Tbsp chopped parsley (optional garnish) ($0.10)", {})).toEqual({
      name: "parsley",
      optional: true,
    });
  });

  it("flags 'to taste' as optional", () => {
    expect(parseRecipeIngredient("salt, to taste", {})).toMatchObject({ optional: true });
  });

  it("applies aliases via normalizeIngredient", () => {
    expect(parseRecipeIngredient("2 Tbsp EVOO", { EVOO: "olive oil" })).toEqual({
      name: "olive oil",
      optional: false,
    });
  });

  it("does not strip a state word that changes the pantry item", () => {
    expect(parseRecipeIngredient("1 lb ground beef", {})).toEqual({
      name: "ground beef",
      optional: false,
    });
  });
});

describe("extractIngredientLines", () => {
  const body = [
    "Some intro prose.",
    "",
    "## Ingredients",
    "",
    "- 1 yellow onion, diced",
    "- 2 cloves garlic, minced",
    "",
    "## Instructions",
    "",
    "1. Cook it.",
  ].join("\n");

  it("returns the bullet lines under ## Ingredients only", () => {
    expect(extractIngredientLines(body)).toEqual([
      "1 yellow onion, diced",
      "2 cloves garlic, minced",
    ]);
  });

  it("returns null when there is no ## Ingredients section", () => {
    expect(extractIngredientLines("## Instructions\n- step")).toBeNull();
  });
});
