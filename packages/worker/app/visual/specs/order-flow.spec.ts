import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import type { GroceryListData } from "../../../../contract/src/grocery";
import type { PlaceOrderInput, PlaceOrderOutcome } from "../../../src/order-shapes.js";

const base: GroceryListData = {
  contract_version: 1, snapshot_version: "orders-v1", as_of: "2026-07-12T12:00:00Z",
  lines: [], to_buy: [], pantry_covered: [], underived: [], location: null, flyer_as_of: null,
  counts: { to_buy: 0, checked: 0, in_carts: 2, recipes: 0 },
  in_cart_groups: [{
    send_id: "send-1", store: "Kroger", location_id: "1", fulfillment: "kroger_online",
    sent_at: "2026-07-10T12:00:00Z", placed_at: null, awaiting_confirmation: true,
    estimated_total: 8, flyer_savings: 1, can_mark_placed: true,
    lines: [
      { key: "milk", name: "Milk", quantity: 1, row_version: 2, unit_price: 4, savings: 1 },
      { key: "eggs", name: "Eggs", quantity: 1, row_version: 3, unit_price: 4, savings: 0 },
    ],
  }],
};

test.beforeEach(async ({ asMember }) => { await asMember(); });

test("Back to list removes only the selected send line", async ({ groceryPage, page }) => {
  let current = base;
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: current }));
  await page.route("**/api/grocery/relist", (route) => {
    current = {
    ...base, snapshot_version: "orders-v2",
    lines: [{ key: "milk", name: "Milk", quantity: 1, kind: "grocery", domain: "grocery", origin: "list", checked_at: null, row_version: 3, updated_at: "2026-07-12T12:01:00Z", for_recipes: [] }],
    to_buy: ["milk"], counts: { ...base.counts, to_buy: 1, in_carts: 1 },
    in_cart_groups: [{ ...base.in_cart_groups[0], lines: [base.in_cart_groups[0].lines[1]] }],
    };
    return route.fulfill({ json: { snapshot: current } });
  });
  await groceryPage.goto(); await groceryPage.landmark();
  await groceryPage.cartItem("milk").getByRole("button", { name: "Back to list" }).click();
  await expect(groceryPage.item("milk")).toBeVisible();
  await expect(groceryPage.cartItem("eggs")).toBeVisible();
});

test("exact mark-placed conflicts replace the stale snapshot and stay honest", async ({ groceryPage, page }) => {
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: base }));
  await page.route("**/api/grocery/mark-placed", (route) => route.fulfill({
    status: 409, contentType: "application/json",
    body: JSON.stringify({ error: "conflict", message: "Send membership changed", snapshot: { ...base, snapshot_version: "orders-current", in_cart_groups: [{ ...base.in_cart_groups[0], lines: [base.in_cart_groups[0].lines[1]] }], counts: { ...base.counts, in_carts: 1 } } }),
  }));
  await groceryPage.goto(); await groceryPage.landmark();
  await page.getByRole("button", { name: "Mark order placed" }).click();
  await expect(page.getByRole("alert")).toContainText("Send membership changed");
  await expect(groceryPage.cartItem("milk")).toHaveCount(0);
  await expect(groceryPage.cartItem("eggs")).toBeVisible();
});

test("exact mark-placed succeeds through the live Worker and advances the seeded send", async ({ groceryPage }) => {
  await groceryPage.goto(); await groceryPage.landmark();
  const olive = groceryPage.cartItem("olive oil");
  await expect(olive).toBeVisible();
  await olive.locator("xpath=ancestor::*[@data-testid='grocery-cart-group']").getByRole("button", { name: "Mark order placed" }).click();
  await expect(olive).toHaveCount(0);
  await expect.poll(() => groceryPage.rowStatus("olive oil")).toBe("ordered");
});

function outcome(overrides: Partial<PlaceOrderOutcome>): PlaceOrderOutcome {
  return {
    resolved: [], checkpoint: [], sku_cache: { committed: false }, cart: { written: false },
    list: { advanced: false }, send: { recorded: false }, preview: true, partials: [], underived: [],
    ...overrides,
  };
}

function resolvedLine(name: string, overrides: Partial<PlaceOrderOutcome["resolved"][number]> = {}) {
  return {
    name, key: name, sku: `000${name.length}`, brand: "Store Brand", size: "12 oz", quantity: 1,
    assumed_quantity: false, price: { regular: 3.5, promo: 0 }, on_sale: false, ...overrides,
  };
}

async function interceptOrder(
  page: Page,
  fixtures: { preview: PlaceOrderOutcome; commit?: PlaceOrderOutcome },
  sink: { commitBody?: PlaceOrderInput } = {},
) {
  await page.route("**/api/grocery/order", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as PlaceOrderInput;
    if (body.preview) return route.fulfill({ json: fixtures.preview });
    sink.commitBody = body;
    return route.fulfill({ json: fixtures.commit ?? fixtures.preview });
  });
  return sink;
}

