import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
import type { InstacartHandoffResult } from "@yamp/worker/instacart-shapes";

const G = SEED.app.grocery;
const TB = SEED.app.toBuy;

async function enableInstacart(page: import("@playwright/test").Page, enabled = true): Promise<void> {
	await page.route("**/api/profile/store-adapters", async (route) => {
		const response = await route.fetch();
		const body = await response.json() as { adapters: Record<string, unknown>; launcher: unknown[] };
		body.adapters.instacart = { kind: "instacart", available: true };
		body.launcher.push({ id: "instacart", adapter: "instacart", mode: "marketplace_handoff", store: null, enabled, disabled_reason: enabled ? null : "instacart_unavailable" });
		await route.fulfill({ response, json: body });
	});
}

test.beforeEach(async ({ asMember, groceryPage }) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.landmark();
});

test("the shared page uses Department/Recipe and keeps household lines first-class", async ({
	groceryPage,
}) => {
	await expect(
		groceryPage.page.getByRole("radio", { name: "Department" }),
	).toBeVisible();
	await expect(
		groceryPage.page.getByRole("radio", { name: "Recipe" }),
	).toBeVisible();
	await expect(
		groceryPage.page.getByText("Category", { exact: true }),
	).toHaveCount(0);
	await expect(groceryPage.group("Household")).toContainText(G.household);
	await groceryPage.captureForReview("grocery-department-list");
	await groceryPage.setGroupMode("Recipe");
	await expect(groceryPage.group("No recipe")).toBeVisible();
});

test("the launcher remains driven by the shared store-adapter projection", async ({
	groceryPage,
}) => {
	await expect(groceryPage.launcherEntry("kroger")).toContainText(
		SEED.app.storeAdapters.kroger.name,
	);
	await expect(
		groceryPage.launcherEntry("kroger").getByRole("button"),
	).toBeEnabled();
	await expect(groceryPage.launcher()).not.toContainText("Instacart");
	await groceryPage.captureForReview("grocery-store-launcher");
});

test("configured Instacart keeps exact CTA branding through loading and uses a real same-tab handoff after an underived warning", async ({ groceryPage, page }) => {
	await enableInstacart(page);
	const result: InstacartHandoffResult = { status: "ready", url: "https://www.instacart.com/store/yamp-test", expires_at: "2026-08-11T12:00:00Z", reused: false, item_count: 2, underived: ["missing-recipe"], destination: "instacart_marketplace" };
	let apiCalls = 0;
	let release!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	await page.route("**/api/grocery/instacart", async (route) => { apiCalls += 1; await held; await route.fulfill({ json: result }); });
	await page.route(result.url, (route) => route.fulfill({ contentType: "text/html", body: "<title>Instacart handoff fixture</title>" }));
	await page.reload(); await groceryPage.landmark();
	const cta = groceryPage.instacartCta();
	await expect(cta).toHaveText("Shop on Instacart");
	await expect(cta.locator("img")).toHaveAttribute("src", "/brands/instacart-carrot.svg");
	await expect(cta).toHaveCSS("height", "46px"); await expect(cta).toHaveCSS("border-radius", "29.5px");
	await expect(cta).toHaveCSS("background-color", "rgb(0, 61, 41)");
	const logo = await cta.locator("img").boundingBox(); expect(logo?.height).toBe(22); expect(logo?.width).toBeGreaterThan(17); expect(logo?.width).toBeLessThan(18);
	await expect(groceryPage.launcherEntry("instacart")).toContainText("Choose a retailer, review matches, add items, and check out on Instacart.");
	await cta.click();
	await expect(cta).toHaveText("Shop on Instacart"); await expect(cta).toHaveAttribute("aria-busy", "true");
	await expect(cta).toHaveCSS("background-color", "rgb(0, 61, 41)"); await expect(cta).toHaveCSS("color", "rgb(250, 241, 229)"); await expect(cta).toHaveCSS("opacity", "1");
	await expect(groceryPage.instacartStatus()).toHaveText("Creating an Instacart shopping page…");
	release();
	await expect(groceryPage.instacartStatus()).toContainText("missing ingredient details");
	await expect(page.getByTestId("instacart-continue")).toBeVisible(); expect(apiCalls).toBe(1);
	await expect(page).toHaveURL(/\/grocery$/);
	await expect(groceryPage.launcherEntry("instacart")).not.toContainText(/cart populated|order placed|savings|delivery/i);
	await groceryPage.captureForReview("grocery-instacart-launcher");
	await groceryPage.addItem("pending invalidation item");
	await expect(groceryPage.item("pending invalidation item")).toBeVisible();
	await expect(page.getByTestId("instacart-continue")).toHaveCount(0);
	await cta.click();
	await expect(page.getByTestId("instacart-continue")).toBeVisible(); expect(apiCalls).toBe(2);
	await page.getByTestId("instacart-continue").click();
	await expect(page).toHaveURL(result.url);
});

