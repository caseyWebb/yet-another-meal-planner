// Sidebar badge counts (member-app-core, sidebar-live-counts): the two badges derive from
// one shared read so a badge and its page can't disagree. Proven against routed fixtures
// rather than the shared seed: the plan badge counts schedulable meal rows only (project
// rows excluded, D26); the grocery badge is the derived to-buy line count (in-flight rows
// are already absent from that derivation, D28). The reads are stubbed before login so the
// shell's badge fetches resolve to the fixtures.
import { test, expect } from "../fixtures";
import type { ToBuyView } from "../../../src/order-shapes";

// Two schedulable meals + one project row: the badge must read 2, not 3 (D26 — projects
// ride the meal column but are not schedulable slots).
const PLAN = {
  planned: [
    { id: "row-dinner", recipe: "viz-miso-salmon", meal: "dinner", planned_for: "2026-07-13", sides: [] },
    { id: "row-lunch", recipe: "viz-beef-ragu", meal: "lunch", planned_for: "2026-07-14", sides: [] },
    { id: "row-project", recipe: "viz-focaccia", meal: "project", planned_for: null, sides: [] },
  ],
};

// Three derived to-buy lines: the badge reads the DERIVATION's line count (the same read
// the grocery page renders), not a raw stored-row status filter.
const TO_BUY: ToBuyView = {
  to_buy: [
    { name: "salmon", quantity: 1, assumed_quantity: true, for_recipes: ["viz-miso-salmon"], origin: "plan", key: "salmon", kind: "grocery", domain: "grocery" },
    { name: "miso", quantity: 1, assumed_quantity: true, for_recipes: ["viz-miso-salmon"], origin: "plan", key: "miso", kind: "grocery", domain: "grocery" },
    { name: "ground beef", quantity: 1, assumed_quantity: true, for_recipes: ["viz-beef-ragu"], origin: "list", key: "ground-beef", kind: "grocery", domain: "grocery" },
  ],
  checked: [],
  pantry_covered: [],
  in_cart: [],
  underived: [],
};

test("the plan badge counts schedulable meals only and the grocery badge is the to-buy count", async ({
  page,
  shellPage,
  asMember,
}) => {
  await page.route("**/api/plan", (route) => route.fulfill({ json: PLAN }));
  await page.route("**/api/grocery/to-buy**", (route) => route.fulfill({ json: TO_BUY }));
  await asMember();

  await expect(shellPage.navBadge("Meal plan")).toHaveText("2");
  await expect(shellPage.navBadge("Grocery list")).toHaveText("3");
});

test("a zero derived count renders no badge", async ({ page, shellPage, asMember }) => {
  await page.route("**/api/plan", (route) => route.fulfill({ json: { planned: [{ id: "row-project", recipe: "viz-focaccia", meal: "project", planned_for: null, sides: [] }] } }));
  await page.route("**/api/grocery/to-buy**", (route) =>
    route.fulfill({ json: { to_buy: [], checked: [], pantry_covered: [], in_cart: [], underived: [] } satisfies ToBuyView }),
  );
  await asMember();
  await shellPage.landmark();

  // A plan of only project rows and an empty to-buy view leave both badges unrendered.
  await expect(shellPage.navBadge("Meal plan")).toHaveCount(0);
  await expect(shellPage.navBadge("Grocery list")).toHaveCount(0);
});
