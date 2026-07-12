import type { GroceryListData } from "@yamp/contract";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroceryList } from "./components/grocery-list";
import { createGroceryBridgeAdapter, type GroceryBridge, resolveGroceryCapabilities } from "./grocery-bridge";

const data: GroceryListData = {
  contract_version: 1,
  snapshot_version: "v1",
  as_of: "2026-07-12T12:00:00Z",
  lines: [
    {
      key: "milk",
      name: "Milk",
      quantity: 1,
      kind: "grocery",
      domain: "grocery",
      origin: "both",
      checked_at: null,
      row_version: 1,
      updated_at: null,
      for_recipes: ["soup"],
      placement: { section: "Dairy", aisle_number: "2" },
    },
    {
      key: "towels",
      name: "Paper towels",
      quantity: "1 pack",
      kind: "household",
      domain: "grocery",
      origin: "list",
      checked_at: "2026-07-12",
      row_version: 2,
      updated_at: "2026-07-12",
      for_recipes: [],
    },
  ],
  to_buy: ["milk"],
  pantry_covered: [
    {
      key: "onion",
      name: "Onion",
      for_recipes: ["soup"],
      freshness: "worth_a_look",
      freshness_reason: "last verified 8 days ago",
      on_hand: {},
      buy_anyway: false,
    },
  ],
  in_cart_groups: [
    {
      send_id: "s1",
      store: "Kroger",
      location_id: "1",
      fulfillment: "kroger_online",
      sent_at: "2026-07-08",
      placed_at: null,
      awaiting_confirmation: true,
      estimated_total: 8,
      flyer_savings: 2,
      can_mark_placed: true,
      lines: [{ key: "eggs", name: "Eggs", quantity: 1, row_version: 2, unit_price: 8, savings: 2 }],
    },
  ],
  underived: ["mystery-stew"],
  location: { id: "1" },
  flyer_as_of: null,
  counts: { to_buy: 1, checked: 1, in_carts: 1, recipes: 1 },
};

describe("shared Grocery component", () => {
  it("renders truthful list, send quote, aging, household, pantry, and underived states", () => {
    const html = renderToStaticMarkup(
      <GroceryList data={data} adapter={{ mode: "interactive", online: true, mutate: async () => data }} />,
    );
    for (const text of [
      "To buy",
      "Checked",
      "In carts",
      "Dairy",
      "Household",
      "Sent estimate $8.00",
      "flyer savings",
      "Send-time quote",
      "Awaiting confirmation",
      "Pantry covers these",
      "mystery-stew",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("final price");
  });

  it("degrades all persistent controls in read-only mode", () => {
    const html = renderToStaticMarkup(
      <GroceryList data={data} adapter={{ mode: "readonly", mutate: async () => data }} />,
    );
    expect(html).toContain('data-host-mode="readonly"');
    expect(html).toContain("disabled");
  });

  it("renders a real unknown-newer widget fixture read-only", () => {
    const fixture = { ...data, contract_version: 3, snapshot_version: "unknown-newer-v3" };
    const bridge = {
      callServerTool: async () => ({ structuredContent: { snapshot: fixture } }),
      updateModelContext: async () => undefined,
      sendMessage: async () => undefined,
    } satisfies GroceryBridge;
    const capabilities = resolveGroceryCapabilities({
      contractVersion: fixture.contract_version,
      serverTools: true,
      updateModelContext: true,
      message: true,
      hydrated: true,
    });
    const html = renderToStaticMarkup(
      <GroceryList data={fixture} adapter={createGroceryBridgeAdapter(bridge, capabilities)} />,
    );
    expect(html).toContain('data-host-mode="readonly"');
    expect(html).toContain("Milk");
    expect(html).toContain("disabled");
  });

  it("renders each send as an accessible collapsible disclosure", () => {
    const html = renderToStaticMarkup(
      <GroceryList data={data} adapter={{ mode: "interactive", mutate: async () => data }} />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain('aria-label="Kroger cart, 1 items"');
  });

  it("renders the primary recipe and +N from the same sorted attribution", () => {
    const fixture = {
      ...data,
      lines: [
        {
          ...data.lines[0]!,
          for_recipes: ["late", "early", "early"],
          recipe_attribution: [
            { slug: "late", planned_for: "2026-07-14", plan_id: "b" },
            { slug: "early", planned_for: "2026-07-13", plan_id: "a" },
            { slug: "early", planned_for: "2026-07-13", plan_id: "a" },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <GroceryList data={fixture} adapter={{ mode: "interactive", mutate: async () => fixture }} />,
    );
    expect(html).toContain('href="/recipe/early"');
    expect(html).toContain(" +1");
    expect(html).not.toContain('href="/recipe/late"');
  });
});
