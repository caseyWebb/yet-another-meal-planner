import type { GroceryListData } from "../../../../contract/src/grocery";
import { SEED } from "../../../admin/visual/seed.mjs";
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

test("in_cart and on_list substitutes render their surfacing justification inline", async ({
	asMember,
	groceryPage,
	page,
}) => {
	await asMember();
	const view: GroceryListData = {
		...original,
		lines: [
			{
				...original.lines[0],
				substitutes: [
					{ id: "paneer", label: "Paneer", relation: { role: "sibling", via: "cheese", via_label: "Cheese" }, in_pantry: false, in_cart: true },
					{ id: "queso", label: "Queso", relation: { role: "sibling", via: "cheese", via_label: "Cheese" }, in_pantry: false, on_list: true },
				],
			},
		],
	};
	await page.route("**/api/grocery/view", (route) => route.fulfill({ json: view }));
	await groceryPage.goto();
	await groceryPage.landmark();
	await expect(
		groceryPage.substitutionHint("halloumi", "paneer").getByTestId("subs-cart-hit"),
	).toHaveText("in your cart");
	await expect(
		groceryPage.substitutionHint("halloumi", "queso").getByTestId("subs-list-hit"),
	).toHaveText("already on your list");
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
