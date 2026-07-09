// Grocery (member-app-core 7.7 + member-app-grocery 6.2): the P1 stored-row flows
// (category groups, explicit in-cart set, Clear purchased, add-row) now rendered from
// the DERIVED to-buy view, plus the view itself LIVE against the seeded Worker —
// virtual rows with plan attribution, the canonical-id both-merge, pantry coverage with
// the stale-verify nudge, materialize-on-pin (and un-pin re-derives), the underived
// notice — and the widened W3 boundary (ordered accepted ONLY as the in_cart advance).
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

const G = SEED.app.grocery;
const TB = SEED.app.toBuy;

test.beforeEach(async ({ asMember, groceryPage }) => {
  await asMember();
  await groceryPage.goto();
  await groceryPage.landmark();
});

test("items group by category; household goods sit apart from groceries", async ({ groceryPage }) => {
  await groceryPage.expectInCategoryGroup(G.active[0], "grocery");
  await groceryPage.expectInCategoryGroup(G.household, "household");
  await groceryPage.expectInCartGroup(G.inCart); // the seeded in_cart row
});

test("the in-cart control is an explicit set, both directions", async ({ groceryPage }) => {
  await groceryPage.toggleCart(G.active[1]);
  await groceryPage.expectInCartGroup(G.active[1]);
  await groceryPage.uncart(G.active[1]); // back to the list
  await groceryPage.expectInCategoryGroup(G.active[1], "grocery");
});

test("virtual rows derive from the plan with attribution; a stored row the plan needs reads both", async ({
  groceryPage,
}) => {
  await groceryPage.setPlan([TB.planned]);
  await groceryPage.goto();
  // A derived-only line: no grocery row exists, yet it renders — from the plan.
  await groceryPage.expectOrigin(TB.virtual, "plan");
  await expect(groceryPage.originCue(TB.virtual)).toBeVisible();
  await expect(groceryPage.item(TB.virtual).locator(".g-for")).toContainText(TB.planned);
  // No remove on a virtual row (D6) — only the pin affordance.
  await expect(groceryPage.item(TB.virtual).getByTestId("grocery-remove")).toHaveCount(0);
  await expect(groceryPage.item(TB.virtual).getByTestId("grocery-pin")).toBeVisible();
  // The seeded active row the plan also needs merged on the canonical id: ONE line, both.
  await groceryPage.expectOrigin(TB.both, "both");
  await expect(groceryPage.item(TB.both)).toHaveCount(1);
  await groceryPage.captureForReview("grocery-derived-view");
});

test("pantry coverage renders with the stale-verify nudge and the buy-fresh materialize", async ({
  groceryPage,
}) => {
  await groceryPage.setPlan([TB.planned]);
  await groceryPage.goto();
  // The stale-verified perishable covering a derived need sits in Already-in-your-pantry
  // (NOT in to-buy), flagged with the unchecked duration + both actions.
  await expect(groceryPage.coveredItem(TB.covered)).toBeVisible();
  await expect(groceryPage.item(TB.covered)).toHaveCount(0);
  await expect(groceryPage.staleFlag(TB.covered)).toContainText(/\d+d unchecked/);
  await expect(groceryPage.coveredItem(TB.covered).getByTestId("ph-verify")).toBeVisible();
  await groceryPage.captureForReview("grocery-pantry-have");
  // Buy fresh MATERIALIZES the item onto the list (the pantry still covers it in the
  // view — order-time partials confirm the buy); verifying stays the pantry spec's flow
  // (this spec must not stamp the seeded row, which pantry.spec asserts is still stale).
  await groceryPage.buyFresh(TB.covered);
  await expect.poll(() => groceryPage.rowStatus(TB.covered)).toBe("active");
  await groceryPage.removeRow(TB.covered); // leave the seeded state for later specs
});

test("pinning a virtual row materializes it (origin both); removing the row re-derives it", async ({
  groceryPage,
}) => {
  await groceryPage.setPlan([TB.planned]);
  await groceryPage.goto();
  await groceryPage.pin(TB.virtual);
  await groceryPage.expectOrigin(TB.virtual, "both"); // merged under the same canonical id
  await expect.poll(() => groceryPage.rowStatus(TB.virtual)).toBe("active");
  // Un-pinning (removing the materialized row) un-pins, not un-plans (D6): the next
  // read derives the line again as a virtual row.
  await groceryPage.removeRow(TB.virtual);
  await groceryPage.goto();
  await groceryPage.expectOrigin(TB.virtual, "plan");
});

