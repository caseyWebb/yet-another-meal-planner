// Cookbook — the unified browse page (member-app-core "Cookbook browse and keyword
// search" + member-app-differentiators' promoted panel), LIVE against the seeded
// Worker: one flat filterable list, the global filter bar (honest time gate, "N of M
// match", Clear), the promoted "Recommended for you" panel's reason badges over the
// real signals, URL-search-param deep links, the favorites view mode entered through
// the All recipes / Favorites tab row (aria-selected + heart fill + count pill, plus
// the /favorites redirect), both favorites empty states, keyword search (AND-ed with
// filters), the detail page, and the D14 notes flow.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

const DIFF = SEED.app.differentiators;
const CB = SEED.app.cookbook;

test.beforeEach(async ({ asMember }) => {
  await asMember();
});

test("browse renders the flat organic list with time chips; search narrows and clears", async ({
  cookbookPage,
}) => {
  await cookbookPage.landmark();
  // The seeded recipe is promoted (Trending) with the seed's favorite on — it renders
  // once on the page; the un-promoted corpus fills the flat organic list below.
  await expect(cookbookPage.row(SEED.recipe.slug)).toBeVisible();
  await expect(cookbookPage.organicRow("viz-chicken-soup")).toBeVisible();
  // The compact hit now carries time_total — rows chip it ("{n} min").
  await expect(cookbookPage.row(SEED.recipe.slug)).toContainText("35 min");
  await cookbookPage.search("salmon");
  await cookbookPage.expectResultCount(1);
  await cookbookPage.search("zebra stew");
  await cookbookPage.expectNoMatches();
});

