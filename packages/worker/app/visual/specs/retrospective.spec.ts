// Retrospective (member-app-core, retrospective-shell): the tabbed shell (Cooking log default
// / Spend / Waste placeholders), the meal-aware composer (meal + source segments, backdating),
// the day-grouped meal-tagged list, and the /log → /retrospective redirect. Backend meal
// support landed in band 1; this covers the member UI over the seeded history.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test.beforeEach(async ({ asMember, retrospectivePage }) => {
  await asMember();
  await retrospectivePage.goto();
  await retrospectivePage.landmark();
});

test("logging a cook via the composer prepends a row; removing it heals the list", async ({ retrospectivePage }) => {
  await retrospectivePage.rows().first().waitFor(); // the seeded history has rendered
  const before = await retrospectivePage.rows().count();
  await retrospectivePage.logCook(SEED.recipe.title);
  await expect(retrospectivePage.rows()).toHaveCount(before + 1);
  await retrospectivePage.captureForReview("retro-log-after-cook");
  await retrospectivePage.removeFirst();
  await expect(retrospectivePage.rows()).toHaveCount(before);
});

test("the shell defaults to Cooking log and switches tabs via the URL", async ({ page, retrospectivePage }) => {
  await expect(retrospectivePage.tab("log")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("log-page")).toBeVisible();

  await retrospectivePage.selectTab("spend");
  await expect(page).toHaveURL(/tab=spend/);
  await expect(page.getByTestId("spend-page")).toBeVisible();

  await retrospectivePage.selectTab("waste");
  await expect(page).toHaveURL(/tab=waste/);
  await expect(page.getByTestId("waste-page")).toBeVisible();
});

test("'Something else' logs a meal-tagged non-recipe row; meal persists", async ({ page, retrospectivePage }) => {
  await retrospectivePage.pickMeal("Lunch");
  await retrospectivePage.logSomethingElse("takeout ramen");

  const row = retrospectivePage.rows().filter({ hasText: "takeout ramen" }).first();
  await expect(row).toBeVisible();
  await expect(retrospectivePage.mealTag(row)).toHaveText("lunch");
  await expect(row).toContainText("made something else");
  // Logged today, so it sits under the "Today" day group.
  await expect(retrospectivePage.dayHeads().filter({ hasText: "Today" })).toBeVisible();
  // Meal persists for rapid multi-logging (only the source input clears).
  await expect(page.locator('.seg[data-seg="meal"] button', { hasText: "Lunch" })).toHaveAttribute("aria-pressed", "true");
});

test("an entry dated yesterday is labeled Yesterday", async ({ retrospectivePage }) => {
  // Compute yesterday in the SAME UTC calendar the app's isoToday() uses.
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  await retrospectivePage.setDate(y.toISOString().slice(0, 10));
  await retrospectivePage.logSomethingElse("last night curry");
  await expect(retrospectivePage.rows().filter({ hasText: "last night curry" })).toBeVisible();
  await expect(retrospectivePage.dayHeads().filter({ hasText: "Yesterday" })).toBeVisible();
});

test("backdating files the cook under an earlier day group, not Today", async ({ retrospectivePage }) => {
  await retrospectivePage.setDate("2026-01-15");
  await retrospectivePage.logSomethingElse("new year stew");
  await expect(retrospectivePage.rows().filter({ hasText: "new year stew" })).toBeVisible();
  await expect(retrospectivePage.dayHeads().filter({ hasText: "Jan 15" })).toBeVisible();
});

test("/log redirects to the retrospective", async ({ page, retrospectivePage }) => {
  await page.goto("/log");
  await retrospectivePage.landmark();
  await expect(page).toHaveURL(/\/retrospective/);
});
