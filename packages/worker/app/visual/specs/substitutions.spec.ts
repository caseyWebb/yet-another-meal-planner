import type { Page } from "@playwright/test";
import type { GroceryListData } from "../../../../contract/src/grocery";
import { SEED } from "../../../admin/visual/seed.mjs";
import type {
	LineSuggestions,
	PlaceOrderInput,
	PlaceOrderOutcome,
	SubstitutionAlternative,
	SuggestSubstitutionsResult,
} from "../../../src/order-shapes.js";
import { expect, test } from "../fixtures";

const DIFF = SEED.app.differentiators;
const G = SEED.app.grocery;

const original: GroceryListData = {
	contract_version: 1,
	snapshot_version: "sub-v1",
	as_of: "2026-07-12T12:00:00Z",
	lines: [
		{
			key: "halloumi",
			name: "Halloumi",
			quantity: 1,
			kind: "grocery",
			domain: "grocery",
			origin: "list",
			checked_at: null,
			row_version: 1,
			updated_at: null,
			for_recipes: [],
			substitutes: [{ id: "paneer", label: "Paneer" }],
		},
	],
	to_buy: ["halloumi"],
	pantry_covered: [],
	in_cart_groups: [],
	underived: [],
	location: null,
	flyer_as_of: null,
	counts: { to_buy: 1, checked: 0, in_carts: 0, recipes: 0 },
};
const swapped: GroceryListData = {
	...original,
	snapshot_version: "sub-v2",
	to_buy: ["paneer"],
	lines: [
		{
			...original.lines[0],
			key: "paneer",
			name: "Paneer",
			row_version: 2,
			substitutes: [],
		},
	],
};

test("substitution confirmation exposes a durable Undo action", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	let current = original;
	await page.route("**/api/grocery/view", (route) =>
		route.fulfill({ json: current }),
	);
	let undone = false;
	await page.route("**/api/grocery/substitution", async (route) => {
		const body = route.request().postDataJSON() as { undo?: boolean };
		undone = body.undo === true;
		current = undone ? { ...original, snapshot_version: "sub-v3" } : swapped;
		await route.fulfill({ json: { snapshot: current } });
	});
	await groceryPage.goto();
	await groceryPage.landmark();
	await groceryPage
		.item("halloumi")
		.getByRole("button", { name: "Swap in" })
		.click();
	await expect(groceryPage.item("paneer")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	await expect.poll(() => undone).toBe(true);
	await expect(groceryPage.item("halloumi")).toBeVisible();
});

test("pantry actions show freshness and Buy-anyway Undo", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	const pantry: GroceryListData = {
		...original,
		lines: [],
		to_buy: [],
		pantry_covered: [
			{
				key: "onion",
				name: "Onion",
				for_recipes: [],
				freshness: "worth_a_look",
				freshness_reason: "last verified 8 days ago",
				on_hand: {},
				buy_anyway: false,
			},
		],
	};
	let current = pantry;
	await page.route("**/api/grocery/view", (route) =>
		route.fulfill({ json: current }),
	);
	await page.route("**/api/grocery/coverage", async (route) => {
		const body = route.request().postDataJSON() as { enabled: boolean };
		current = body.enabled
			? {
					...pantry,
					snapshot_version: "pantry-v2",
					pantry_covered: [],
					lines: [{ ...original.lines[0], key: "onion", name: "Onion" }],
					to_buy: ["onion"],
				}
			: { ...pantry, snapshot_version: "pantry-v3" };
		await route.fulfill({ json: { snapshot: current } });
	});
	await groceryPage.goto();
	await groceryPage.landmark();
	await expect(groceryPage.coveredItem("onion")).toContainText(
		"last verified 8 days ago",
	);
	await groceryPage
		.coveredItem("onion")
		.getByRole("button", { name: "Buy anyway" })
		.click();
	await expect(groceryPage.item("onion")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(groceryPage.coveredItem("onion")).toBeVisible();
});

