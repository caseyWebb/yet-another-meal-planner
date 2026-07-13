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
  await page.route("**/api/profile/store-adapters", (route) => route.fulfill({ json: { adapters: { kroger: { kind: "kroger", linked: false, preferred: null }, instacart: { kind: "instacart", available: false }, satellites: { kind: "satellites", state: "freshness_unavailable", stores: [] }, offline: { kind: "offline", stores: [], selected_slug: "market", selection_unavailable: false } }, launcher: [{ id: "offline:market", adapter: "offline", mode: "store_walk", store: { slug: "market", name: "The close store", shared_name: "Market", domain: "grocery", aisle_map: base.walk_context.aisle_map }, enabled: true, disabled_reason: null }] } }));
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/grocery/checked", async (route) => {
    const body = route.request().postDataJSON() as { key: string; checked: boolean };
    snapshot = { ...snapshot, lines: snapshot.lines.map((line) => line.key === body.key ? { ...line, checked_at: body.checked ? "2026-07-12T12:01:00Z" : null, row_version: line.row_version + 1 } : line), snapshot_version: `sha256:${"2".repeat(64)}` };
    await route.fulfill({ json: { status: "ok", snapshot } });
  });
  let deliveredVersion = "";
  await page.route("**/api/grocery/shop-commit", async (route) => { deliveredVersion = (route.request().postDataJSON() as { snapshot_version: string }).snapshot_version; await route.fulfill({ json: { outcome: "committed", receipt: { session_id: (route.request().postDataJSON() as { session_id: string }).session_id, mode: "store_walk", store_slug: "market", domain: "grocery", occurred_at: "2026-07-12T12:02:00Z", committed_at: "2026-07-12T12:02:01Z", lines: [], totals: { items: 2, priced: 0, amount: 0, savings: 0 } }, snapshot: { ...snapshot, lines: snapshot.lines.filter((line) => line.checked_at == null), to_buy: ["soap"], counts: { ...snapshot.counts, checked: 0, to_buy: 1 } } } }); });
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
  expect(deliveredVersion).toBe(`sha256:${"2".repeat(64)}`);
  await page.setViewportSize({ width: 430, height: 900 }); await groceryPage.captureForReview("store-walk-tall");
});

test("manual shop remains available without an adapter and uses the frozen checked set", async ({ asMember, page, groceryPage }) => {
  await asMember();
  await page.route("**/api/profile/store-adapters", (route) => route.fulfill({ json: { adapters: { kroger: { kind: "kroger", linked: false, preferred: null }, instacart: { kind: "instacart", available: false }, satellites: { kind: "satellites", state: "freshness_unavailable", stores: [] }, offline: { kind: "offline", stores: [], selected_slug: null, selection_unavailable: false } }, launcher: [] } }));
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: { ...base, walk_context: null } }));
  let request: { mode: string; store_slug: string | null; expected_checked_keys: string[] } | null = null;
  await page.route("**/api/grocery/shop-commit", async (route) => {
    request = route.request().postDataJSON() as typeof request;
    await route.fulfill({ json: { outcome: "committed", receipt: { session_id: "manual", mode: "manual_shop", store_slug: null, domain: "grocery", occurred_at: "2026-07-12T12:02:00Z", committed_at: "2026-07-12T12:02:01Z", lines: [], totals: { items: 1, priced: 0, amount: 0, savings: 0 } }, snapshot: { ...base, lines: base.lines.filter((line) => line.key !== "apples"), walk_context: null } } });
  });
  await groceryPage.goto(); await groceryPage.landmark();
  await groceryPage.launcher().getByRole("button", { name: "Log a manual shop" }).click();
  const dialog = page.getByRole("dialog", { name: "Log this manual shop?" });
  await expect(dialog).toContainText("without a store adapter");
  await dialog.getByRole("button", { name: "Log shop" }).click();
  await expect(page.getByText(/Manual shop logged ·/)).toBeVisible();
  expect(request).toMatchObject({ mode: "manual_shop", store_slug: null, expected_checked_keys: ["apples"] });
});

test("an unknown map still starts as an explicit Not mapped walk", async ({ asMember, page, groceryPage }) => {
  await asMember();
  const unknown = { ...base, walk_context: { ...base.walk_context, aisle_map: { state: "unknown" as const, aisle_count: 0, as_of: null }, observed_at: null, groups: [{ id: "unmapped", label: "Anywhere / Not mapped", placement_source: "unmapped" as const, line_keys: base.lines.map((line) => line.key), warning: null }] } };
  await page.route("**/api/profile/store-adapters", (route) => route.fulfill({ json: { adapters: { kroger: { kind: "kroger", linked: false, preferred: null }, instacart: { kind: "instacart", available: false }, satellites: { kind: "satellites", state: "freshness_unavailable", stores: [] }, offline: { kind: "offline", stores: [], selected_slug: "market", selection_unavailable: false } }, launcher: [{ id: "offline:market", adapter: "offline", mode: "store_walk", store: { slug: "market", name: "The close store", shared_name: "Market", domain: "grocery", aisle_map: unknown.walk_context.aisle_map }, enabled: true, disabled_reason: null }] } }));
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: unknown }));
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.startWalk("offline:market");
  await expect(groceryPage.walkGroup("unmapped")).toContainText("Anywhere / Not mapped");
  await expect(groceryPage.walkGroup("unmapped").getByRole("checkbox")).toHaveCount(3);
});

