import { describe, it, expect } from "vitest";
import {
  addToGroceryList,
  removeGroceryItem,
  updateGroceryItem,
  normalizeName,
  type GroceryItem,
} from "../src/grocery.js";

const TODAY = "2026-06-09";

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