test("complete Instacart ready navigates same-tab in one click and one API request", async ({ groceryPage, page }) => {
	await enableInstacart(page);
	const result: InstacartHandoffResult = { status: "ready", url: "https://www.instacart.com/store/yamp-complete", expires_at: "2026-08-11T12:00:00Z", reused: false, item_count: 2, underived: [], destination: "instacart_marketplace" };
	let calls = 0;
	await page.route("**/api/grocery/instacart", (route) => { calls += 1; return route.fulfill({ json: result }); });
	await page.route(result.url, (route) => route.fulfill({ contentType: "text/html", body: "<title>Complete Instacart handoff</title>" }));
	await page.reload(); await groceryPage.landmark();
	await groceryPage.instacartCta().click();
	await expect(page).toHaveURL(result.url); expect(calls).toBe(1);
});

test("a disabled Instacart projection is inert and makes no request", async ({ groceryPage, page }) => {
	await enableInstacart(page, false);
	let calls = 0; await page.route("**/api/grocery/instacart", (route) => { calls += 1; return route.fulfill({ json: { status: "unavailable", code: "not_configured" } }); });
	await page.reload(); await groceryPage.landmark();
	await expect(groceryPage.instacartCta()).toBeDisabled();
	await expect(groceryPage.instacartCta()).toHaveAttribute("title", "Instacart is not configured.");
	await expect(groceryPage.instacartCta()).toHaveCSS("background-color", "rgb(0, 61, 41)"); await expect(groceryPage.instacartCta()).toHaveCSS("color", "rgb(250, 241, 229)"); await expect(groceryPage.instacartCta()).toHaveCSS("opacity", "1");
	expect(calls).toBe(0);
});

test("Instacart typed empty and structured errors never claim success", async ({ groceryPage, page }) => {
	await enableInstacart(page); await page.reload(); await groceryPage.landmark();
	const states: Array<[InstacartHandoffResult, RegExp]> = [
		[{ status: "empty", item_count: 0, underived: [] }, /to-buy list is empty/i],
		[{ status: "unavailable", code: "not_configured" }, /not configured/i],
		[{ status: "error", code: "unauthorized", retryable: false }, /not authorized/i],
		[{ status: "error", code: "forbidden", retryable: false }, /not allowed/i],
		[{ status: "error", code: "rate_limited", retryable: true }, /busy/i],
		[{ status: "error", code: "upstream_unavailable", retryable: true }, /temporarily unavailable/i],
		[{ status: "error", code: "invalid_request", retryable: false }, /could not build/i],
		[{ status: "error", code: "invalid_response", retryable: false }, /unusable/i],
	];
	let next = states[0]![0];
	await page.route("**/api/grocery/instacart", (route) => route.fulfill({ json: next }));
	for (const [result, expected] of states) {
		next = result; await groceryPage.instacartCta().click();
		await expect(groceryPage.instacartStatus()).toHaveText(expected);
		await expect(groceryPage.instacartStatus()).not.toContainText(/carted|ordered|purchased/i);
	}
});

