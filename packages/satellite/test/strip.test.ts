import { describe, expect, it } from "vitest";
import type { NormalizedRecipe } from "@grocery-agent/contract";
import { toRecipeItem } from "../src/strip.js";

const base: NormalizedRecipe = {
  title: "Test Bake",
  ingredients: ["1 cup flour", "2 eggs"],
  instructions: ["Mix.", "Bake."],
  servings: 4,
  time_total: 45,
  time_active: 15,
  source: "https://paid.example/recipes/test-bake",
  tools_hint: ["whisk", "8-inch pan"],
};

describe("toRecipeItem", () => {
  it("keeps only functional facts (no tools_hint, no prose fields)", () => {
    const item = toRecipeItem(base, "https://fallback.example/x");
    expect(item).toEqual({
      title: "Test Bake",
      ingredients: ["1 cup flour", "2 eggs"],
      instructions: ["Mix.", "Bake."],
      source: "https://paid.example/recipes/test-bake",
      servings: 4,
      time_total: 45,
      time_active: 15,
    });
    // tools_hint is a classifier hint, not a wire fact — it must be dropped.
    expect("tools_hint" in item).toBe(false);
  });

  it("falls back to the fetch URL when the recipe carries no source", () => {
    const item = toRecipeItem({ ...base, source: null }, "https://fallback.example/x");
    expect(item.source).toBe("https://fallback.example/x");
  });

  it("elides null/absent optional facts", () => {
    const item = toRecipeItem(
      { ...base, servings: null, time_total: null, time_active: null },
      "https://fallback.example/x",
    );
    expect("servings" in item).toBe(false);
    expect("time_total" in item).toBe(false);
    expect("time_active" in item).toBe(false);
  });

  it("carries a string servings value through", () => {
    const item = toRecipeItem({ ...base, servings: "makes 2 dozen" }, "https://fallback.example/x");
    expect(item.servings).toBe("makes 2 dozen");
  });
});