test("the live enriched snapshot carries relation, pantry, and sale hints and renders curated labels", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.landmark();

	type EnrichedSubstitute = {
		id: string;
		label: string;
		relation?: { role?: string; via?: string };
		in_pantry?: boolean;
		on_sale_hint?: { price: { promo: number } };
	};
	const family = await page.evaluate(async (key) => {
		const snapshot = (await (
			await fetch("/api/grocery/view")
		).json()) as GroceryListData;
		const line = snapshot.lines.find((candidate) => candidate.key === key);
		return (line?.substitutes ?? []) as EnrichedSubstitute[];
	}, DIFF.siblings.line);

	expect(family).toHaveLength(3);
	const green = family.find(
		(candidate) => candidate.id === "cabbage::color-green",
	);
	const red = family.find((candidate) => candidate.id === "cabbage::color-red");
	expect(green).toMatchObject({
		label: DIFF.siblings.displayNames["cabbage::color-green"],
		relation: { role: "sibling", via: DIFF.siblings.parent },
		on_sale_hint: { price: { promo: DIFF.siblings.saleHit.price.promo } },
	});
	expect(red).toMatchObject({
		label: DIFF.siblings.displayNames["cabbage::color-red"],
		relation: { role: "sibling", via: DIFF.siblings.parent },
		in_pantry: true,
	});
	await expect(groceryPage.item(DIFF.siblings.line)).toContainText(
		DIFF.siblings.displayNames[DIFF.siblings.line],
	);
	await expect(
		groceryPage.substitutionHint(DIFF.siblings.line, "cabbage::color-green"),
	).toContainText(DIFF.siblings.displayNames["cabbage::color-green"]);
	await expect(
		groceryPage
			.substitutionHint(DIFF.siblings.line, "cabbage::color-green")
			.getByTestId("subs-relation"),
	).toHaveText("same family · via cabbage");
	await expect(
		groceryPage
			.substitutionHint(DIFF.siblings.line, "cabbage::color-green")
			.getByTestId("subs-sale-hint"),
	).toHaveText("$2.00 at your store");
	await expect(
		groceryPage
			.substitutionHint(DIFF.siblings.line, "cabbage::color-red")
			.getByTestId("subs-pantry-hit"),
	).toHaveText("in your pantry");
});

test("a line without graph neighbors renders no empty substitution affordance", async ({
	asMember,
	groceryPage,
}) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.landmark();
	await expect(groceryPage.item(G.active[2])).toBeVisible();
	await expect(groceryPage.substitutionHint(G.active[2])).toHaveCount(0);
});

test("Keep original dismisses only local view state and the live hint returns after reload", async ({
	asMember,
	groceryPage,
}) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.landmark();
	const green = groceryPage.substitutionHint(
		DIFF.siblings.line,
		"cabbage::color-green",
	);
	await expect(green).toBeVisible();
	await green.getByRole("button", { name: "Keep original" }).click();
	await expect(green).toHaveCount(0);
	await groceryPage.goto();
	await expect(
		groceryPage.substitutionHint(DIFF.siblings.line, "cabbage::color-green"),
	).toBeVisible();
});

test("a live sibling swap materializes the curated label and Undo restores the original", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.landmark();
	const siblingId = "cabbage::color-green";
	const siblingLabel = DIFF.siblings.displayNames[siblingId];

	await groceryPage
		.substitutionHint(DIFF.siblings.line, siblingId)
		.getByRole("button", { name: "Swap in" })
		.click();
	await expect(groceryPage.item(siblingId)).toContainText(siblingLabel);
	await expect
		.poll(async () =>
			page.evaluate(async (key) => {
				const snapshot = (await (await fetch("/api/grocery/view")).json()) as GroceryListData;
				return snapshot.lines.some((line) => line.key === key);
			}, siblingId),
		)
		.toBe(true);
	const materialized = await page.evaluate(async (key) => {
		const snapshot = (await (await fetch("/api/grocery/view")).json()) as GroceryListData;
		return snapshot.lines.find((line) => line.key === key);
	}, siblingId);
	expect(materialized).toMatchObject({ key: siblingId, name: siblingLabel });
	expect(materialized?.name).not.toContain("::");

	await page
		.getByRole("region", { name: "Saved grocery decisions" })
		.getByRole("listitem")
		.filter({ hasText: `Using ${siblingId} instead of ${DIFF.siblings.line}` })
		.getByRole("button", { name: "Undo" })
		.click();
	await expect(groceryPage.item(DIFF.siblings.line)).toContainText(
		DIFF.siblings.displayNames[DIFF.siblings.line],
	);
});

function substitutions(
	overrides: Partial<SuggestSubstitutionsResult>,
): SuggestSubstitutionsResult {
	return {
		suggestions: [],
		remaining: [],
		location: { id: "03500520" },
		...overrides,
	};
}

function suggestion(
	overrides: Partial<LineSuggestions> & { for: LineSuggestions["for"] },
): LineSuggestions {
	return { status: "ok", current: null, alternatives: [], ...overrides };
}

