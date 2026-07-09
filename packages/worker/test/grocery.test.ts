import { describe, it, expect } from "vitest";
import {
  addToGroceryList,
  removeGroceryItem,
  updateGroceryItem,
  isFoodItem,
  normalizeName,
  type GroceryItem,
  illegalStatusTransition,
} from "../src/grocery.js";

const TODAY = "2026-06-09";

// A stub IngredientContext.resolve that merges scallion surface forms onto one id; every
// other term degrades to normalizeName (the funnel's miss behavior).
const stubResolve = (n: string): string =>
  ({ scallions: "green onion", "green onions": "green onion" })[n.trim().toLowerCase()] ?? normalizeName(n);

function base(): GroceryItem[] {
  return [
    {
      name: "olive oil",
      quantity: "1 bottle",
      kind: "grocery",
      domain: "grocery",
      status: "active",
      source: "menu",
      for_recipes: ["pasta"],
      note: null,
      added_at: "2026-06-01",
      ordered_at: null,
    },
  ];
}

describe("isFoodItem", () => {
  it("is true only when kind and domain are both grocery/absent", () => {
    expect(isFoodItem()).toBe(true); // defaults → food
    expect(isFoodItem("grocery", "grocery")).toBe(true);
    expect(isFoodItem("grocery", undefined)).toBe(true);
    expect(isFoodItem(undefined, "grocery")).toBe(true);
    // A non-grocery domain excludes even a grocery kind (the pharmacy edge case).
    expect(isFoodItem("grocery", "pharmacy")).toBe(false);
    // A non-grocery kind excludes.
    expect(isFoodItem("household", "grocery")).toBe(false);
    expect(isFoodItem("other", "grocery")).toBe(false);
    expect(isFoodItem("household")).toBe(false);
  });
});

describe("food-guarded funnel dedup", () => {
  it("a food add merges surface-form variants when a resolver is injected", () => {
    const seed = addToGroceryList([], { name: "scallions" }, TODAY, stubResolve).items;
    const { items, merged } = addToGroceryList(seed, { name: "green onions", for_recipes: ["stir-fry"] }, TODAY, stubResolve);
    expect(merged).toBe(true); // both resolve to `green onion`
    expect(items).toHaveLength(1);
    expect(items[0].for_recipes).toEqual(["stir-fry"]);
  });

  it("a non-food item is keyed by normalizeName, never resolved (no cross-form merge)", () => {
    // Even though the resolver knows nothing about batteries, a household item must stay on
    // normalizeName — and two distinct household names must NOT collapse.
    const seed = addToGroceryList([], { name: "AA batteries", kind: "household" }, TODAY, stubResolve).items;
    const { items, merged } = addToGroceryList(seed, { name: "AAA batteries", kind: "household" }, TODAY, stubResolve);
    expect(merged).toBe(false);
    expect(items).toHaveLength(2);
    // Re-adding the SAME household name still merges by normalizeName.
    const reAdd = addToGroceryList(items, { name: "aa batteries", kind: "household" }, TODAY, stubResolve);
    expect(reAdd.merged).toBe(true);
    expect(reAdd.items).toHaveLength(2);
  });

  it("remove finds a food row across surface forms via the injected resolver", () => {
    const seed = addToGroceryList([], { name: "scallions" }, TODAY, stubResolve).items;
    const { items, found } = removeGroceryItem(seed, "green onions", stubResolve);
    expect(found).toBe(true);
    expect(items).toHaveLength(0);
  });

  it("update patches a food row addressed by a different surface form", () => {
    const seed = addToGroceryList([], { name: "scallions" }, TODAY, stubResolve).items;
    const { item } = updateGroceryItem(seed, "green onions", { status: "in_cart" }, stubResolve);
    expect(item.status).toBe("in_cart");
  });
});

describe("addToGroceryList", () => {
  it("creates a new item with active defaults and no SKU field", () => {
    const { items, item, merged } = addToGroceryList([], { name: "Paper Towels", kind: "household" }, TODAY);
    expect(merged).toBe(false);
    expect(items).toHaveLength(1);
    expect(item.status).toBe("active");
    expect(item.kind).toBe("household");
    expect(item.source).toBe("ad_hoc");
    expect(item.added_at).toBe(TODAY);
    expect(item.ordered_at).toBeNull();
    expect("sku" in item).toBe(false);
  });

  it("merges into an existing same-name item (union for_recipes) instead of duplicating", () => {
    const { items, item, merged } = addToGroceryList(
      base(),
      { name: "Olive Oil", for_recipes: ["risotto"], quantity: "2 bottles" },
      TODAY,
    );
    expect(merged).toBe(true);
    expect(items).toHaveLength(1);
    expect(item.for_recipes.sort()).toEqual(["pasta", "risotto"]);
    expect(item.quantity).toBe("2 bottles");
  });

  it("normalizes names for matching", () => {
    expect(normalizeName("  Olive   Oil ")).toBe("olive oil");
  });

  it("defaults domain to grocery, and round-trips a non-grocery domain", () => {
    const plain = addToGroceryList([], { name: "milk" }, TODAY).item;
    expect(plain.domain).toBe("grocery");
    const lumber = addToGroceryList([], { name: "2x4 lumber", domain: "home-improvement" }, TODAY).item;
    expect(lumber.domain).toBe("home-improvement");
  });

  it("a merge preserves the existing domain unless a new one is supplied", () => {
    const homeItem = addToGroceryList([], { name: "wood glue", domain: "home-improvement" }, TODAY).items;
    const reAdd = addToGroceryList(homeItem, { name: "Wood Glue", quantity: "2" }, TODAY).item;
    expect(reAdd.domain).toBe("home-improvement"); // not reset to grocery
  });
});