test("the searchbar spans the content column with exactly ONE clear affordance", async ({
  cookbookPage,
  page,
}) => {
  await cookbookPage.landmark();

  // Full width: the input fills the searchbar, and the searchbar fills the page's
  // content column (no shrunken default-size input).
  const [inputBox, barBox, colBox] = await Promise.all([
    cookbookPage.searchInput().boundingBox(),
    cookbookPage.searchbar().boundingBox(),
    page.getByTestId("cookbook-page").boundingBox(),
  ]);
  expect(inputBox!.width).toBeGreaterThanOrEqual(barBox!.width - 2);
  expect(barBox!.width).toBeGreaterThanOrEqual(colBox!.width - 2);

  // Empty box: no clear affordance at all.
  await expect(cookbookPage.clearButton()).toBeHidden();

  // With text: the custom button is the one visible clear control — the input's
  // computed `appearance: none` is what suppresses the native type="search" cancel
  // affordance in Blink/WebKit (the pseudo-element itself is not introspectable via
  // getComputedStyle, so the appearance reset is the assertable contract).
  await cookbookPage.search("salmon");
  await expect(cookbookPage.clearButton()).toBeVisible();
  expect(await cookbookPage.searchInput().evaluate((el) => getComputedStyle(el).appearance)).toBe("none");
  await cookbookPage.captureForReview("cookbook-search-clear");

  // The custom button clears back to browse.
  await cookbookPage.clearSearch();
  await expect(cookbookPage.searchInput()).toHaveValue("");
  await expect(cookbookPage.clearButton()).toBeHidden();
  await expect(cookbookPage.organicList()).toBeVisible();
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

test("favorite is an explicit set that shows up in the favorites view", async ({
  cookbookPage,
}) => {
  // Explicit-set semantics: drive OFF then ON regardless of the seeded state —
  // each click sends the computed target, so the sequence converges either way.
  await cookbookPage.ensureFavorite(SEED.recipe.slug, false);
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await cookbookPage.openView("Favorites");
  await expect(cookbookPage.row(SEED.recipe.slug)).toBeVisible();
  await cookbookPage.captureForReview("favorites-populated");
});

// ── The promoted "Recommended for you" panel (member-app-differentiators), LIVE
// against the seeded Worker: reason badges ride the real signals only — "Trending"
// (the seeded recipe crossed the guard: 3 cooks, 2 tenants) with its honest counts
// chip, "Picked for You" (the favorites centroid), never "Just Added" (nothing is
// new-for-me in the seed) and never "Popular with Friends" (waits for the friend
// lens). Displayed promoted rows dedupe out of the organic list.

test("the promoted panel badges real signals and dedupes them out of the organic list", async ({
  cookbookPage,
}) => {
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await expect(cookbookPage.reasonBadge(SEED.recipe.slug)).toHaveText("Trending");
  await expect(cookbookPage.trendingChip(SEED.recipe.slug)).toHaveText("cooked by 2 members");
  await expect(cookbookPage.reasonBadge(DIFF.topPick)).toHaveText("Picked for You");
  // Exactly the two real signals — no "Just Added" row and no friends badge anywhere.
  await expect(cookbookPage.anyReasonBadges()).toHaveCount(2);
  await expect(cookbookPage.promotedPanel()).not.toContainText("Just Added");
  await expect(cookbookPage.promotedPanel()).not.toContainText("Popular with Friends");
  // Displayed promoted slugs never repeat in the organic list below.
  await expect(cookbookPage.organicRow(SEED.recipe.slug)).toHaveCount(0);
  await expect(cookbookPage.organicRow(DIFF.topPick)).toHaveCount(0);
  await cookbookPage.captureForReview("cookbook-promoted-panel");
});

test("empty signals promote nothing: no favorites drops the pick; sparse history drops Trending", async ({
  cookbookPage,
}) => {
  await cookbookPage.goto();
  // No favorites → the picked signal is empty → no "Picked for You" row, never
  // generic picks (the endpoint's honest-empty posture). Reload after the write so
  // the panel derives from a fresh server read (the invalidation path is not what
  // this spec certifies).
  // Provision server truth directly: this test owns recommendation derivation, while
  // the optimistic favorite-button path has dedicated coverage above.
  await cookbookPage.provisionFavorite(SEED.recipe.slug, false);
  await cookbookPage.goto();
  await expect(cookbookPage.reasonBadge(SEED.recipe.slug)).toHaveText("Trending");
  await expect(cookbookPage.anyReasonBadges()).toHaveCount(1);
  // Drop the member's own cooks: the seeded recipe falls to 1 cook / 1 tenant —
  // below the min-signal guard (the production-shaped state). With every signal
  // empty the panel hides entirely and no chip or badge is fabricated.
  const removed = await cookbookPage.deleteOwnRecipeCooks();
  expect(removed.length).toBeGreaterThan(0);
  await cookbookPage.goto();
  await expect(cookbookPage.organicRow(SEED.recipe.slug)).toBeVisible();
  await expect(cookbookPage.promotedPanel()).toHaveCount(0);
  await expect(cookbookPage.anyTrendingChips()).toHaveCount(0);
  await expect(cookbookPage.anyReasonBadges()).toHaveCount(0);
  // Restore the seeded cooks + favorite for the specs that follow.
  await cookbookPage.logCooks(removed);
  await cookbookPage.goto();
  await cookbookPage.provisionFavorite(SEED.recipe.slug, true);
  await cookbookPage.goto();
  await expect(cookbookPage.trendingChip(SEED.recipe.slug)).toBeVisible();
});

// ── The global filter bar (member-app-core): one filter state over the organic list,
// the promoted panel (per-row), search results, and the favorites view — with the
// active-only "N of M match" count, the honest no-time_total gate, and URL-param state.

test("filters narrow the organic list with an honest count, hide the panel, and live in the URL", async ({
  cookbookPage,
  page,
}) => {
  await cookbookPage.goto();
  await cookbookPage.cuisineSelect().selectOption("italian");
  await expect(cookbookPage.countLabel()).toHaveText("3 of 10 match");
  for (const slug of CB.italian) await expect(cookbookPage.organicRow(slug)).toBeVisible();
  // Neither promoted candidate is italian — zero rows survive, so the panel hides.
  await expect(cookbookPage.promotedPanel()).toHaveCount(0);
  await expect(page).toHaveURL(/cuisine=italian/);
  await cookbookPage.timeOption("≤30").click();
  await expect(cookbookPage.countLabel()).toHaveText("2 of 10 match");
  await expect(cookbookPage.organicRow("viz-beef-ragu")).toHaveCount(0); // 90 min
  await expect(page).toHaveURL(/time=30/);
  await cookbookPage.captureForReview("cookbook-filtered");
  // Clear resets both filters, the count label, and the URL params.
  await cookbookPage.clearFiltersButton().click();
  await expect(cookbookPage.countLabel()).toHaveCount(0);
  await expect(cookbookPage.organicRow("viz-beef-ragu")).toBeVisible();
  await expect(page).not.toHaveURL(/cuisine=/);
});

test("a recipe with no time_total fails any active time cap — never claimed under a budget", async ({
  cookbookPage,
}) => {
  await cookbookPage.goto();
  await expect(cookbookPage.organicRow(CB.noTime)).toBeVisible();
  await cookbookPage.timeOption("≤45").click();
  await expect(cookbookPage.organicRow(CB.noTime)).toHaveCount(0);
  await expect(cookbookPage.countLabel()).toHaveText("7 of 10 match");
  await cookbookPage.timeOption("Any").click();
  await expect(cookbookPage.organicRow(CB.noTime)).toBeVisible();
});

test("the filtered-empty state repeats an inline Clear filters link", async ({ cookbookPage }) => {
  await cookbookPage.goto();
  await cookbookPage.cuisineSelect().selectOption("japanese");
  await cookbookPage.proteinSelect().selectOption("beef");
  await expect(cookbookPage.filterEmpty()).toContainText("No recipes match these filters.");
  await cookbookPage.inlineClearFilters().click();
  await expect(cookbookPage.filterEmpty()).toHaveCount(0);
  // The seeded recipe returns to the PROMOTED panel (never duplicated organically);
  // an un-promoted recipe proves the organic list itself is back.
  await expect(cookbookPage.row(SEED.recipe.slug)).toBeVisible();
  await expect(cookbookPage.organicRow("viz-chicken-soup")).toBeVisible();
});

test("filter state deep-links: loading the URL reproduces it", async ({ cookbookPage }) => {
  await cookbookPage.gotoWith("cuisine=italian&time=30");
  await expect(cookbookPage.cuisineSelect()).toHaveValue("italian");
  await expect(cookbookPage.timeOption("≤30")).toHaveAttribute("aria-pressed", "true");
  await expect(cookbookPage.countLabel()).toHaveText("2 of 10 match");
  await expect(cookbookPage.organicRow("viz-cacio-pepe")).toBeVisible();
  await expect(cookbookPage.organicRow("viz-beef-ragu")).toHaveCount(0);
});

test("active filters AND onto search results", async ({ cookbookPage }) => {
  await cookbookPage.gotoWith("protein=fish");
  await cookbookPage.search("salmon");
  await cookbookPage.expectResultCount(1);
  await cookbookPage.gotoWith("protein=beef");
  await cookbookPage.search("salmon");
  await cookbookPage.expectNoMatches();
});

// ── The favorites view mode (member-app-core, D8: favorites folds into the page),
// entered through the view-mode tab row (design-requests #1's committed form): a
// scope switch, not another AND-filter — the global filters stay mounted inside it.

test("the Favorites tab switches the view: URL param, list, panel, aria, heart fill", async ({
  cookbookPage,
  page,
}) => {
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await cookbookPage.goto();
  await expect(cookbookPage.viewTab("All recipes")).toHaveAttribute("aria-selected", "true");
  await expect(cookbookPage.viewTab("Favorites")).toHaveAttribute("aria-selected", "false");
  await expect(cookbookPage.viewTab("Favorites").locator("svg")).toHaveAttribute("fill", "none");
  await cookbookPage.openView("Favorites");
  // The view is derived URL state (default stripped): the param appears, the list
  // becomes the favorites, the promoted panel hides, and the heart fills.
  await expect(page).toHaveURL(/\?view=favorites/);
  await expect(cookbookPage.organicRow(SEED.recipe.slug)).toBeVisible();
  await expect(cookbookPage.organicList().getByTestId("recipe-row")).toHaveCount(1);
  await expect(cookbookPage.promotedPanel()).toHaveCount(0);
  await expect(cookbookPage.viewTab("All recipes")).toHaveAttribute("aria-selected", "false");
  await expect(cookbookPage.viewTab("Favorites").locator("svg")).toHaveAttribute("fill", "currentColor");
  await cookbookPage.captureForReview("cookbook-favorites-tabs");
  // Back to All recipes: the param strips, the panel and full organic list return.
  await cookbookPage.openView("All recipes");
  await expect(page).not.toHaveURL(/view=/);
  await expect(cookbookPage.promotedPanel()).toBeVisible();
  await expect(cookbookPage.organicRow("viz-chicken-soup")).toBeVisible();
});

test("the favorites view mode filters favorites and hides the promoted panel", async ({
  cookbookPage,
}) => {
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await cookbookPage.gotoWith("view=favorites");
  await expect(cookbookPage.organicRow(SEED.recipe.slug)).toBeVisible();
  await expect(cookbookPage.organicList().getByTestId("recipe-row")).toHaveCount(1);
  await expect(cookbookPage.promotedPanel()).toHaveCount(0);
  // The global filters apply INSIDE the view, with the favorites-specific empty copy —
  // while the tab's count pill keeps the UNFILTERED total (the honest count).
  await cookbookPage.cuisineSelect().selectOption("italian");
  await expect(cookbookPage.countLabel()).toHaveText("0 of 1 match");
  await expect(cookbookPage.favoritesTabCount()).toHaveText("1");
  await expect(cookbookPage.filterEmpty()).toContainText("None of your favorites match these filters.");
  await cookbookPage.inlineClearFilters().click();
  await expect(cookbookPage.organicRow(SEED.recipe.slug)).toBeVisible();
  await cookbookPage.captureForReview("cookbook-favorites-view");
});

test("zero favorites overall renders the No favorites yet empty state and no count pill", async ({
  cookbookPage,
  page,
}) => {
  await cookbookPage.ensureFavorite(SEED.recipe.slug, false);
  await cookbookPage.gotoWith("view=favorites");
  await expect(page.getByTestId("cookbook-page")).toContainText("No favorites yet");
  await expect(page.getByTestId("cookbook-page")).toContainText("Tap the heart on any recipe to save it here.");
  await expect(cookbookPage.promotedPanel()).toHaveCount(0);
  // Zero favorites: the Favorites tab renders bare — no "0" pill.
  await expect(cookbookPage.viewTab("Favorites")).toBeVisible();
  await expect(cookbookPage.favoritesTabCount()).toHaveCount(0);
  await cookbookPage.captureForReview("cookbook-favorites-empty");
  // Restore the seeded favorite for any specs that follow — and pin the pill's return.
  await cookbookPage.goto();
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await expect(cookbookPage.favoritesTabCount()).toHaveText("1");
});

test("/favorites redirects into the view mode, preserving other params", async ({
  cookbookPage,
  page,
}) => {
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await page.goto("/favorites?cuisine=japanese");
  await cookbookPage.landmark();
  await expect(page).toHaveURL(/\/\?/);
  await expect(page).toHaveURL(/view=favorites/);
  await expect(page).toHaveURL(/cuisine=japanese/);
  await expect(cookbookPage.viewTab("Favorites")).toHaveAttribute("aria-selected", "true");
  await expect(cookbookPage.organicRow(SEED.recipe.slug)).toBeVisible();
  await expect(cookbookPage.cuisineSelect()).toHaveValue("japanese");
});
