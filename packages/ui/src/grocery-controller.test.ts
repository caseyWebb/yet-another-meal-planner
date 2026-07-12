import { describe, expect, it } from "vitest";
import type { GroceryLine } from "@yamp/contract";
import { groupGroceryLines } from "./grocery-controller";

const line = (key: string, patch: Partial<GroceryLine> = {}): GroceryLine => ({
  key,
  name: key,
  quantity: 1,
  kind: "grocery",
  domain: "grocery",
  origin: "list",
  checked_at: null,
  row_version: 1,
  updated_at: null,
  for_recipes: [],
  ...patch,
});

describe("grocery grouping selectors", () => {
  it("orders Department by aisle with Household and Not mapped fallbacks", () => {
    const groups = groupGroceryLines(
      [
        line("apple", { placement: { section: "Produce", aisle_number: "8" } }),
        line("milk", { placement: { section: "Dairy", aisle_number: "2" } }),
        line("towels", { kind: "household" }),
        line("saffron"),
      ],
      "department",
    );
    expect(groups.map((g) => g.label)).toEqual(["Dairy", "Produce", "Household", "Not mapped"]);
  });

  it("assigns a multi-recipe line once to its first stable recipe", () => {
    const groups = groupGroceryLines(
      [
        line("onion", {
          for_recipes: ["late", "early"],
          recipe_attribution: [
            { slug: "late", planned_for: "2026-07-14", plan_id: "b" },
            { slug: "early", planned_for: "2026-07-13", plan_id: "a" },
          ],
        }),
        line("salt"),
      ],
      "recipe",
    );
    expect(groups.map((g) => g.label)).toEqual(["early", "No recipe"]);
    expect(groups.flatMap((g) => g.lines.map((x) => x.key))).toEqual(["onion", "salt"]);
  });

  it("orders recipe groups by planned date then plan id rather than alphabetically", () => {
    const groups = groupGroceryLines(
      [
        line("later-alpha", {
          for_recipes: ["alpha"],
          recipe_attribution: [{ slug: "alpha", planned_for: "2026-07-14", plan_id: "a" }],
        }),
        line("early-zulu", {
          for_recipes: ["zulu"],
          recipe_attribution: [{ slug: "zulu", planned_for: "2026-07-13", plan_id: "z" }],
        }),
      ],
      "recipe",
    );
    expect(groups.map((group) => group.label)).toEqual(["zulu", "alpha"]);
  });
});
