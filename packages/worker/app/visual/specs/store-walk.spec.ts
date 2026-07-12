import { expect } from "@playwright/test";
import { test } from "../fixtures";

const base = {
  contract_version: 2, snapshot_version: `sha256:${"1".repeat(64)}`, as_of: "2026-07-12T12:00:00Z",
  lines: [
    { key: "apples", name: "Apples", quantity: "2", kind: "grocery", domain: "grocery", origin: "list", checked_at: "2026-07-12T11:00:00Z", row_version: 2, updated_at: null, for_recipes: [] },
    { key: "milk", name: "Milk", quantity: "1", kind: "grocery", domain: "grocery", origin: "list", checked_at: null, row_version: 1, updated_at: null, for_recipes: [] },
    { key: "soap", name: "Soap", quantity: "1", kind: "household", domain: "grocery", origin: "list", checked_at: null, row_version: 1, updated_at: null, for_recipes: [] },
  ], to_buy: ["milk", "soap"], pantry_covered: [], substitution_decisions: [], coverage_decisions: [], in_cart_groups: [], underived: [], location: null, flyer_as_of: null,
  counts: { to_buy: 2, checked: 1, in_carts: 0, recipes: 0 },
  walk_context: { store_slug: "market", shared_name: "Market", display_name: "The close store", domain: "grocery", aisle_map: { state: "stale", aisle_count: 1, as_of: "2025-01-01" }, observed_at: "2025-01-01", groups: [
    { id: "aisle:1", label: "Aisle 1", placement_source: "section_map", line_keys: ["apples"], warning: "stale_map" },
    { id: "cold-last", label: "Grab last", placement_source: "cold_last", line_keys: ["milk"], warning: null },
    { id: "unmapped", label: "Anywhere / Not mapped", placement_source: "unmapped", line_keys: ["soap"], warning: null },
  ] },
};

test("Offline store walk progresses, pauses/resumes, and finishes through one receipt", async ({ asMember, page, groceryPage }) => {
  await asMember();
  let snapshot: typeof base = JSON.parse(JSON.stringify(base)) as typeof base;
  await page.route("**/api/profile/store-adapters", (route) => route.fulfill({ json: { adapters: { kroger: { kind: "kroger", linked: false, preferred: null }, instacart: { kind: "instacart", state: "coming_soon" }, satellites: { kind: "satellites", state: "freshness_unavailable", stores: [] }, offline: { kind: "offline", stores: [], selected_slug: "market", selection_unavailable: false } }, launcher: [{ id: "offline:market", adapter: "offline", mode: "store_walk", store: { slug: "market", name: "The close store", shared_name: "Market", domain: "grocery", aisle_map: base.walk_context.aisle_map }, enabled: true, disabled_reason: null }] } }));
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/grocery/checked", async (route) => {
    const body = route.request().postDataJSON() as { key: string; checked: boolean };
    snapshot = { ...snapshot, lines: snapshot.lines.map((line) => line.key === body.key ? { ...line, checked_at: body.checked ? "2026-07-12T12:01:00Z" : null, row_version: line.row_version + 1 } : line), snapshot_version: `sha256:${"2".repeat(64)}` };
    await route.fulfill({ json: { status: "ok", snapshot } });
  });
  await page.route("**/api/grocery/shop-commit", async (route) => route.fulfill({ json: { outcome: "committed", receipt: { session_id: (route.request().postDataJSON() as { session_id: string }).session_id, mode: "store_walk", store_slug: "market", domain: "grocery", occurred_at: "2026-07-12T12:02:00Z", committed_at: "2026-07-12T12:02:01Z", lines: [], totals: { items: 2, priced: 0, amount: 0, savings: 0 } }, snapshot: { ...snapshot, lines: snapshot.lines.filter((line) => line.checked_at == null), to_buy: ["soap"], counts: { ...snapshot.counts, checked: 0, to_buy: 1 } } } }));
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.startWalk("offline:market");
  await expect(groceryPage.walk()).toContainText("1 of 3 picked");
  await expect(groceryPage.walkGroup("aisle:1")).toContainText("Apples");
  await expect(groceryPage.walkGroup("cold-last")).toContainText("Milk");
  await expect(groceryPage.walkGroup("unmapped")).toContainText("Soap");
  await groceryPage.walkGroup("cold-last").getByRole("checkbox").click();
  await expect(groceryPage.walk()).toContainText("2 of 3 picked");
  await groceryPage.captureForReview("store-walk-desktop");
  await groceryPage.pauseWalk(); await expect(groceryPage.walk()).toHaveCount(0);
  await groceryPage.startWalk("offline:market"); await expect(groceryPage.walk()).toBeVisible();
  await groceryPage.finishWalk(); await expect(page.getByRole("dialog", { name: "Finish this shop?" })).toContainText("Unchecked items stay on the list");
  await groceryPage.confirmFinish(); await expect(page.getByTestId("walk-receipt")).toContainText("2 items received");
  await page.setViewportSize({ width: 430, height: 900 }); await groceryPage.captureForReview("store-walk-tall");
});