test("the order review is a labelled expanded disclosure", async ({
	groceryPage,
	page,
}) => {
	await page.route("**/api/grocery/order/review", (route) => {
		expect(route.request().headers()["x-app-csrf"]).toBe("1");
		return route.fulfill({
			json: {
				contract_version: 1,
				preview_fingerprint: "fixture",
				grocery_snapshot_version: "fixture",
				as_of: "2026-07-12T12:00:00Z",
				store: { name: "Kroger", location_id: "1" },
				quote_disclaimer: "Current quote",
				stale_cart_count: 0,
				cleared_cart_ack_required: false,
				matched: [],
				decisions: [],
				left_off: [],
				underived: [],
				counts: { going_to_cart: 0, needs_decision: 0, left_off: 0 },
				estimated_total: null,
				flyer_savings: null,
				stage: {
					skipped: [],
					quantities: {},
					selections: [],
					impulses: [],
					saved_brands: [],
				},
			},
		});
	});
	const launcher = groceryPage.page.getByTestId("order-open");
	await expect(launcher).toHaveAttribute("aria-expanded", "false");
	await expect(launcher).toHaveAttribute(
		"aria-controls",
		"grocery-order-review",
	);

	await launcher.click();
	await expect(launcher).toHaveAttribute("aria-expanded", "true");
	const review = groceryPage.page.getByRole("region", { name: "Order review" });
	await expect(review).toHaveAttribute("id", "grocery-order-review");
	await expect(review).toBeVisible();
	await launcher.click();
	await expect(launcher).toHaveAttribute("aria-expanded", "false");
	await expect(review).toHaveCount(0);

	await launcher.click();
	await expect(review).toBeVisible();
	await review.getByRole("button", { name: "Close order review" }).click();
	await expect(launcher).toHaveAttribute("aria-expanded", "false");
	await expect(review).toHaveCount(0);
	await expect(launcher).toBeFocused();
});

test("order review projects staged choices and latches a failed send with exact partial steps", async ({
	groceryPage,
	page,
}) => {
	const milk = {
		sku: "milk-1",
		brand: "A",
		description: "Whole milk",
		size: "1 gal",
		price: { regular: 4, promo: 3 },
		on_sale: true,
		fulfillment: { curbside: true, delivery: true },
	};
	const bread = {
		sku: "bread-1",
		brand: "B",
		description: "Wheat bread",
		size: "20 oz",
		price: { regular: 5, promo: 5 },
		on_sale: false,
		fulfillment: { curbside: true, delivery: false },
	};
	const preview = {
		contract_version: 1,
		preview_fingerprint: "stage-fixture",
		grocery_snapshot_version: "grocery-fixture",
		as_of: "2026-07-12T12:00:00Z",
		store: { name: "Kroger Oak", location_id: "1" },
		quote_disclaimer: "Current send-time estimate",
		stale_cart_count: 2,
		cleared_cart_ack_required: true,
		matched: [
			{
				line_key: "milk",
				name: "milk",
				display_name: "Milk",
				quantity: 1,
				assumed_quantity: true,
				for_recipes: [],
				provenance: "planned",
				selected: milk,
				selection_source: "matched",
				options: [{ ...milk, sku: "milk-2", description: "Featured milk" }],
				featured_swap: { ...milk, sku: "milk-2", description: "Featured milk" },
				family_key: "milk",
				family_fingerprint: "fm",
			},
		],
		decisions: [
			{
				line_key: "bread",
				name: "bread",
				display_name: "Bread",
				quantity: 1,
				assumed_quantity: false,
				for_recipes: [],
				provenance: "planned",
				kind: "choose_one",
				candidates: [bread],
				family_key: "bread",
				family_fingerprint: "fb",
				can_save_brand: true,
				can_search_broader: false,
				can_search_manual: false,
			},
		],
		left_off: [],
		underived: [],
		counts: { going_to_cart: 1, needs_decision: 1, left_off: 1 },
		estimated_total: 3,
		flyer_savings: 1,
		stage: {
			skipped: [],
			quantities: {},
			selections: [],
			impulses: [],
			saved_brands: [],
		},
	};
	let sends = 0;
	await page.route("**/api/grocery/order/review", async (route) => {
		expect(route.request().headers()["x-app-csrf"]).toBe("1");
		const body = route.request().postDataJSON() as {
			stage?: typeof preview.stage;
		};
		await route.fulfill({
			json: { ...preview, stage: body.stage ?? preview.stage },
		});
	});
	await page.route("**/api/grocery/order", async (route) => {
		sends += 1;
		expect(route.request().headers()["x-app-csrf"]).toBe("1");
		await page.waitForTimeout(100);
		await route.fulfill({
			json: {
				status: "send_failed",
				steps: {
					list: {
						advanced: true,
						rolled_back: false,
						error: "rollback unavailable",
					},
					cart: {
						written: false,
						error: "Kroger authorization expired",
						code: "reauth_required",
					},
					send: { recorded: false, error: "rolled back" },
					cache: {
						committed: false,
						inserted: [],
						updated: [],
						unchanged: [],
						error: "cart was not written",
					},
				},
				left_off: [{ line_key: "bread", name: "Bread", reason: "undecided" }],
				verified_saved_brands: [],
			},
		});
	});
	await groceryPage.page.getByTestId("order-open").click();
	const review = page.getByRole("region", { name: "Order review" });
	await expect(
		review.getByText(/Featured swap:.*Featured milk/),
	).toBeVisible();
	await expect(review.getByLabel("Search catalog for bread")).toHaveCount(0);
	await expect(
		review.getByRole("button", { name: "Send to Kroger" }),
	).toBeDisabled();
	await review.getByLabel("B Wheat bread · 20 oz").check();
	await review
		.getByLabel("I've cleared the old Kroger cart (2 prior items)")
		.check();
	const send = review.getByRole("button", { name: "Send to Kroger" });
	await expect(send).toBeEnabled();
	await send.dblclick();
	await expect(review.getByTestId("order-review-failed-steps")).toContainText(
		"rollback did not complete",
	);
	await expect(review.getByTestId("order-review-failed-steps")).toContainText(
		"Kroger authorization expired",
	);
	expect(sends).toBe(1);
	await groceryPage.captureForReview("order-review-partial-failure");
});

