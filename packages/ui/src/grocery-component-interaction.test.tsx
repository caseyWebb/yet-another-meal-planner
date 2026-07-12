// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { GroceryListData } from "@yamp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroceryList } from "./components/grocery-list";
import { type GroceryAction, groceryActionKey } from "./grocery-controller";

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

afterEach(cleanup);

describe("GroceryList interaction serialization", () => {
  it("exposes grouping as a single-select radio group", () => {
    const view = render(<GroceryList data={data} adapter={{ mode: "interactive", mutate: vi.fn() }} />);
    const group = view.getByRole("radiogroup", { name: "Group grocery list" });
    const department = view.getByRole("radio", { name: "Department" });
    const recipe = view.getByRole("radio", { name: "Recipe" });
    expect(group.contains(department)).toBe(true);
    expect(department.getAttribute("aria-checked")).toBe("true");
    expect(recipe.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(recipe);
    expect(recipe.getAttribute("aria-checked")).toBe("true");
    expect(department.getAttribute("aria-checked")).toBe("false");
  });

  it("visibly labels staple lines", () => {
    const withStaple: GroceryListData = {
      ...data,
      lines: data.lines.map((item) => (item.key === "milk" ? { ...item, staple: true } : item)),
    };
    const view = render(
      <GroceryList data={withStaple} adapter={{ mode: "interactive", mutate: vi.fn() }} />,
    );
    const milk = view.container.querySelector('[data-testid="grocery-line"][data-key="milk"]');
    expect(milk?.querySelector('[data-testid="grocery-staple"]')?.textContent).toBe("Staple");
  });

  it("starts independent targets immediately while suppressing a pending target duplicate", async () => {
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

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
    expect((boxes[1] as HTMLInputElement).disabled).toBe(false);
    release();
    await waitFor(() => expect((boxes[0] as HTMLInputElement).disabled).toBe(false));
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls.map(([action]) => groceryActionKey(action))).toEqual(["line:eggs", "line:milk"]);
  });

  it("gates destructive actions for one send without disabling unrelated rows", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const withSend: GroceryListData = {
      ...data,
      in_cart_groups: [
        {
          send_id: "send-1",
          store: "Kroger",
          location_id: "1",
          fulfillment: "kroger_online",
          sent_at: "2026-07-12T12:00:00Z",
          placed_at: null,
          awaiting_confirmation: false,
          estimated_total: 4,
          flyer_savings: null,
          can_mark_placed: true,
          lines: [{ key: "bread", name: "Bread", quantity: 1, row_version: 2, unit_price: 4, savings: null }],
        },
      ],
      counts: { ...data.counts, in_carts: 1 },
    };
    const mutate = vi.fn(async () => {
      await pending;
      return withSend;
    });
    const view = render(<GroceryList data={withSend} adapter={{ mode: "interactive", mutate }} />);

    fireEvent.click(view.getByRole("button", { name: "Back to list" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect((view.getByRole("button", { name: "Back to list" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Mark order placed" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((view.getAllByRole("checkbox")[0] as HTMLInputElement).disabled).toBe(false);
    release();
    await waitFor(() =>
      expect((view.getByRole("button", { name: "Back to list" }) as HTMLButtonElement).disabled).toBe(false),
    );
  });
});
