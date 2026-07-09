// The order flow (member-app-grocery 6.3, D9): the preview → disposition → commit panel
// driven by `page.route()` interception of POST /api/grocery/order, fulfilling fixtures
// TYPED against the Worker's exported op result (`PlaceOrderOutcome`) — the UI is tested
// against the real contract with zero Kroger credentials and zero product-code fakes.
// Mark-order-placed and the stale-cart warning run LIVE against the seeded Worker.
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
// The Worker's REAL op shapes (a workerd-free leaf module — src/order-shapes.ts, the
// same types order-tools.ts re-exports): the fixtures below type-check against the
// exported result, so a contract drift fails this suite at compile time.
import type { PlaceOrderOutcome, PlaceOrderInput } from "../../../src/order-shapes.js";

/** A fixture skeleton the scenarios override — type-checked against the op's result. */
function outcome(over: Partial<PlaceOrderOutcome>): PlaceOrderOutcome {
  return {
    resolved: [],
    checkpoint: [],
    sku_cache: { committed: false },
    cart: { written: false },
    list: { advanced: false },
    preview: true,
    partials: [],
    underived: [],
    ...over,
  };
}

function resolvedLine(name: string, over: Partial<PlaceOrderOutcome["resolved"][number]> = {}) {
  return {
    name,
    key: name,
    sku: `000${name.length}`,
    brand: "Store Brand",
    size: "12 oz",
    quantity: 1,
    assumed_quantity: false,
    price: { regular: 3.5, promo: 0 },
    on_sale: false,
    ...over,
  };
}

/** Intercept the order endpoint: `preview: true` → the preview fixture; else record the
 *  commit body and serve the commit fixture. */
async function interceptOrder(
  page: Page,
  fixtures: { preview: PlaceOrderOutcome; commit?: PlaceOrderOutcome },
  sink: { commitBody?: PlaceOrderInput } = {},
): Promise<{ commitBody?: PlaceOrderInput }> {
  await page.route("**/api/grocery/order", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as PlaceOrderInput;
    if (body.preview) {
      await route.fulfill({ json: fixtures.preview });
      return;
    }
    sink.commitBody = body;
    await route.fulfill({ json: fixtures.commit ?? fixtures.preview });
  });
  return sink;
}

test.beforeEach(async ({ asMember, groceryPage }) => {
  await asMember();
  await groceryPage.goto();
  await groceryPage.landmark();
  await groceryPage.deactivateInCart(); // a clean stale-cart slate; tests re-provision
  await groceryPage.goto();
});

test("a clean resolve commits straight through and reports the cart honestly", async ({
  page,
  groceryPage,
}) => {
  const preview = outcome({
    resolved: [resolvedLine("olive oil"), resolvedLine("scallions", { on_sale: true, price: { regular: 2.5, promo: 1.9 } })],
  });
  const commit = outcome({
    ...preview,
    preview: false,
    sku_cache: { committed: true },
    cart: { written: true, count: 2 },
    list: { advanced: true },
  });
  const sink = await interceptOrder(page, { preview, commit });

  await groceryPage.openOrder();
  await expect(groceryPage.orderPanel()).toBeVisible();
  await expect(groceryPage.orderLine("olive oil")).toBeVisible();
  await expect(groceryPage.orderLine("scallions")).toContainText("on sale"); // fresh price at preview
  await expect(groceryPage.staleWarning()).toHaveCount(0); // nothing in-cart → no warning
  await groceryPage.captureForReview("order-preview-clean");

  await groceryPage.commitOrder();
  await expect(groceryPage.resultCart()).toContainText("2 items sent to the Kroger cart");
  await expect(groceryPage.resultList()).toContainText("moved to the In cart group");
  expect(sink.commitBody?.preview).toBeUndefined(); // the commit call is the real one
  await groceryPage.captureForReview("order-result-clean");
});

