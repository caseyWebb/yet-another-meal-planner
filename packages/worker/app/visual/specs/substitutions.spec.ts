// Substitution hints (inline-substitution-hints, refactored from member-app-
// differentiators 5.2): the cheap sibling/pantry/flyer half rides the enriched to-buy
// read and renders INLINE on the to-buy list (no panel, no "Propose substitutions"
// trigger) — asserted LIVE against the seeded Worker's identity graph, pantry row, and
// warmed flyer rollup (`SEED.app.differentiators.siblings`). The expensive
// price/availability half (the slim `suggest_substitutions` op) surfaces in the ORDER
// DIALOG at preview time, driven by `page.route()` interception of both
// `POST /api/grocery/order` and `POST /api/grocery/substitutions` — fixtures TYPED
// against the Worker's exported shapes so a contract drift fails this suite at compile
// time. Swap-accepts exercise the REAL write semantics: a same-identity accept (order
// dialog) stages an order `override`; a cross-ingredient accept on an explicit row is
// the real add+remove; a virtual-row accept materializes + stages an order `exclude`.
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
// The Worker's REAL op shapes (the workerd-free leaf src/order-shapes.ts): the
// fixtures below type-check against the exported result, so contract drift fails
// this suite at compile time.
import type {
  LineSuggestions,
  PlaceOrderInput,
  PlaceOrderOutcome,
  SubstitutionAlternative,
  SuggestSubstitutionsResult,
  ToBuyView,
} from "../../../src/order-shapes.js";

const DIFF = SEED.app.differentiators;
const G = SEED.app.grocery;

function subsResult(over: Partial<SuggestSubstitutionsResult>): SuggestSubstitutionsResult {
  return {
    suggestions: [],
    remaining: [],
    location: { id: "03500520" },
    ...over,
  };
}