test("typed preview commits and reports the cart and list writes independently", async ({ page, groceryPage }) => {
  await groceryPage.deactivateInCart();
  const preview = outcome({
    resolved: [resolvedLine("olive oil"), resolvedLine("scallions", { on_sale: true, price: { regular: 2.5, promo: 1.9 } })],
  });
  const commit = outcome({ ...preview, preview: false, sku_cache: { committed: true }, cart: { written: true, count: 2 }, list: { advanced: true } });
  const sink = await interceptOrder(page, { preview, commit });
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.openOrder();
  await expect(groceryPage.orderLine("olive oil")).toBeVisible();
  await expect(groceryPage.orderLine("scallions")).toContainText("on sale");
  await expect(groceryPage.staleWarning()).toHaveCount(0);
  await groceryPage.commitOrder();
  await expect(groceryPage.resultCart()).toContainText("2 items sent to the Kroger cart");
  await expect(groceryPage.resultList()).toContainText("moved to the In cart group");
  await expect(groceryPage.resultSend()).toContainText("No sent quote was recorded");
  await expect(groceryPage.resultSkuCache()).toContainText("Product matches were saved");
  expect(sink.commitBody?.preview).toBeUndefined();
});

test("checkpoint, partial confirmation, quantity, override, and exclusion ride the commit", async ({ page, groceryPage }) => {
  await groceryPage.deactivateInCart();
  const preview = outcome({
    resolved: [resolvedLine("salmon", { assumed_quantity: true }), resolvedLine("rice")],
    checkpoint: [{ name: "mustard", kind: "ambiguous", message: "several plausible products", candidates: [
      { sku: "0001", brand: "Maille", size: "7 oz", price: { regular: 4.2, promo: 0 }, on_sale: false, fulfillment: { curbside: true, delivery: true } },
      { sku: "0002", brand: "Store Brand", size: "8 oz", price: { regular: 2.1, promo: 0 }, on_sale: false, fulfillment: { curbside: true, delivery: false } },
    ] }],
    partials: [{ name: "baby spinach", for_recipes: ["viz-miso-salmon"] }], underived: ["viz-beef-ragu"],
  });
  const commit = outcome({ preview: false, resolved: preview.resolved, cart: { written: true, count: 3 }, list: { advanced: true }, sku_cache: { committed: true } });
  const sink = await interceptOrder(page, { preview, commit });
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.openOrder();
  await expect(page.getByTestId("order-underived")).toContainText("viz-beef-ragu");
  await groceryPage.setLineQty("salmon", 3);
  await groceryPage.excludeLine("rice");
  await groceryPage.pickCandidate("mustard", "0002");
  await groceryPage.confirmPartial("baby spinach");
  await groceryPage.commitOrder();
  expect(sink.commitBody?.quantities).toEqual({ salmon: 3 });
  expect(sink.commitBody?.exclude).toEqual(["rice"]);
  expect(sink.commitBody?.overrides).toEqual([{ name: "mustard", sku: "0002" }]);
  expect(sink.commitBody?.include_partials).toEqual(["baby spinach"]);
});

test("failed cart write stays honest and offers Kroger reauthentication", async ({ page, groceryPage }) => {
  await groceryPage.deactivateInCart();
  const preview = outcome({ resolved: [resolvedLine("olive oil")] });
  const commit = outcome({ preview: false, resolved: preview.resolved, sku_cache: { committed: true }, cart: { written: false, code: "reauth_required", error: "Kroger refresh token rejected" }, list: { advanced: false } });
  await interceptOrder(page, { preview, commit });
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.openOrder(); await groceryPage.commitOrder();
  await expect(groceryPage.resultCart()).toContainText("NOT written");
  await expect(groceryPage.resultCart()).not.toContainText("sent to the Kroger cart");
  await expect(groceryPage.resultCart()).toContainText("stay on your to-buy list");
  await expect(groceryPage.relinkButton()).toBeVisible();
  await expect(groceryPage.resultList()).toContainText("not advanced");
  await expect(groceryPage.resultSend()).toContainText("No sent quote was recorded");
  await expect(groceryPage.resultSkuCache()).toContainText("Product matches were saved");
});

test("reports a failed rollback, surviving send quote, and SKU-cache failure independently", async ({ page, groceryPage }) => {
  await groceryPage.deactivateInCart();
  const preview = outcome({ resolved: [resolvedLine("olive oil")] });
  const commit = outcome({
    preview: false,
    resolved: preview.resolved,
    cart: { written: false, error: "cart unavailable" },
    list: { advanced: true, rolled_back: false, error: "rollback unavailable" },
    send: { recorded: true, id: "send-survivor" },
    sku_cache: { committed: false, error: "cache unavailable" },
  });
  await interceptOrder(page, { preview, commit });
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.openOrder(); await groceryPage.commitOrder();
  await expect(groceryPage.resultCart()).toContainText("list still says In cart");
  await expect(groceryPage.resultCart()).not.toContainText("stay on your to-buy list");
  await expect(groceryPage.resultList()).toContainText("marked In cart even though the cart was not written");
  await expect(groceryPage.resultSend()).toContainText("recorded as send-survivor");
  await expect(groceryPage.resultSkuCache()).toContainText("cache unavailable");
});

test("stale cart state gates commit until explicitly acknowledged", async ({ page, groceryPage }) => {
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: base }));
  await interceptOrder(page, { preview: outcome({ resolved: [resolvedLine("olive oil")] }) });
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.openOrder();
  await expect(groceryPage.staleWarning()).toContainText("never confirmed placed");
  await expect(groceryPage.commitButton()).toBeDisabled();
  await groceryPage.ackStaleCart();
  await expect(groceryPage.commitButton()).toBeEnabled();
});