test("a shop conflict restores the walk with fresh actionable state", async ({ asMember, page, groceryPage }) => {
  await asMember();
  const adapters = { adapters: { kroger: { kind: "kroger", linked: false, preferred: null }, instacart: { kind: "instacart", available: false }, satellites: { kind: "satellites", state: "freshness_unavailable", stores: [] }, offline: { kind: "offline", stores: [], selected_slug: "market", selection_unavailable: false } }, launcher: [{ id: "offline:market", adapter: "offline", mode: "store_walk", store: { slug: "market", name: "The close store", shared_name: "Market", domain: "grocery", aisle_map: base.walk_context.aisle_map }, enabled: true, disabled_reason: null }] };
	await page.route("**/api/profile/store-adapters", (route) => route.fulfill({ json: adapters }));
	await page.route("**/api/grocery/view", (route) => route.fulfill({ json: base }));
  await page.route("**/api/grocery/shop-commit", (route) => route.fulfill({ status: 409, json: { outcome: "checked_set_changed", current_checked_keys: ["apples", "milk"], snapshot: { ...base, snapshot_version: `sha256:${"3".repeat(64)}`, lines: base.lines.map((line) => line.key === "milk" ? { ...line, checked_at: "2026-07-12T12:03:00Z", row_version: 2 } : line) } } }));
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.startWalk("offline:market");
  await groceryPage.finishWalk(); await groceryPage.confirmFinish();
  await expect(groceryPage.walk()).toContainText("The checked list changed. Review it before finishing.");
  await expect(groceryPage.walk().getByRole("button", { name: "Finish", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("yamp:store-walk") ?? "null")?.state)).toBe("active");
});

test("a lost store-walk response retries the identical logical request and adopts the receipt", async ({ asMember, page, groceryPage }) => {
	await asMember();
	const adapters = { adapters: { kroger: { kind: "kroger", linked: false, preferred: null }, instacart: { kind: "instacart", available: false }, satellites: { kind: "satellites", state: "freshness_unavailable", stores: [] }, offline: { kind: "offline", stores: [], selected_slug: "market", selection_unavailable: false } }, launcher: [{ id: "offline:market", adapter: "offline", mode: "store_walk", store: { slug: "market", name: "The close store", shared_name: "Market", domain: "grocery", aisle_map: base.walk_context.aisle_map }, enabled: true, disabled_reason: null }] };
	const afterCommit = { ...base, snapshot_version: `sha256:${"4".repeat(64)}`, lines: base.lines.filter((line) => line.checked_at == null), counts: { ...base.counts, checked: 0 } };
	let durable = false;
	await page.route("**/api/profile/store-adapters", (route) => route.fulfill({ json: adapters }));
	await page.route("**/api/grocery/view", (route) => route.fulfill({ json: durable ? afterCommit : base }));
  const deliveries: Array<{ session_id: string; expected_checked_keys: string[]; occurred_at: string; snapshot_version: string }> = [];
  await page.route("**/api/grocery/shop-commit", async (route) => {
    const body = route.request().postDataJSON() as typeof deliveries[number]; deliveries.push(body);
    if (deliveries.length === 1) { durable = true; return route.abort("failed"); }
    return route.fulfill({ json: { outcome: "replayed", receipt: { session_id: body.session_id, mode: "store_walk", store_slug: "market", domain: "grocery", occurred_at: body.occurred_at, committed_at: "2026-07-12T12:05:00Z", lines: [], totals: { items: 1, priced: 0, amount: 0, savings: 0 } }, snapshot: afterCommit } });
  });
  await groceryPage.goto(); await groceryPage.landmark(); await groceryPage.startWalk("offline:market");
  await groceryPage.finishWalk(); await groceryPage.confirmFinish();
  await expect(groceryPage.walk().getByRole("button", { name: "Finish", exact: true })).toBeDisabled();
  await groceryPage.walk().getByRole("button", { name: "Retry finish" }).click();
  await expect(page.getByTestId("walk-receipt")).toBeVisible();
  expect(deliveries).toHaveLength(2);
  expect({ ...deliveries[1], snapshot_version: undefined }).toEqual({ ...deliveries[0], snapshot_version: undefined });
});