describe("add-by-id + keep-first merge (reify-ingredient-display-names, coupling #2)", () => {
  it("keys an add-by-id row on the id but stores the DISPLAY as name (display_name null), dedups a second add on that stored id", () => {
    // Add-by-id keys on the id (`normalized_name`) and stores the caller-supplied human DISPLAY as
    // `name` — the two are stored separately, so the row keys on the id while rendering a clean name;
    // `display_name` is null. A second add-by-id dedups on the STORED id (coupling #2), not a
    // re-derivation of the posted surface form; keep-first preserves the surviving display.
    const first = addToGroceryList([], { id: "cabbage::color-red", name: "Red cabbage" }, TODAY, stubResolve);
    expect(first.merged).toBe(false);
    expect(first.item.normalized_name).toBe("cabbage::color-red"); // the id is the key
    expect(first.item.name).toBe("Red cabbage"); // the DISPLAY, not the raw id
    expect(first.item.name).not.toContain("::");
    expect(first.item.display_name).toBeNull();

    const second = addToGroceryList(
      first.items,
      { id: "cabbage::color-red", name: "red cabbage", display_name: "Red Cabbage!!", for_recipes: ["slaw"] },
      TODAY,
      stubResolve,
    );
    expect(second.merged).toBe(true); // matched the STORED id, not resolve("red cabbage")
    expect(second.items).toHaveLength(1);
    // Keep-first: the surviving row keeps its original name / display_name / key.
    expect(second.item.name).toBe("Red cabbage");
    expect(second.item.display_name).toBeNull();
    expect(second.item.normalized_name).toBe("cabbage::color-red");
    expect(second.item.for_recipes).toEqual(["slaw"]);
  });

  it("a food re-add is keep-first: the surviving row's name/display_name survive the merge", () => {
    const existing: GroceryItem[] = [
      {
        name: "Scallions",
        normalized_name: "green onion",
        display_name: "Scallions",
        quantity: "1",
        kind: "grocery",
        domain: "grocery",
        status: "active",
        source: "menu",
        for_recipes: ["stir-fry"],
        note: null,
        added_at: "2026-06-01",
        ordered_at: null,
      },
    ];
    // "green onions" resolves to the same canonical id ("green onion") as the stored "Scallions" row.
    const { item, merged } = addToGroceryList(existing, { name: "green onions", for_recipes: ["soup"] }, TODAY, stubResolve);
    expect(merged).toBe(true);
    expect(item.name).toBe("Scallions"); // NOT overwritten with the incoming surface form
    expect(item.display_name).toBe("Scallions");
    expect(item.normalized_name).toBe("green onion");
    expect(item.for_recipes.sort()).toEqual(["soup", "stir-fry"]);
  });
});

describe("updateGroceryItem", () => {
  it("patches an existing item", () => {
    const { item } = updateGroceryItem(base(), "olive oil", { status: "in_cart" });
    expect(item.status).toBe("in_cart");
  });

  it("throws when the item is absent", () => {
    expect(() => updateGroceryItem(base(), "ghee", { status: "ordered" })).toThrow();
  });
});

describe("removeGroceryItem", () => {
  it("removes a present item", () => {
    const { items, found } = removeGroceryItem(base(), "olive oil");
    expect(found).toBe(true);
    expect(items).toHaveLength(0);
  });

  it("reports not found without changing the list", () => {
    const list = base();
    const { items, found } = removeGroceryItem(list, "ghee");
    expect(found).toBe(false);
    expect(items).toBe(list);
  });
});

describe("illegalStatusTransition (W3 guard matrix)", () => {
  const legal: [string, string][] = [
    ["active", "active"],
    ["active", "in_cart"],
    ["in_cart", "active"],
    ["in_cart", "in_cart"],
    ["in_cart", "ordered"], // the user-asserted order-placed advance
    ["ordered", "active"], // re-listing a canceled order
    ["ordered", "in_cart"],
  ];
  it.each(legal)("allows %s → %s", (from, to) => {
    expect(illegalStatusTransition(from as never, to as never)).toBeNull();
  });

  const illegal: [string, string][] = [
    ["active", "ordered"], // minting ordered from thin air
    ["ordered", "ordered"], // re-asserting ordered is not a transition from in_cart
  ];
  it.each(illegal)("rejects %s → %s with a reason", (from, to) => {
    expect(illegalStatusTransition(from as never, to as never)).toMatch(/ordered/);
  });
});