test("unknown-newer order review remains readable and locks every staged control", async ({
	groceryPage,
	page,
}) => {
	await page.route("**/api/grocery/order/review", (route) =>
		route.fulfill({
			json: {
				contract_version: 2,
				preview_fingerprint: "future",
				grocery_snapshot_version: "future-g",
				as_of: "2026-07-12T12:00:00Z",
				store: { name: "Future Kroger", location_id: "1" },
				quote_disclaimer: "Saved quote",
				stale_cart_count: 0,
				cleared_cart_ack_required: false,
				matched: [
					{
						line_key: "milk",
						name: "milk",
						quantity: 1,
						assumed_quantity: true,
						for_recipes: [],
						provenance: "planned",
						selected: {
							sku: "1",
							brand: "A",
							description: "Milk",
							size: null,
							price: { regular: 3, promo: 3 },
							on_sale: false,
							fulfillment: { curbside: true, delivery: true },
						},
						selection_source: "matched",
						options: [],
						family_key: "milk",
						family_fingerprint: "f",
					},
				],
				decisions: [],
				left_off: [],
				underived: [],
				counts: { going_to_cart: 1, needs_decision: 0, left_off: 0 },
				estimated_total: 3,
				flyer_savings: 0,
				stage: {
					skipped: [],
					quantities: {},
					selections: [],
					impulses: [],
					saved_brands: [],
				},
				future_field: true,
			},
		}),
	);
	await groceryPage.page.getByTestId("order-open").click();
	const review = page.getByRole("region", { name: "Order review" });
	await expect(review).toContainText("read-only");
	await expect(review.getByRole("button", { name: "Skip" })).toBeDisabled();
	await expect(
		review.getByRole("button", { name: "Send to Kroger" }),
	).toBeDisabled();
	await expect(
		review.getByRole("button", { name: "Add to this order" }),
	).toBeDisabled();
});

test("checking is durable and never changes cart status", async ({
	groceryPage,
}) => {
	const name = G.active[0];
	await groceryPage.toggleChecked(name);
	await expect(groceryPage.item(name)).toHaveAttribute("data-checked", "true");
	await expect.poll(() => groceryPage.rowChecked(name)).toBe(true);
	expect(await groceryPage.rowStatus(name)).toBe("active");
	await groceryPage.toggleChecked(name);
});

test("a virtual plan line materializes exactly once when checked", async ({
	groceryPage,
}) => {
	await groceryPage.setPlan([TB.planned]);
	await groceryPage.goto();
	await expect(groceryPage.item(TB.virtual)).toHaveAttribute(
		"data-origin",
		"plan",
	);
	await groceryPage.toggleChecked(TB.virtual);
	await expect.poll(() => groceryPage.rowChecked(TB.virtual)).toBe(true);
	await groceryPage.goto();
	await expect(groceryPage.item(TB.virtual)).toHaveAttribute(
		"data-origin",
		"both",
	);
	await groceryPage.removeRow(TB.virtual);
});

