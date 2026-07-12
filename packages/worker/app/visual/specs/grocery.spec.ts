import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

const G = SEED.app.grocery;
const TB = SEED.app.toBuy;

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

test("the order review is a labelled expanded disclosure", async ({ groceryPage }) => {
	const launcher = groceryPage.page.getByTestId("order-open");
	await expect(launcher).toHaveAttribute("aria-expanded", "false");
	await expect(launcher).toHaveAttribute("aria-controls", "grocery-order-review");

	await launcher.click();
	await expect(launcher).toHaveAttribute("aria-expanded", "true");
	const review = groceryPage.page.getByRole("region", { name: "Kroger order" });
	await expect(review).toHaveAttribute("id", "grocery-order-review");
	await expect(review).toBeVisible();

	await review.getByRole("button", { name: "Close order review" }).click();
	await expect(launcher).toHaveAttribute("aria-expanded", "false");
	await expect(review).toHaveCount(0);
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
		contract_version: 2,
		snapshot_version: "unknown-newer-v2",
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
	await expect(
		groceryPage.page.getByLabel("Add grocery item"),
	).toBeDisabled();
	await groceryPage.setViewport(390, 844);
	await groceryPage.captureForReview("grocery-mobile");
});
