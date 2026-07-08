// Cookbook browse/search + recipe detail (member-app-core 7.3/7.4): the browse
// sections render seeded data, keyword search narrows in place, the detail page
// serves the corpus body + the Cook-with-Claude deep link, favorites are an
// explicit set that lands on the favorites page, and the D14 notes flow works.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test.beforeEach(async ({ asMember }) => {
  await asMember();
});

test("browse renders the all-recipes list; search narrows and clears", async ({ cookbookPage }) => {
  await cookbookPage.landmark();
  await expect(cookbookPage.row(SEED.recipe.slug)).toBeVisible();
  await cookbookPage.search("salmon");
  await cookbookPage.expectResultCount(1);
  await cookbookPage.search("zebra stew");
  await cookbookPage.expectNoMatches();
});

test("the detail page renders the corpus body, facets, and the deep link", async ({ cookbookPage, recipePage }) => {
  await cookbookPage.openRecipe(SEED.recipe.slug);
  await recipePage.landmark();
  await recipePage.expectTitle(SEED.recipe.title);
  await recipePage.expectBodyContains("Whisk the miso glaze");
  await recipePage.expectCookDeepLink(SEED.recipe.slug);
  await recipePage.expectCommunityNote(SEED.app.note.body);
  await recipePage.captureForReview("recipe-detail-full");
});

test("notes: add an own note (client-minted identity), then delete it", async ({ recipePage }) => {
  await recipePage.goto();
  await recipePage.addNote("Sear hotter next time.", { tag: "tweak" });
  await recipePage.expectOwnNote("Sear hotter next time.");
  await recipePage.deleteFirstOwnNote();
  await recipePage.expectNoOwnNotes();
});

test("favorite is an explicit set that shows up on the favorites page", async ({
  cookbookPage,
  favoritesPage,
}) => {
  // Explicit-set semantics: drive OFF then ON regardless of the seeded state —
  // each click sends the computed target, so the sequence converges either way.
  await cookbookPage.ensureFavorite(SEED.recipe.slug, false);
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await favoritesPage.goto();
  await favoritesPage.expectRecipe(SEED.recipe.slug);
  await favoritesPage.captureForReview("favorites-populated");
});

// ── The differentiator browse rows (member-app-differentiators D7-D9), LIVE against
// the seeded Worker: trending backfill with the honest counts chip, the sparse-data
// empty state (self-provisioned by deleting the member's own cooks, then restored),
// and picked-for-you's favorites-driven populate/empty flip.

const DIFF = SEED.app.differentiators;

test("New & trending backfills group trending with an honest counts chip; All recipes stays below", async ({
  cookbookPage,
}) => {
  await cookbookPage.landmark();
  // Nothing is new-for-me in the seed, so slot 1 is pure trending backfill: the
  // seeded recipe crossed the guard (3 cooks, 2 tenants — pat's seeded cook).
  await expect(cookbookPage.newTrendingRow(SEED.recipe.slug)).toBeVisible();
  await expect(cookbookPage.trendingChip(SEED.recipe.slug)).toHaveText("cooked by 2 members");
  // D9: the full-index section remains reachable as the third section.
  await expect(cookbookPage.allRecipesSection()).toBeVisible();
  await cookbookPage.captureForReview("browse-differentiator-rows");
});

test("sparse group history yields an EMPTY trending set — no fake trending badge", async ({
  cookbookPage,
}) => {
  await cookbookPage.goto();
  // Drop the member's own cooks: the seeded recipe falls to 1 cook / 1 tenant —
  // below the min-signal guard (the production-shaped state).
  const removed = await cookbookPage.deleteOwnRecipeCooks();
  expect(removed.length).toBeGreaterThan(0);
  await cookbookPage.goto();
  await expect(cookbookPage.newTrendingSection()).toContainText("Nothing new since your last plan.");
  await expect(cookbookPage.newTrendingRow(SEED.recipe.slug)).toHaveCount(0);
  await expect(cookbookPage.anyTrendingChips()).toHaveCount(0);
  // Restore the seeded cooks for the specs that follow.
  await cookbookPage.logCooks(removed);
  await cookbookPage.goto();
  await expect(cookbookPage.trendingChip(SEED.recipe.slug)).toBeVisible();
});

test("Picked for you: the favorite-a-few empty state, then deterministic picks from the favorite", async ({
  cookbookPage,
}) => {
  await cookbookPage.goto();
  // No favorites → the honest empty state, never a backfill from the index.
  await cookbookPage.ensureFavorite(SEED.recipe.slug, false);
  await expect(cookbookPage.pickedSection()).toContainText("Favorite a few recipes and tailored picks show up here.");
  await expect(cookbookPage.pickedSection().getByTestId("recipe-row")).toHaveCount(0);
  // Favoriting invalidates the row (D12): the nearest embedded neighbor leads, and
  // the favorite itself is never re-picked.
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await expect(cookbookPage.pickedRow(DIFF.topPick)).toBeVisible();
  await expect(cookbookPage.pickedRow(SEED.recipe.slug)).toHaveCount(0);
  await cookbookPage.captureForReview("browse-picked-for-you");
});