test("checkpoint, partials, and assumed-quantity dispositions ride the commit body", async ({
  page,
  groceryPage,
}) => {
  const preview = outcome({
    resolved: [
      resolvedLine("salmon", { assumed_quantity: true }),
      resolvedLine("rice"),
    ],
    checkpoint: [
      {
        name: "mustard",
        kind: "ambiguous",
        message: "several plausible products",
        candidates: [
          { sku: "0001", brand: "Maille", size: "7 oz", price: { regular: 4.2, promo: 0 }, on_sale: false, fulfillment: { curbside: true, delivery: true } },
          { sku: "0002", brand: "Store Brand", size: "8 oz", price: { regular: 2.1, promo: 0 }, on_sale: false, fulfillment: { curbside: true, delivery: false } },
        ],
      },
    ],
    partials: [{ name: "baby spinach", for_recipes: ["viz-miso-salmon"] }],
    underived: ["viz-beef-ragu"],
  });
  const commit = outcome({ preview: false, resolved: preview.resolved, cart: { written: true, count: 3 }, list: { advanced: true }, sku_cache: { committed: true } });
  const sink = await interceptOrder(page, { preview, commit });

  await groceryPage.openOrder();
  await expect(groceryPage.orderPanel()).toBeVisible();
  // Underived honesty rides the panel too.
  await expect(page.getByTestId("order-underived")).toContainText("viz-beef-ragu");
  // Dispositions: a produce count on the assumed line, skip a line, pick a candidate,
  // confirm a pantry partial.
  await groceryPage.setLineQty("salmon", 3);
  await groceryPage.excludeLine("rice");
  await groceryPage.pickCandidate("mustard", "0002");
  await groceryPage.confirmPartial("baby spinach");
  await groceryPage.captureForReview("order-preview-dispositions");
  await groceryPage.commitOrder();
  await expect(groceryPage.resultCart()).toContainText("sent to the Kroger cart");

  // The commit request carried every disposition through the tool's input shape.
  expect(sink.commitBody?.quantities).toEqual({ salmon: 3 });
  expect(sink.commitBody?.exclude).toEqual(["rice"]);
  expect(sink.commitBody?.overrides).toEqual([{ name: "mustard", sku: "0002" }]);
  expect(sink.commitBody?.include_partials).toEqual(["baby spinach"]);
});

test("a failed cart write renders truthfully with the Kroger re-link CTA", async ({
  page,
  groceryPage,
}) => {
  const preview = outcome({ resolved: [resolvedLine("olive oil")] });
  const commit = outcome({
    preview: false,
    resolved: preview.resolved,
    sku_cache: { committed: true },
    cart: { written: false, code: "reauth_required", error: "Kroger refresh token rejected" },
    list: { advanced: false },
  });
  await interceptOrder(page, { preview, commit });

  await groceryPage.openOrder();
  await expect(groceryPage.orderLine("olive oil")).toBeVisible();
  await groceryPage.commitOrder();
  // NEVER "cart populated" on written:false — the items are still to-buy, re-link offered.
  await expect(groceryPage.resultCart()).toContainText("NOT written");
  await expect(groceryPage.resultCart()).not.toContainText("sent to the Kroger cart");
  await expect(groceryPage.resultCart()).toContainText("stay on your to-buy list");
  await expect(groceryPage.relinkButton()).toBeVisible();
  await expect(groceryPage.resultList()).toContainText("not advanced");
  await groceryPage.captureForReview("order-result-reauth");
});

test("the stale-cart warning gates the commit until acknowledged", async ({ page, groceryPage }) => {
  await groceryPage.addRow("stale probe");
  await groceryPage.setRowStatus("stale probe", "in_cart");
  await groceryPage.goto();
  await interceptOrder(page, { preview: outcome({ resolved: [resolvedLine("olive oil")] }) });

  await groceryPage.openOrder();
  await expect(groceryPage.staleWarning()).toBeVisible();
  await expect(groceryPage.staleWarning()).toContainText("never confirmed placed");
  await expect(groceryPage.commitButton()).toBeDisabled();
  await groceryPage.ackStaleCart();
  await expect(groceryPage.commitButton()).toBeEnabled();
  await groceryPage.removeRow("stale probe"); // cleanup
});

test("Mark order placed advances the in-cart group through the W3 guard (live)", async ({
  groceryPage,
}) => {
  await groceryPage.addRow("placed probe");
  await groceryPage.setRowStatus("placed probe", "in_cart");
  await groceryPage.goto();
  await groceryPage.expectInCartGroup("placed probe");
  await groceryPage.markOrderPlaced();
  await expect.poll(() => groceryPage.rowStatus("placed probe")).toBe("ordered");
  // An ordered row renders in no group — it has left the member surface's lists.
  await expect(groceryPage.anyItem("placed probe")).toHaveCount(0);
  await groceryPage.removeRow("placed probe"); // cleanup
});
