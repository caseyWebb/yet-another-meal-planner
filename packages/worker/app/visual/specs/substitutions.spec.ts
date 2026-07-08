// The substitutions panel (member-app-differentiators 5.2, D1-D4, D10/D11): driven by
// `page.route()` interception of POST /api/grocery/substitutions fulfilling fixtures
// TYPED against the Worker's exported op result (`SuggestSubstitutionsResult`) — the
// UI is tested against the real contract with zero Kroger credentials and zero
// product-code fakes. Swap-accepts exercise the REAL write semantics per line origin:
// a same-identity accept stages an order `override` (asserted on the intercepted
// order preview body), a cross-ingredient accept on an explicit row is the real
// add+remove, and a virtual-row accept materializes + stages an order `exclude`.
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
// The Worker's REAL op shapes (the workerd-free leaf src/order-shapes.ts): the
// fixtures below type-check against the exported result, so contract drift fails
// this suite at compile time.
import type {
  LineSuggestions,
  PlaceOrderInput,
  PlaceOrderOutcome,
  SubstitutionAlternative,
  SuggestSubstitutionsResult,
} from "../../../src/order-shapes.js";

function result(over: Partial<SuggestSubstitutionsResult>): SuggestSubstitutionsResult {
  return {
    suggestions: [],
    remaining: [],
    location: { id: "03500520" },
    flyer_as_of: null,
    ...over,
  };
}

function line(over: Partial<LineSuggestions> & { for: LineSuggestions["for"] }): LineSuggestions {
  return {
    status: "ok",
    current: null,
    alternatives: [],
    siblings: [],
    ...over,
  };
}

function alt(over: Partial<SubstitutionAlternative> & { sku: string; reasons: SubstitutionAlternative["reasons"] }): SubstitutionAlternative {
  return {
    brand: "Store Brand",
    description: "product",
    size: "16 oz",
    price: { regular: 3.5, promo: 0 },
    on_sale: false,
    available: true,
    aisleLocation: null,
    ...over,
  };
}

async function interceptSubs(page: Page, fixture: SuggestSubstitutionsResult): Promise<void> {
  await page.route("**/api/grocery/substitutions", (route) => route.fulfill({ json: fixture }));
}

test.beforeEach(async ({ asMember, groceryPage }) => {
  await asMember();
  await groceryPage.goto();
  await groceryPage.landmark();
});

test("cheaper + on-sale suggestions substantiate their pills with real prices; a swap stages an order override", async ({
  page,
  groceryPage,
}) => {
  const fixture = result({
    suggestions: [
      line({
        for: { name: "chicken thighs", key: "chicken thighs", origin: "list" },
        status: "ok",
        current: {
          sku: "CUR-1",
          brand: "Kroger",
          description: "Chicken Thighs Value Pack",
          size: "16 oz",
          price: { regular: 6.72, promo: 0 },
          on_sale: false,
          available: true,
          unit_price: 0.0148, // $/g — the panel renders $0.42/oz
          base_unit: "g",
          aisleLocation: { number: "11", description: "Meat & Seafood" },
        },
        alternatives: [
          alt({
            sku: "ALT-CHEAP",
            brand: "Heritage Farm",
            description: "Chicken Thighs Family Pack",
            size: "32 oz",
            price: { regular: 9.92, promo: 0 },
            unit_price: 0.0109,
            base_unit: "g",
            reasons: ["cheaper"],
          }),
        ],
      }),
      line({
        for: { name: "coconut milk", key: "coconut milk", origin: "list" },
        alternatives: [
          alt({
            sku: "ALT-SALE",
            brand: "Thai Kitchen",
            description: "Coconut Milk",
            size: "13.5 fl oz",
            price: { regular: 3.29, promo: 2.5 },
            on_sale: true,
            reasons: ["on_sale"],
          }),
        ],
      }),
    ],
  });
  await interceptSubs(page, fixture);
  await groceryPage.openSubs();
  await expect(groceryPage.subsPanel()).toBeVisible();

  // The cheaper claim carries BOTH unit prices — never a bare pill (D10).
  const cheapRow = groceryPage.subsRow("chicken thighs");
  await expect(cheapRow.getByTestId("subs-reason")).toHaveText("cheaper — $0.31/oz vs $0.42/oz");
  const saleRow = groceryPage.subsRow("coconut milk");
  await expect(saleRow.getByTestId("subs-reason")).toHaveText("on sale — $2.50 (was $3.29)");
  await groceryPage.captureForReview("subs-panel-cheaper-onsale");

  // Accepting a same-identity swap stages an order override — no server write yet.
  await groceryPage.acceptSubsRow(cheapRow);
  await expect(cheapRow.getByTestId("subs-staged")).toBeVisible();

  // The staged pick rides the ORDER preview/commit body (D4): intercept the order
  // endpoint and read the wire.
  let previewBody: PlaceOrderInput | undefined;
  const outcome: PlaceOrderOutcome = {
    resolved: [],
    checkpoint: [],
    sku_cache: { committed: false },
    cart: { written: false },
    list: { advanced: false },
    preview: true,
    partials: [],
    underived: [],
  };
  await page.route("**/api/grocery/order", async (route) => {
    previewBody = (route.request().postDataJSON() ?? {}) as PlaceOrderInput;
    await route.fulfill({ json: outcome });
  });
  await page.getByTestId("order-open").click();
  await expect.poll(() => previewBody?.overrides ?? null).toEqual([{ name: "chicken thighs", sku: "ALT-CHEAP" }]);
});