test("two sends render separately with persisted quote honesty, aging, household and unlinked states", async ({
	groceryPage,
}) => {
	const fixture = {
		contract_version: 1,
		snapshot_version: "fixture",
		as_of: "2026-07-12T12:00:00Z",
		lines: [
			{
				key: "paper towels",
				name: "Paper towels",
				quantity: "1",
				kind: "household",
				domain: "grocery",
				origin: "list",
				checked_at: null,
				row_version: 1,
				updated_at: null,
				for_recipes: [],
			},
		],
		to_buy: ["paper towels"],
		pantry_covered: [],
		underived: ["mystery-stew"],
		location: null,
		flyer_as_of: null,
		in_cart_groups: [
			{
				send_id: "old",
				store: "Kroger",
				location_id: "1",
				fulfillment: "kroger_online",
				sent_at: "2026-07-08T00:00:00Z",
				placed_at: null,
				awaiting_confirmation: true,
				estimated_total: 12.5,
				flyer_savings: 2.25,
				can_mark_placed: true,
				lines: [
					{
						key: "milk",
						name: "Milk",
						quantity: 1,
						row_version: 2,
						unit_price: 4,
						savings: 1,
					},
				],
			},
			{
				send_id: "new",
				store: "Target",
				location_id: null,
				fulfillment: "satellite",
				sent_at: "2026-07-12T10:00:00Z",
				placed_at: null,
				awaiting_confirmation: false,
				estimated_total: 8,
				flyer_savings: 0,
				can_mark_placed: true,
				lines: [
					{
						key: "eggs",
						name: "Eggs",
						quantity: 1,
						row_version: 2,
						unit_price: 8,
						savings: 0,
					},
				],
			},
			{
				send_id: null,
				store: null,
				location_id: null,
				fulfillment: null,
				sent_at: null,
				placed_at: null,
				awaiting_confirmation: false,
				estimated_total: null,
				flyer_savings: null,
				can_mark_placed: false,
				lines: [
					{
						key: "manual",
						name: "Manual item",
						quantity: 1,
						row_version: 1,
						unit_price: null,
						savings: null,
					},
				],
			},
		],
		counts: { to_buy: 1, checked: 0, in_carts: 3, recipes: 0 },
	};
	await groceryPage.page.route("**/api/grocery/view", (route) =>
		route.fulfill({ json: fixture }),
	);
	await groceryPage.goto();
	await expect(groceryPage.cartGroups()).toHaveCount(3);
	await expect(
		groceryPage.page.getByText("Sent estimate $12.50"),
	).toBeVisible();
	await expect(
		groceryPage.page
			.getByText(/Send-time quote, not a final fulfillment price/)
			.first(),
	).toBeVisible();
	await expect(
		groceryPage.page.getByText("Awaiting confirmation"),
	).toBeVisible();
	await expect(
		groceryPage.page.getByText("In cart — no send record"),
	).toBeVisible();
	await groceryPage.captureForReview("grocery-two-send-groups");
});

test("unknown-newer fixture remains readable when rendered by the shared component", async ({
	groceryPage,
}) => {
	const fixture = {
		contract_version: 3,
		snapshot_version: "unknown-newer-v3",
		as_of: "2026-07-12T12:00:00Z",
		lines: [
			{
				key: "future milk",
				name: "Future milk",
				quantity: 1,
				kind: "grocery",
				domain: "grocery",
				origin: "list",
				checked_at: null,
				row_version: 1,
				updated_at: null,
				for_recipes: [],
			},
		],
		to_buy: ["future milk"],
		pantry_covered: [],
		in_cart_groups: [],
		underived: [],
		location: null,
		flyer_as_of: null,
		counts: { to_buy: 1, checked: 0, in_carts: 0, recipes: 0 },
		future_widget_field: { preserved: true },
	};
	await groceryPage.page.route("**/api/grocery/view", (route) =>
		route.fulfill({ json: fixture }),
	);
	await groceryPage.goto();
	await expect(
		groceryPage.page.getByTestId("shared-grocery-list"),
	).toBeVisible();
	await expect(groceryPage.item("Future milk")).toBeVisible();
	await expect(
		groceryPage.page.getByTestId("shared-grocery-list"),
	).toHaveAttribute("data-host-mode", "readonly");
	await expect(
		groceryPage.item("Future milk").getByRole("checkbox"),
	).toBeDisabled();
	await expect(groceryPage.page.getByLabel("Add grocery item")).toBeDisabled();
	await groceryPage.setViewport(390, 844);
	await groceryPage.captureForReview("grocery-mobile");
});
