// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroceryListData } from "@yamp/contract";
import { GroceryList } from "./components/grocery-list";
import { groceryActionKey, type GroceryAction } from "./grocery-controller";

const data: GroceryListData = {
  contract_version: 1,
  snapshot_version: "v1",
  as_of: "2026-07-12T12:00:00Z",
  lines: ["milk", "eggs"].map((key) => ({
    key,
    name: key,
    quantity: 1,
    kind: "grocery" as const,
    domain: "grocery",
    origin: "list" as const,
    checked_at: null,
    row_version: 1,
    updated_at: null,
    for_recipes: [],
  })),
  to_buy: ["milk", "eggs"],
  pantry_covered: [],
  in_cart_groups: [],
  underived: [],
  location: null,
  flyer_as_of: null,
  counts: { to_buy: 2, checked: 0, in_carts: 0, recipes: 0 },
};

describe("GroceryList interaction serialization", () => {
  it("starts one write at a time and suppresses a duplicate while pending", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutate = vi.fn(async (_action: GroceryAction) => {
      if (mutate.mock.calls.length === 1) await first;
      return data;
    });
    const view = render(<GroceryList data={data} adapter={{ mode: "interactive", mutate }} />);
    const boxes = view.getAllByRole("checkbox");

    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
    expect((boxes[1] as HTMLInputElement).disabled).toBe(true);
    release();
    await waitFor(() => expect((boxes[0] as HTMLInputElement).disabled).toBe(false));
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls.map(([action]) => groceryActionKey(action))).toEqual(["eggs", "milk"]);
  });
});
