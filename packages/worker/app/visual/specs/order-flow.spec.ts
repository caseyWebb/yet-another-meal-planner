import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import type {
	OrderReviewData,
	OrderReviewSendResult,
} from "../../../../contract/src/order-review";

const product = (
	sku: string,
	brand: string,
	description: string,
	price: number,
) => ({
	sku,
	brand,
	description,
	size: "12 oz",
	price: { regular: price, promo: 0 },
	on_sale: false,
	fulfillment: { curbside: true, delivery: true },
});

function review(overrides: Partial<OrderReviewData> = {}): OrderReviewData {
	return {
		contract_version: 1,
		preview_fingerprint: "sha256:preview-1",
		grocery_snapshot_version: "sha256:grocery-1",
		as_of: "2026-07-12T12:00:00Z",
		store: { name: "Kroger · West 7th", location_id: "L1" },
		quote_disclaimer: "Current Kroger quotes; fulfillment may differ.",
		stale_cart_count: 0,
		cleared_cart_ack_required: false,
		matched: [
			{
				line_key: "salmon",
				name: "salmon",
				quantity: 1,
				assumed_quantity: true,
				for_recipes: ["miso-salmon"],
				provenance: "planned",
				selected: product("SALMON-1", "Kroger", "Atlantic Salmon", 8),
				selection_source: "matched",
				options: [product("SALMON-2", "Simple Truth", "Atlantic Salmon", 10)],
				family_key: "salmon",
				family_fingerprint: "sha256:salmon",
			},
			{
				line_key: "rice",
				name: "rice",
				quantity: 2,
				assumed_quantity: false,
				for_recipes: [],
				provenance: "planned",
				selected: product("RICE-1", "Kroger", "Long Grain Rice", 4),
				selection_source: "matched",
				options: [],
				family_key: "rice",
				family_fingerprint: "sha256:rice",
			},
		],
		decisions: [
			{
				line_key: "mustard",
				name: "mustard",
				quantity: 1,
				assumed_quantity: true,
				for_recipes: [],
				provenance: "planned",
				kind: "choose_one",
				candidates: [
					product("MUSTARD-1", "Maille", "Dijon Mustard", 5),
					product("MUSTARD-2", "Kroger", "Dijon Mustard", 3),
				],
				family_key: "mustard",
				family_fingerprint: "sha256:mustard",
				can_save_brand: true,
				can_search_broader: false,
				can_search_manual: true,
			},
		],
		left_off: [{ line_key: "mustard", name: "mustard", reason: "undecided" }],
		underived: ["mystery-stew"],
		counts: { going_to_cart: 2, needs_decision: 1, left_off: 2 },
		estimated_total: 16,
		flyer_savings: null,
		stage: {
			skipped: [],
			quantities: {},
			selections: [],
			impulses: [],
			saved_brands: [],
		},
		...overrides,
	};
}

const sent: OrderReviewSendResult = {
	status: "sent",
	steps: {
		list: { advanced: true },
		cart: { written: true, count: 3 },
		send: {
			recorded: true,
			id: "send-review",
			item_count: 3,
			estimated_total: 20,
			flyer_savings: 2,
		},
		cache: {
			committed: true,
			inserted: ["salmon"],
			updated: ["mustard"],
			unchanged: ["rice"],
		},
	},
	left_off: [
		{ line_key: "mystery-stew", name: "mystery-stew", reason: "underived" },
	],
	verified_saved_brands: [{ family_key: "mustard", brand: "Kroger" }],
};

async function fixtureRoutes(page: Page, initial = review()) {
	const sink: { previews: unknown[]; send?: unknown } = { previews: [] };
	await page.route("**/api/grocery/order/review", async (route) => {
		const body = route.request().postDataJSON() as {
			stage?: OrderReviewData["stage"];
		};
		sink.previews.push(body);
		await route.fulfill({
			json: { ...initial, stage: body.stage ?? initial.stage },
		});
	});
	await page.route("**/api/grocery/order/search", async (route) => {
		const body = route.request().postDataJSON() as {
			mode: "broader" | "manual";
			line_key: string;
			query?: string;
		};
		await route.fulfill({
			json: {
				contract_version: 1,
				preview_fingerprint: initial.preview_fingerprint,
				line_key: body.line_key,
				query: body.query ?? "condiment",
				mode: body.mode,
				candidates: [
					{
						...product("SEARCH-1", "Kroger", "Spicy Brown Mustard", 3.5),
						divergence: {
							rung: body.mode === "manual" ? "manual" : "general",
							requested_label: body.line_key,
							searched_label: body.query ?? "condiment",
							missing_constraints: [],
							candidate_terms: ["spicy", "brown"],
						},
					},
				],
			},
		});
	});
	await page.route("**/api/grocery/order/brand", (route) =>
		route.fulfill({
			json: {
				status: "saved",
				family_key: "mustard",
				brand: "Kroger",
				family: { tiers: [["Kroger"]], any_brand: false },
				family_fingerprint: "sha256:mustard-saved",
				changed: true,
			},
		}),
	);
	await page.route("**/api/grocery/order", async (route) => {
		sink.send = route.request().postDataJSON();
		await route.fulfill({ json: sent });
	});
	return sink;
}

