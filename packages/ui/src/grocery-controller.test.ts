import type { GroceryLine, GroceryListData } from "@yamp/contract";
import { describe, expect, it } from "vitest";
import { groupGroceryLines, orderedRecipeAttribution, projectGroceryAction } from "./grocery-controller";

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

  it("uses the same sorted selector for the primary recipe and +N attribution", () => {
    const subject = line("onion", {
      for_recipes: ["late", "early", "early"],
      recipe_attribution: [
        { slug: "late", planned_for: "2026-07-14", plan_id: "b" },
        { slug: "early", planned_for: "2026-07-13", plan_id: "a" },
        { slug: "early", planned_for: "2026-07-13", plan_id: "a" },
      ],
    });
    expect(orderedRecipeAttribution(subject).map((item) => item.slug)).toEqual(["early", "late"]);
    expect(groupGroceryLines([subject], "recipe")[0]?.label).toBe("early");
  });
});

const snapshot = (lines: GroceryLine[], patch: Partial<GroceryListData> = {}): GroceryListData => ({
  contract_version: 1,
  snapshot_version: "v1",
  as_of: "2026-07-12T12:00:00Z",
  lines,
  to_buy: lines.filter((item) => item.checked_at == null).map((item) => item.key),
  pantry_covered: [],
  in_cart_groups: [],
  underived: [],
  location: null,
  flyer_as_of: null,
  counts: { to_buy: lines.length, checked: 0, in_carts: 0, recipes: 0 },
  ...patch,
});

describe("grocery optimistic decision projections", () => {
  it("persists enough substitution decision state to undo an offline accept", () => {
    const before = snapshot([line("milk", { name: "Milk", display_name: "Milk" })]);
    const accepted = projectGroceryAction(before, {
      kind: "substitute",
      original_key: "milk",
      replacement_key: "oat-milk",
      replacement_name: "Oat milk",
      snapshot_version: "v1",
    });
    expect(accepted.lines.map((item) => item.key)).toEqual(["oat-milk"]);
    expect(accepted.substitution_decisions).toHaveLength(1);

    const undone = projectGroceryAction(accepted, {
      kind: "substitute_undo",
      original_key: "milk",
      snapshot_version: "v1",
    });
    expect(undone.lines).toEqual([before.lines[0]]);
    expect(undone.to_buy).toEqual(["milk"]);
    expect(undone.substitution_decisions).toEqual([]);
  });

  it("restores an original projection when Undo starts from an authoritative accepted snapshot", () => {
    const accepted = snapshot([line("oat-milk", { name: "Oat milk" })], {
      to_buy: ["oat-milk"],
      substitution_decisions: [
        {
          original_key: "milk",
          replacement_key: "oat-milk",
          attribution_signature: "plan-a",
          created_replacement: true,
          replacement_version: 1,
          row_version: 1,
          created_at: "2026-07-12",
          updated_at: "2026-07-12",
        },
      ],
    });
    const undone = projectGroceryAction(accepted, {
      kind: "substitute_undo",
      original_key: "milk",
      snapshot_version: "v1",
    });
    expect(undone.lines.map((item) => item.key)).toEqual(["milk"]);
    expect(undone.to_buy).toEqual(["milk"]);
    expect(undone.substitution_decisions).toEqual([]);
  });

  it("projects Still good onto the exact covered pantry key", () => {
    const before = snapshot([], {
      pantry_covered: [
        {
          key: "milk",
          name: "Milk",
          for_recipes: [],
          freshness: "worth_a_look",
          freshness_reason: "Old verification",
          on_hand: { last_verified_at: "2026-06-01" },
          buy_anyway: false,
        },
        {
          key: "eggs",
          name: "Eggs",
          for_recipes: [],
          freshness: "worth_a_look",
          on_hand: { last_verified_at: "2026-06-02" },
          buy_anyway: false,
        },
      ],
    });
    const after = projectGroceryAction(before, {
      kind: "pantry_verify",
      key: "milk",
      snapshot_version: "v1",
    });
    expect(after.pantry_covered[0]).toMatchObject({
      key: "milk",
      freshness: "covered",
      on_hand: { last_verified_at: "2026-07-12" },
    });
    expect(after.pantry_covered[1]).toEqual(before.pantry_covered[1]);
  });

  it("reuses an existing replacement and preserves it when undoing", () => {
    const before = snapshot([line("milk"), line("oat-milk", { row_version: 7 })]);
    const accepted = projectGroceryAction(before, {
      kind: "substitute",
      original_key: "milk",
      replacement_key: "oat-milk",
      replacement_name: "Oat milk",
      snapshot_version: "v1",
    });
    expect(accepted.lines.map((item) => item.key)).toEqual(["oat-milk"]);
    expect(accepted.substitution_decisions?.[0]).toMatchObject({
      created_replacement: false,
      replacement_version: 7,
    });
    const undone = projectGroceryAction(accepted, {
      kind: "substitute_undo",
      original_key: "milk",
      snapshot_version: "v1",
    });
    expect(undone.lines.map((item) => item.key)).toEqual(["oat-milk", "milk"]);
  });

  it("hides an existing buy-anyway row on undo without fabricating a pantry GroceryLine", () => {
    const before = snapshot([line("onion", { row_version: 5 })], {
      coverage_decisions: [
        {
          line_key: "onion",
          created_row: false,
          created_row_version: 5,
          row_version: 1,
          created_at: "2026-07-12",
          updated_at: "2026-07-12",
        },
      ],
    });
    const undone = projectGroceryAction(before, {
      kind: "pantry_undo",
      key: "onion",
      snapshot_version: "v1",
    });
    expect(undone.lines).toEqual([]);
    expect(undone.pantry_covered).toEqual([]);
    expect(undone.coverage_decisions).toEqual([]);
  });
});