test("an out-of-stock current pick is cued and its alternatives read in stock now", async ({
  page,
  groceryPage,
}) => {
  await interceptSubs(
    page,
    result({
      suggestions: [
        line({
          for: { name: "scallions", key: "green-onion", origin: "both" },
          status: "current_unavailable",
          current: {
            sku: "CUR-2",
            brand: "Kroger",
            description: "Green Onions",
            size: "1 bunch",
            price: { regular: 1.29, promo: 0 },
            on_sale: false,
            available: false,
            aisleLocation: null,
          },
          alternatives: [
            alt({
              sku: "ALT-STOCK",
              brand: "Simple Truth",
              description: "Organic Green Onions",
              size: "1 bunch",
              price: { regular: 1.99, promo: 0 },
              reasons: ["in_stock"],
            }),
          ],
        }),
      ],
    }),
  );
  await groceryPage.openSubs();
  const row = groceryPage.subsRow("scallions");
  await expect(row.getByTestId("subs-out-of-stock")).toHaveText("out of stock");
  await expect(row.getByTestId("subs-reason")).toHaveText("in stock now");
  await groceryPage.captureForReview("subs-panel-out-of-stock");
});

test("sibling suggestions carry their relation labels + pantry/sale hints; accepts map to the real writes per origin", async ({
  page,
  groceryPage,
}) => {
  // The production-shaped family (the D3 fixture): an explicit-row line and a
  // plan-derived (virtual) line, each with a labeled sibling.
  await interceptSubs(
    page,
    result({
      location: null, // the graph half is store-independent (walk-store degradation)
      suggestions: [
        line({
          for: { name: "halloumi", key: "halloumi", origin: "list" },
          status: "no_cached_pick",
          siblings: [
            {
              id: "paneer",
              label: "paneer",
              relation: { role: "sibling", kind: "membership", via: "grilling cheese" },
              in_pantry: true,
              on_sale_hint: { sku: "F1", description: "Paneer 8oz", price: { regular: 4, promo: 3 }, savings: 1 },
            },
          ],
        }),
        line({
          for: { name: "salmon", key: "salmon", origin: "plan" },
          status: "no_cached_pick",
          siblings: [
            {
              id: "arctic char",
              label: "arctic char",
              relation: { role: "satisfies", kind: "general" },
              in_pantry: false,
            },
          ],
        }),
      ],
    }),
  );
  // The virtual line needs the plan (salmon derives from the seeded planned recipe).
  await groceryPage.setPlan(["viz-miso-salmon"]);
  await groceryPage.addRow("halloumi");
  await groceryPage.goto();
  await groceryPage.openSubs();

  const sibRow = groceryPage.subsRow("halloumi");
  await expect(sibRow.getByTestId("subs-relation")).toHaveText("same family · via grilling cheese");
  await expect(sibRow.getByTestId("subs-pantry-hit")).toHaveText("in your pantry");
  await expect(sibRow.getByTestId("subs-sale-hint")).toContainText("$3.00 at your store");
  const virtRow = groceryPage.subsRow("salmon");
  await expect(virtRow.getByTestId("subs-relation")).toHaveText("can stand in");
  await groceryPage.captureForReview("subs-panel-siblings");

  // Explicit row: the accept is the REAL add + remove (class (b) writes).
  await groceryPage.acceptSubsRow(sibRow);
  await expect.poll(() => groceryPage.rowStatus("paneer")).toBe("active");
  await expect.poll(() => groceryPage.rowStatus("halloumi")).toBeUndefined();

  // Virtual row: the accept materializes the replacement and stages an order-scoped
  // exclude — the PLAN is untouched (the line re-derives on later reads).
  await groceryPage.acceptSubsRow(virtRow);
  await expect.poll(() => groceryPage.rowStatus("arctic char")).toBe("active");
  let previewBody: PlaceOrderInput | undefined;
  await page.route("**/api/grocery/order", async (route) => {
    previewBody = (route.request().postDataJSON() ?? {}) as PlaceOrderInput;
    await route.fulfill({
      json: {
        resolved: [],
        checkpoint: [],
        sku_cache: { committed: false },
        cart: { written: false },
        list: { advanced: false },
        preview: true,
        partials: [],
        underived: [],
      } satisfies PlaceOrderOutcome,
    });
  });
  await page.getByTestId("order-open").click();
  await expect.poll(() => previewBody?.exclude ?? null).toEqual(["salmon"]);

  // Cleanup: restore the pre-spec list shape.
  await groceryPage.removeRow("paneer");
  await groceryPage.removeRow("arctic char");
  await groceryPage.addRow("halloumi");
});

test("no suggestions renders the empty-state copy; dismiss-all is per-session client state", async ({
  page,
  groceryPage,
}) => {
  await interceptSubs(
    page,
    result({
      suggestions: [
        line({ for: { name: "coconut milk", key: "coconut milk", origin: "list" }, status: "no_cached_pick" }),
      ],
    }),
  );
  await groceryPage.openSubs();
  // A line with nothing to say produces NO row — the honest empty state, not an
  // empty container (D10: nothing fabricates a suggestion).
  await expect(groceryPage.subsEmpty()).toHaveText("No substitutions to suggest right now — your list looks good.");
  await groceryPage.captureForReview("subs-panel-empty");
  await groceryPage.dismissAllSubs();
  await expect(groceryPage.subsPanel()).toHaveCount(0);
});