test.beforeEach(async ({ asMember, groceryPage }) => {
	await asMember();
	await groceryPage.deactivateInCart();
});

test("shared review stages quantity, skip, choice, brand save, search, and impulse before an honest confirmation", async ({
	page,
	groceryPage,
}) => {
	const sink = await fixtureRoutes(page);
	await groceryPage.goto();
	await groceryPage.landmark();
	await groceryPage.openOrder();
	const surface = page.getByTestId("order-review");
	await expect(surface).toContainText("Kroger · West 7th");
	await expect(surface.getByText("Quantity 2")).toBeVisible();
	await surface.getByLabel(/Simple Truth Atlantic Salmon/).check();
	await surface.getByRole("button", { name: "Increase salmon" }).click();
	await surface.getByRole("button", { name: "Skip" }).first().click();
	await surface.getByLabel(/Kroger Dijon Mustard/).check();
	await surface
		.getByRole("button", { name: "Save preferred brand" })
		.last()
		.click();
	await surface.getByLabel("Search catalog for mustard").fill("spicy mustard");
	await surface.getByRole("button", { name: "Search catalog" }).click();
	await expect(surface.getByText(/Spicy Brown Mustard/)).toBeVisible();
	await surface.getByLabel("Add something").fill("sparkling water");
	await surface.getByRole("button", { name: "Add to this order" }).click();
	await groceryPage.captureForReview("order-review-decisions");
	await surface.getByRole("button", { name: "Send to Kroger" }).click();
	await expect(page.getByTestId("order-review-confirmed")).toContainText(
		"Checkout is still yours",
	);
	await expect(page.getByTestId("order-review-confirmed")).toContainText(
		"2 store matches learned",
	);
	await groceryPage.captureForReview("order-review-confirmed");
	expect(sink.send).toMatchObject({
		preview_fingerprint: "sha256:preview-1",
		cleared_cart_ack: false,
	});
	expect(
		(sink.send as { stage: { impulses: unknown[] } }).stage.impulses,
	).toHaveLength(1);
	await page.getByRole("button", { name: "Back to grocery" }).click();
	await expect(page.getByTestId("order-review-confirmed")).toHaveCount(0);
});

test("stale cart gate and review_changed require explicit reconfirmation", async ({
	page,
	groceryPage,
}) => {
	const initial = review({
		stale_cart_count: 2,
		cleared_cart_ack_required: true,
	});
	let sends = 0;
	await fixtureRoutes(page, initial);
	await page.unroute("**/api/grocery/order");
	await page.route("**/api/grocery/order", async (route) => {
		sends += 1;
		await route.fulfill({
			json:
				sends === 1
					? {
							status: "review_changed",
							preview: { ...initial, preview_fingerprint: "sha256:preview-2" },
							divergences: [
								{
									category: "price",
									line_key: "salmon",
									message: "salmon changed price",
								},
							],
						}
					: sent,
		});
	});
	await groceryPage.goto();
	await groceryPage.landmark();
	await groceryPage.openOrder();
	const surface = page.getByTestId("order-review");
	await expect(
		surface.getByRole("button", { name: "Send to Kroger" }),
	).toBeDisabled();
	await surface.getByLabel("I've cleared the old Kroger cart").check();
	await surface.getByRole("button", { name: "Send to Kroger" }).click();
	await expect(surface.getByRole("alert")).toContainText("review changed");
	await surface.getByRole("button", { name: "Send to Kroger" }).click();
	await expect(page.getByTestId("order-review-confirmed")).toBeVisible();
});

test("offline review is explicit and never queues a send", async ({
	page,
	groceryPage,
	context,
}) => {
	await groceryPage.goto();
	await groceryPage.landmark();
	await expect(page.getByTestId("order-open")).toBeVisible();
	await context.setOffline(true);
	await page.evaluate("window.dispatchEvent(new Event('offline'))");
	await expect(page.getByTestId("order-open")).toBeDisabled();
});
