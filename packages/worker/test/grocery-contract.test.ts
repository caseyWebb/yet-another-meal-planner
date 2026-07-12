import { describe, expect, it } from "vitest";
import {
  GROCERY_CONTRACT_CEILING,
  GROCERY_CONTRACT_FLOOR,
  groceryContractSupport,
  parseGroceryListData,
} from "@yamp/contract";

const fixture = {
  contract_version: 1,
  snapshot_version: "sha256:fixture",
  as_of: "2026-07-12T12:00:00.000Z",
  lines: [],
  to_buy: [],
  pantry_covered: [],
  in_cart_groups: [],
  underived: [],
  location: null,
  flyer_as_of: null,
  counts: { to_buy: 0, checked: 0, in_carts: 0, recipes: 0 },
};

describe("GroceryListData contract", () => {
  it("parses the independent v1 snapshot", () => {
    expect(parseGroceryListData(fixture)).toEqual(fixture);
    expect(GROCERY_CONTRACT_FLOOR).toBe(1);
    expect(GROCERY_CONTRACT_CEILING).toBe(2);
  });

  it("gates older, unknown-newer, and invalid payloads", () => {
    expect(groceryContractSupport(1)).toBe("supported");
    expect(groceryContractSupport(0)).toBe("older");
    expect(groceryContractSupport(2)).toBe("supported");
    expect(groceryContractSupport(3)).toBe("newer");
    expect(groceryContractSupport(undefined)).toBe("invalid");
  });
});
