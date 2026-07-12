// Guided cook mode on the recipe detail page (recipe-card-cook-mode, D32/D20), LIVE against the
// seeded Worker. The member page mounts the SAME shared `<CookMode>` the in-chat widget uses: the
// Start Cooking entry, the mise-en-place check-off, step navigation with a progress bar, a per-step
// timer, and the "Plated up" done screen — parsed from the recipe body client-side (no model call).
// The existing favorite / add-to-plan / log controls keep working alongside it.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test.beforeEach(async ({ asMember }) => {
  await asMember();
});

test("the detail page offers Start Cooking alongside the existing deep link and controls", async ({
  cookbookPage,
  recipePage,
  page,
}) => {
  await cookbookPage.openRecipe(SEED.recipe.slug);
  await recipePage.landmark();
  await expect(recipePage.startCookingButton()).toBeVisible();
  // Cook mode sits ALONGSIDE the existing surface — the deep link and favorite/log/plan stay.
  await recipePage.expectCookDeepLink(SEED.recipe.slug);
  await expect(page.getByTestId("detail-fav")).toBeVisible();
  await expect(page.getByTestId("detail-log")).toBeVisible();
  await expect(page.getByTestId("detail-plan")).toBeVisible();
});

test("cook mode walks mise → steps (progress + timer) → the done screen", async ({ recipePage, page }) => {
  await recipePage.goto();
  await recipePage.startCooking();

  // Mise-en-place: the seeded recipe has three ingredients; checking one advances the count.
  await recipePage.expectMiseCount("0 / 3 ready");
  await recipePage.toggleMiseItem(0);
  await recipePage.expectMiseCount("1 / 3 ready");
  await recipePage.captureForReview("cook-mode-mise");

  // Step 1 of 3 — the progress bar sits at a third.
  await recipePage.startStepping();
  await recipePage.expectStepBody("Whisk the miso glaze");
  expect(await recipePage.progressFraction()).toBeCloseTo(1 / 3, 1);

  // Step 2 carries a detected timer (the "8 minutes" broil) — arming it flips the control to Pause.
  await recipePage.nextStep();
  await recipePage.expectStepBody("Broil the salmon");
  await expect(recipePage.timer()).toBeVisible();
  await expect(recipePage.timerDisplay()).toHaveText("8:00");
  await recipePage.armTimer();
  await expect(page.getByTestId("cook-timer-toggle")).toContainText("Pause");
  await recipePage.captureForReview("cook-mode-step-timer");

  // Step 3 has no wait — no timer — then Finish lands on "Plated up".
  await recipePage.nextStep();
  await recipePage.expectStepBody("Serve over rice");
  await expect(recipePage.timer()).toHaveCount(0);
  await recipePage.nextStep();
  await recipePage.expectDone();
  await recipePage.captureForReview("cook-mode-done");
});

test("Back to Recipe Card returns to the browse surface", async ({ recipePage, page }) => {
  await recipePage.goto();
  await recipePage.startCooking();
  await recipePage.exitCook();
  await expect(recipePage.startCookingButton()).toBeVisible();
  await expect(page.getByTestId("recipe-body")).toBeVisible();
});

test("the existing favorite control still flips in the detail view", async ({ recipePage, page }) => {
  await recipePage.goto();
  const fav = page.getByTestId("detail-fav");
  const before = await fav.getAttribute("aria-pressed");
  await fav.click();
  await expect(fav).not.toHaveAttribute("aria-pressed", before ?? "false");
});