function line(over: Partial<LineSuggestions> & { for: LineSuggestions["for"] }): LineSuggestions {
  return {
    status: "ok",
    current: null,
    alternatives: [],
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

function orderOutcome(over: Partial<PlaceOrderOutcome>): PlaceOrderOutcome {
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

async function interceptSubs(page: Page, fixture: SuggestSubstitutionsResult): Promise<void> {
  await page.route("**/api/grocery/substitutions", (route) => route.fulfill({ json: fixture }));
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
});

// ── Inline list hints (D1-D3/D6/D8), LIVE against the seeded Worker's identity graph,
// pantry row, and warmed flyer rollup — no interception of the to-buy read. ──────────

test("the enriched read's cross-ingredient siblings render inline, relation-labeled, with real in_pantry/on_sale_hint pills", async ({
  groceryPage,
}) => {
  const lineName = DIFF.siblings.line; // "cabbage::type-napa" — a seeded id-named explicit row
  await expect(groceryPage.item(lineName)).toBeVisible();
  // Located by its canonical id (data-name), the row RENDERS the curated node label resolved at
  // read (reify-ingredient-display-names read plane) — never the raw `::` id.
  await expect(groceryPage.item(lineName).locator(".g-name").first()).toHaveText(DIFF.siblings.displayNames[lineName]);
  await expect(groceryPage.item(lineName).locator(".g-name").first()).not.toContainText("::");

  // The depth-1 walk over the seeded family: two general-kind siblings (lexicographic:
  // color-green, color-red) then the generalization ("cabbage" itself) — three total,
  // under the per-line cap.
  const rows = groceryPage.subRows(lineName);
  await expect(rows).toHaveCount(3);

  // in_pantry is pure D1 — no store setup needed at all (the walk/satellite-safe half).
  const redRow = rows.nth(1);
  await expect(redRow.getByTestId("subs-relation")).toHaveText(`same family · via ${DIFF.siblings.parent}`);
  await expect(redRow.getByTestId("subs-pantry-hit")).toHaveText("in your pantry");
  const greenRow = rows.nth(0);
  await expect(greenRow.getByTestId("subs-pantry-hit")).toHaveCount(0); // only the seeded pantry row's sibling

  // The offered swap target renders the node's curated `display_name` (via `labelOf`),
  // never the raw canonical id — reify-ingredient-display-names (read plane, Move C).
  await expect(groceryPage.subLabel(redRow)).toHaveText(DIFF.siblings.displayNames["cabbage::color-red"]);
  await expect(groceryPage.subLabel(greenRow)).toHaveText(DIFF.siblings.displayNames["cabbage::color-green"]);
  await expect(groceryPage.subLabel(redRow)).not.toContainText("::");
  await groceryPage.captureForReview("grocery-inline-subs-pantry");

  // on_sale_hint needs the resolved store's warmed rollup — the seeded default
  // preferred_location IS the pre-resolved bare id already (no whitespace → no live
  // Kroger Locations call), so it lights up off the same load, no PATCH needed.
  await expect(rows.nth(0).getByTestId("subs-sale-hint")).toContainText(
    `$${DIFF.siblings.saleHit.price.promo.toFixed(2)} at your store`,
  );
  await groceryPage.captureForReview("grocery-inline-subs-sale");
});

test("a to-buy line with no graph neighbors renders with no hint affordance", async ({ groceryPage }) => {
  // The seeded active rows (chicken thighs, scallions, coconut milk) carry no edges.
  await expect(groceryPage.subRows(G.active[2])).toHaveCount(0);
});

// ── Cross-ingredient accepts map to the real writes per line origin (D6/D7). The
// to-buy read is intercepted here ONLY to pin two probe lines (an explicit row, a
// virtual/plan row) precisely — the accept itself is a REAL write against the seeded
// Worker, never faked. ────────────────────────────────────────────────────────────────

test("accepting an inline hint on an explicit row is the real add+remove; on a virtual row it materializes and stages an order exclude", async ({
  page,
  groceryPage,
}) => {
  const view: ToBuyView = {
    to_buy: [
      {
        name: "halloumi",
        quantity: 1,
        assumed_quantity: true,
        for_recipes: [],
        origin: "list",
        key: "halloumi",
        kind: "grocery",
        domain: "grocery",
        substitutes: [
          {
            id: "paneer",
            label: "paneer",
            relation: { role: "sibling", kind: "membership", via: "grilling cheese" },
            in_pantry: true,
            on_sale_hint: { sku: "F1", description: "Paneer 8oz", price: { regular: 4, promo: 3 }, savings: 1 },
          },
        ],
      },
      {
        name: "salmon",
        quantity: 1,
        assumed_quantity: true,
        for_recipes: ["viz-miso-salmon"],
        origin: "plan",
        key: "salmon",
        kind: "grocery",
        domain: "grocery",
        substitutes: [
          {
            id: "arctic char",
            label: "arctic char",
            relation: { role: "satisfies", kind: "general" },
            in_pantry: false,
          },
        ],
      },
    ],
    pantry_covered: [],
    in_cart: [],
    underived: [],
    location: { id: "03500520" },
    flyer_as_of: null,
  };
  await page.route("**/api/grocery/to-buy**", (route) => route.fulfill({ json: view }));
  await groceryPage.goto();

  const halloumiRow = groceryPage.subRow("halloumi");
  await expect(halloumiRow.getByTestId("subs-relation")).toHaveText("same family · via grilling cheese");
  await expect(halloumiRow.getByTestId("subs-pantry-hit")).toHaveText("in your pantry");
  const salmonRow = groceryPage.subRow("salmon");
  await expect(salmonRow.getByTestId("subs-relation")).toHaveText("can stand in");
  await groceryPage.captureForReview("grocery-inline-subs-accept");

  // Explicit row: the accept is the REAL add + remove (class (b) writes).
  await groceryPage.acceptSub(halloumiRow);
  await expect.poll(() => groceryPage.rowStatus("paneer")).toBe("active");

  // Virtual row: the accept materializes the replacement and stages an order-scoped
  // exclude — carried into the order dialog's preview/commit body, applied there.
  await groceryPage.acceptSub(salmonRow);
  await expect.poll(() => groceryPage.rowStatus("arctic char")).toBe("active");
  let previewBody: PlaceOrderInput | undefined;
  await page.route("**/api/grocery/order", async (route) => {
    previewBody = (route.request().postDataJSON() ?? {}) as PlaceOrderInput;
    await route.fulfill({ json: orderOutcome({ resolved: [] }) });
  });
  await page.getByTestId("order-open").click();
  await expect.poll(() => previewBody?.exclude ?? null).toEqual(["salmon"]);

  // Cleanup: drop the real rows this accept materialized.
  await groceryPage.removeRow("paneer");
  await groceryPage.removeRow("arctic char");
});

// ── Accepting a swap materializes a row that RENDERS the clean label, never the raw canonical id
// (reify-ingredient-display-names 6.6). The sibling is a REAL seeded identity node whose curated
// `display_name` differs from its id, so the accept exercises the real add-by-id write end to end:
// `swapSibling` POSTs `{ id: sib.id, name: sib.label }`; the server keys the row on the canonical id
// and stores the posted label as the row's DISPLAY `name` (key and display stored separately). ──
test("accepting a sibling swap materializes a row rendering the curated display label, never the raw canonical id", async ({
  page,
  groceryPage,
}) => {
  const sibId = "cabbage::color-green";
  const sibLabel = DIFF.siblings.displayNames[sibId]; // "Green cabbage" — the curated label
  // A probe line pinned by interception (an explicit `list` row), carrying one sibling
  // that is the seeded green-cabbage node — id != label, and NOT in the seeded pantry, so
  // the materialized row lands on the to-buy list (not pantry-covered).
  const view: ToBuyView = {
    to_buy: [
      {
        name: "napa cabbage",
        quantity: 1,
        assumed_quantity: true,
        for_recipes: [],
        origin: "list",
        key: DIFF.siblings.line,
        kind: "grocery",
        domain: "grocery",
        substitutes: [
          {
            id: sibId,
            label: sibLabel, // labelOf → the node's curated display_name, not the raw id
            relation: { role: "sibling", kind: "general", via: DIFF.siblings.parent, via_label: DIFF.siblings.parent },
            in_pantry: false,
          },
        ],
      },
    ],
    pantry_covered: [],
    in_cart: [],
    underived: [],
    location: null,
    flyer_as_of: null,
  };
  await page.route("**/api/grocery/to-buy**", (route) => route.fulfill({ json: view }));
  await groceryPage.goto();

  // The offered swap shows the curated label — the value `swapSibling` posts as `name`.
  const probe = groceryPage.subRow("napa cabbage");
  await expect(groceryPage.subLabel(probe)).toHaveText(sibLabel);

  // Accept → the REAL add-by-id write. The stored row keys on the CANONICAL id (`normalized_name`)
  // and stores the posted display as its `name` (key and display stored separately), display_name
  // null — so the row keys on the id while rendering the clean label.
  await groceryPage.acceptSub(probe);
  await expect.poll(() => groceryPage.rowStatus(sibId)).toBe("active");
  const stored = await groceryPage.row(sibId);
  expect(stored?.name).toBe(sibLabel); // the posted display, not the raw id
  expect(stored?.name).not.toContain("::");
  expect(stored?.normalized_name).toBe(sibId); // the canonical id is the key
  expect(stored?.display_name).toBeNull();

  // Drop the interception and reload: the REAL enriched derivation renders the materialized row's
  // label via `display_name ?? name` — here the row's own display `name` ("Green cabbage"). Both the
  // rendered text and the row's `data-name` are that display; the raw canonical id is NEVER rendered.
  await page.unroute("**/api/grocery/to-buy**");
  await groceryPage.goto();
  const rendered = groceryPage.anyItem(sibLabel); // located by its display (data-name = the label)
  await expect(rendered).toBeVisible();
  await expect(rendered.locator(".g-name").first()).toHaveText(sibLabel);
  await expect(groceryPage.anyItem(sibId)).toHaveCount(0); // the raw canonical id is never a rendered row
  await groceryPage.captureForReview("grocery-swap-reified-label");

  // Cleanup: drop the row this accept materialized (the seeded family rows stay untouched).
  await groceryPage.removeRow(sibId);
});

test("dismiss is per-session client state — the hint reappears on reload", async ({ page, groceryPage }) => {
  const view: ToBuyView = {
    to_buy: [
      {
        name: "halloumi",
        quantity: 1,
        assumed_quantity: true,
        for_recipes: [],
        origin: "list",
        key: "halloumi",
        kind: "grocery",
        domain: "grocery",
        substitutes: [
          {
            id: "paneer",
            label: "paneer",
            relation: { role: "sibling", kind: "membership", via: "grilling cheese" },
            in_pantry: true,
          },
        ],
      },
    ],
    pantry_covered: [],
    in_cart: [],
    underived: [],
    location: null,
    flyer_as_of: null,
  };
  await page.route("**/api/grocery/to-buy**", (route) => route.fulfill({ json: view }));
  await groceryPage.goto();

  await expect(groceryPage.subRow("halloumi")).toBeVisible();
  await groceryPage.dismissSub(groceryPage.subRow("halloumi"));
  await expect(groceryPage.subRows("halloumi")).toHaveCount(0);
  await groceryPage.goto();
  await expect(groceryPage.subRow("halloumi")).toBeVisible(); // never persisted
});

// ── Same-identity alternatives in the order dialog (D4/D5), driven by route
// interception of both the order preview and the slim substitutions op. ─────────────

test("cheaper + on-sale alternatives substantiate their pills with real prices in the order dialog; a swap stages an order override", async ({
  page,
  groceryPage,
}) => {
  // A clean stale-cart slate regardless of what earlier specs left in-cart (order-
  // flow's own posture) — this test's assertion is about the alternatives pills and
  // the commit body, not the stale-cart gate.
  await groceryPage.deactivateInCart();
  await groceryPage.goto();

  const preview = orderOutcome({
    resolved: [resolvedLine("chicken thighs"), resolvedLine("coconut milk")],
  });
  await interceptOrder(page, { preview });
  await interceptSubs(
    page,
    subsResult({
      suggestions: [
        line({
          for: { name: "chicken thighs", key: "chicken thighs", origin: "list" },
          current: {
            sku: "CUR-1",
            brand: "Kroger",
            description: "Chicken Thighs Value Pack",
            size: "16 oz",
            price: { regular: 6.72, promo: 0 },
            on_sale: false,
            available: true,
            unit_price: 0.0148, // $/g — the dialog renders $0.42/oz
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
    }),
  );

  await groceryPage.openOrder();
  await expect(groceryPage.orderPanel()).toBeVisible();

  // The cheaper claim carries BOTH unit prices — never a bare pill.
  const cheapRow = groceryPage.orderSubRow("chicken thighs");
  await expect(cheapRow.getByTestId("subs-reason")).toHaveText("cheaper — $0.31/oz vs $0.42/oz");
  const saleRow = groceryPage.orderSubRow("coconut milk");
  await expect(saleRow.getByTestId("subs-reason")).toHaveText("on sale — $2.50 (was $3.29)");
  await groceryPage.captureForReview("order-alternatives-cheaper-onsale");

  // Accepting a same-identity swap stages an order override — no server write yet.
  await groceryPage.acceptSub(cheapRow);
  await expect(cheapRow.getByTestId("subs-staged")).toBeVisible();

  // The staged pick rides the ORDER commit body: intercept the (non-preview) request.
  let commitBody: PlaceOrderInput | undefined;
  await page.route("**/api/grocery/order", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as PlaceOrderInput;
    if (body.preview) {
      await route.fulfill({ json: preview });
      return;
    }
    commitBody = body;
    await route.fulfill({ json: orderOutcome({ preview: false, resolved: preview.resolved, cart: { written: true, count: 2 }, list: { advanced: true }, sku_cache: { committed: true } }) });
  });
  await groceryPage.commitOrder();
  await expect.poll(() => commitBody?.overrides ?? null).toEqual([{ name: "chicken thighs", sku: "ALT-CHEAP" }]);
});

test("an out-of-stock current pick is cued and its alternative reads in stock now", async ({ page, groceryPage }) => {
  await interceptOrder(page, { preview: orderOutcome({ resolved: [resolvedLine("scallions")] }) });
  await interceptSubs(
    page,
    subsResult({
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

  await groceryPage.openOrder();
  const row = groceryPage.orderSubRow("scallions");
  await expect(row.getByTestId("subs-out-of-stock")).toHaveText("out of stock");
  await expect(row.getByTestId("subs-reason")).toHaveText("in stock now");
  await groceryPage.captureForReview("order-alternatives-out-of-stock");
});

test("no alternatives renders nothing in the order dialog — never an empty container", async ({ page, groceryPage }) => {
  await interceptOrder(page, { preview: orderOutcome({ resolved: [resolvedLine("olive oil")] }) });
  await interceptSubs(
    page,
    subsResult({
      suggestions: [line({ for: { name: "olive oil", key: "olive oil", origin: "list" }, status: "no_cached_pick" })],
    }),
  );

  await groceryPage.openOrder();
  await expect(groceryPage.orderLine("olive oil")).toBeVisible();
  await expect(groceryPage.orderSubRow("olive oil")).toHaveCount(0);
});