test("an underived planned recipe surfaces as the quiet notice, never silently dropped", async ({
  groceryPage,
}) => {
  await groceryPage.setPlan([TB.planned, TB.underived]);
  await groceryPage.goto();
  await expect(groceryPage.underivedNotice()).toContainText(TB.underived);
  await groceryPage.setPlan([TB.planned]); // restore
  await groceryPage.goto();
  await expect(groceryPage.underivedNotice()).toHaveCount(0);
});

test("Clear purchased removes each in_cart row (received is terminal removal)", async ({
  groceryPage,
}) => {
  await groceryPage.clearPurchased();
  await expect(groceryPage.anyItem(G.inCart)).toHaveCount(0);
});

test("the bottom add-row appends an item into its category group", async ({ groceryPage }) => {
  await groceryPage.addItem("halloumi", "2 blocks");
  await groceryPage.expectInCategoryGroup("halloumi", "grocery");
  await groceryPage.captureForReview("grocery-after-add");
});

test("W3: ordered is refused from active and accepted only as the in_cart advance", async ({
  groceryPage,
}) => {
  await groceryPage.addRow("w3 probe");
  await groceryPage.goto();
  // Straight to ordered from active: the shared W3 guard rejects it (the boundary now
  // allows the VALUE — mark-order-placed — but never the transition).
  const fromActive = await groceryPage.attemptOrderedWrite("w3 probe");
  expect(fromActive.status).toBe(400);
  expect(fromActive.error).toBe("validation_failed");
  // From in_cart, the user-asserted advance succeeds and stamps ordered_at.
  await groceryPage.toggleCart("w3 probe");
  await groceryPage.expectInCartGroup("w3 probe");
  const fromInCart = await groceryPage.attemptOrderedWrite("w3 probe");
  expect(fromInCart.status).toBe(200);
  expect(fromInCart.ordered_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await groceryPage.removeRow("w3 probe"); // cleanup
});

// ── Aisle grouping (member-app-differentiators 5.3/D6), LIVE against the seeded
// Worker: captured sku_cache placements at the seeded default preferred_location (a
// pre-resolved bare id — no whitespace, no live Kroger network), the honest "Aisle
// unknown" bucket with department sub-groups, and the no-location degradation.

const DIFF = SEED.app.differentiators;

test("aisle mode walks captured placements and collects the rest under an honest Aisle unknown", async ({
  groceryPage,
}) => {
  await groceryPage.setPlan([TB.planned]);
  await groceryPage.goto();
  await groceryPage.setGroupMode("aisle");
  // Captured placements order the list by real aisle numbers…
  await expect(groceryPage.aisleGroup(DIFF.aisles.produce.number)).toContainText(
    `Aisle ${DIFF.aisles.produce.number} · ${DIFF.aisles.produce.description}`,
  );
  await expect(
    groceryPage.aisleGroup(DIFF.aisles.produce.number).locator(`[data-testid="grocery-item"][data-name="${TB.both}"]`),
  ).toBeVisible(); // the scallions row keys under green-onion — the captured produce aisle
  await expect(
    groceryPage
      .aisleGroup(DIFF.aisles.meat.number)
      .locator(`[data-testid="grocery-item"][data-name="${DIFF.aisles.meat.ingredient}"]`),
  ).toBeVisible();
  // …and uncaptured lines land in the labeled bucket — never a fabricated number.
  await expect(groceryPage.unknownGroup()).toContainText("Aisle unknown");
  await expect(
    groceryPage.unknownGroup().locator(`[data-testid="grocery-item"][data-name="${G.active[2]}"]`),
  ).toBeVisible(); // coconut milk: no placement, no department
  await expect(
    groceryPage.unknownDept("Home goods").locator(`[data-testid="grocery-item"][data-name="${G.household}"]`),
  ).toBeVisible(); // the kind fallback sub-group
  await groceryPage.captureForReview("grocery-aisle-grouping");
  // Category mode is one toggle away, unchanged from the shipped page.
  await groceryPage.setGroupMode("category");
  await groceryPage.expectInCategoryGroup(G.active[0], "grocery");
});

test("aisle mode with no resolvable location degrades to departments/categories — no error, no picker", async ({
  groceryPage,
}) => {
  // A walk-store primary has no deterministic placement source (D6/D10): no store
  // picker exists, and grouping falls back honestly.
  await groceryPage.setStores({ primary: "aldi" });
  await groceryPage.goto();
  await groceryPage.setGroupMode("aisle");
  await expect(groceryPage.aisleGroups()).toHaveCount(0);
  // The seeded green-onion membership edge (allium) yields a department tier; the
  // household row keeps its kind bucket.
  await expect(groceryPage.deptGroup("allium")).toBeVisible();
  await expect(groceryPage.kindGroup("household")).toBeVisible();
  await groceryPage.setStores({ primary: "kroger" }); // restore
});