function alternative(
	overrides: Partial<SubstitutionAlternative> & {
		sku: string;
		reasons: SubstitutionAlternative["reasons"];
	},
): SubstitutionAlternative {
	return {
		brand: "Store Brand",
		description: "product",
		size: "16 oz",
		price: { regular: 3.5, promo: 0 },
		on_sale: false,
		available: true,
		aisleLocation: null,
		...overrides,
	};
}

function resolvedLine(
	name: string,
	overrides: Partial<PlaceOrderOutcome["resolved"][number]> = {},
) {
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
		...overrides,
	};
}

function orderOutcome(
	overrides: Partial<PlaceOrderOutcome>,
): PlaceOrderOutcome {
	return {
		resolved: [],
		checkpoint: [],
		sku_cache: { committed: false },
		cart: { written: false },
		list: { advanced: false },
		send: { recorded: false },
		preview: true,
		partials: [],
		underived: [],
		...overrides,
	};
}

async function interceptSubstitutions(
	page: Page,
	fixture: SuggestSubstitutionsResult,
) {
	await page.route("**/api/grocery/substitutions", (route) =>
		route.fulfill({ json: fixture }),
	);
}

async function interceptOrder(
	page: Page,
	preview: PlaceOrderOutcome,
	sink: { commitBody?: PlaceOrderInput } = {},
) {
	await page.route("**/api/grocery/order", async (route) => {
		const body = (route.request().postDataJSON() ?? {}) as PlaceOrderInput;
		if (body.preview) return route.fulfill({ json: preview });
		sink.commitBody = body;
		return route.fulfill({
			json: orderOutcome({
				preview: false,
				resolved: preview.resolved,
				cart: { written: true, count: preview.resolved.length },
				list: { advanced: true },
				sku_cache: { committed: true },
			}),
		});
	});
	return sink;
}

test("order alternatives substantiate cheaper and sale claims and stage the chosen SKU", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.deactivateInCart();
	await groceryPage.goto();
	const preview = orderOutcome({
		resolved: [resolvedLine("chicken thighs"), resolvedLine("coconut milk")],
	});
	const sink = await interceptOrder(page, preview);
	await interceptSubstitutions(
		page,
		substitutions({
			suggestions: [
				suggestion({
					for: {
						name: "chicken thighs",
						key: "chicken thighs",
						origin: "list",
					},
					current: {
						sku: "CUR-1",
						brand: "Kroger",
						description: "Chicken Thighs",
						size: "16 oz",
						price: { regular: 6.72, promo: 0 },
						on_sale: false,
						available: true,
						unit_price: 0.0148,
						base_unit: "g",
						aisleLocation: null,
					},
					alternatives: [
						alternative({
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
				suggestion({
					for: { name: "coconut milk", key: "coconut milk", origin: "list" },
					alternatives: [
						alternative({
							sku: "ALT-SALE",
							brand: "Thai Kitchen",
							description: "Coconut Milk",
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
	await expect(
		groceryPage.orderSubRow("chicken thighs").getByTestId("subs-reason"),
	).toHaveText("cheaper — $0.31/oz vs $0.42/oz");
	await expect(
		groceryPage.orderSubRow("coconut milk").getByTestId("subs-reason"),
	).toHaveText("on sale — $2.50 (was $3.29)");
	await groceryPage.acceptOrderSub("chicken thighs");
	await expect(
		groceryPage.orderSubRow("chicken thighs").getByTestId("subs-staged"),
	).toBeVisible();
	await groceryPage.commitOrder();
	await expect
		.poll(() => sink.commitBody?.overrides)
		.toEqual([{ name: "chicken thighs", sku: "ALT-CHEAP" }]);
});

test("an unavailable current pick calls out an in-stock alternative", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.deactivateInCart();
	await interceptOrder(
		page,
		orderOutcome({ resolved: [resolvedLine("scallions")] }),
	);
	await interceptSubstitutions(
		page,
		substitutions({
			suggestions: [
				suggestion({
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
						alternative({
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
});

test("an order line with no usable alternative renders no empty alternative row", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	await groceryPage.goto();
	await groceryPage.deactivateInCart();
	await interceptOrder(
		page,
		orderOutcome({ resolved: [resolvedLine("olive oil")] }),
	);
	await interceptSubstitutions(
		page,
		substitutions({
			suggestions: [
				suggestion({
					for: { name: "olive oil", key: "olive oil", origin: "list" },
					status: "no_cached_pick",
				}),
			],
		}),
	);
	await groceryPage.openOrder();
	await expect(groceryPage.orderLine("olive oil")).toBeVisible();
	await expect(groceryPage.orderSubRow("olive oil")).toHaveCount(0);
});
