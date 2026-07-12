// Profile (member-app-core + profile-planning-and-vibes-ui): the derived taste read, the
// class (a) markdown editor's 412 REBASE flow (a competing writer forces the notice; saving
// again applies), the preferences merge-patch knobs — the Planning card's per-meal cadence
// steppers and the weekly-budget control (clearing writes UNSET, never 0) — and the
// meal-vibe palette: meal-grouped rows with the pinned indicator, plus inline suggestions
// (row-attached wands + per-meal-group footer cards) that replaced the standalone
// reconciliation queue. merge_recipes never surfaces on the member vibes tab.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test.beforeEach(async ({ asMember, profilePage }) => {
  await asMember();
  // Reset the mutable prefs (cadence, weekly budget, brand tiers) to the exact seed via a
  // DIRECT, AWAITED API write BEFORE loading the page — deterministic by construction, so
  // every attempt/retry/repeat starts from an identical baseline and a poisoned prior run
  // (a mutating spec that failed mid-way, leaving D1 off-seed) cannot leak into the next.
  await profilePage.resetPrefs();
  await profilePage.goto();
  await profilePage.landmark();
});

test("the taste tab renders the derived read and the seeded markdown", async ({ profilePage }) => {
  await profilePage.expectTasteView(SEED.app.tasteLead);
  await profilePage.captureForReview("profile-taste");
});

test("a lost class (a) race 412s, surfaces the rebase notice, and the retry applies", async ({
  profilePage,
}) => {
  await profilePage.openTasteEditor();
  await profilePage.typeTaste("My edit, drafted while someone else saved.");
  // A competing writer moves the document under the open editor.
  await profilePage.competingTasteWrite("The other writer got here first.");
  await profilePage.saveTaste();
  await profilePage.expectRebaseNotice(); // refused with 412 — nothing clobbered
  await profilePage.captureForReview("profile-rebase-notice");
  await profilePage.saveTaste(); // the precondition was refreshed with the notice
  await profilePage.expectTasteView("My edit, drafted while someone else saved.");
});

test("per-meal cadence steppers persist through the merge-patch (reload keeps the value)", async ({
  profilePage,
}) => {
  await profilePage.openTab("prefs");
  // The seed's cadence map { breakfast: 2, lunch: 1, dinner: 4 } (the beforeEach direct-API
  // reset re-establishes it, so this holds on every attempt/retry regardless of a prior run).
  await profilePage.expectCadence("breakfast", 2);
  await profilePage.expectCadence("dinner", 4);
  // Bumping ONE meal is a per-key merge — the others survive.
  await profilePage.setCadence("breakfast", 1);
  await profilePage.expectCadence("breakfast", 3);
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.expectCadence("breakfast", 3);
  await profilePage.expectCadence("dinner", 4); // untouched by the breakfast patch
  await profilePage.captureForReview("profile-prefs");
});

test("the weekly budget sets, then clears to UNSET (a clear writes null, never 0)", async ({
  profilePage,
}) => {
  await profilePage.openTab("prefs");
  // The seeded budget is 95 (the beforeEach direct-API reset re-establishes it, so this holds
  // on every attempt/retry even though this test ends UNSET).
  await profilePage.expectBudget(95);
  await profilePage.setBudget(120);
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.expectBudget(120);

  // Clearing is a first-class UNSET (weekly_budget: null) — NOT a 0. A reload proves it:
  // an unset budget renders the empty field + the "no budget line" helper; a 0 would show
  // "0" with no helper.
  await profilePage.clearBudget();
  await profilePage.expectBudgetUnset();
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.expectBudgetUnset();
});

test("the preferences tab offers no retired lunch-strategy / ready-to-eat control", async ({
  profilePage,
}) => {
  await profilePage.openTab("prefs");
  await expect(profilePage.prefsTab()).toBeVisible();
  // The retired preferences (D8/D21; meal vibes subsume them) render no control.
  await expect(profilePage.retiredSeg("lunch_strategy")).toHaveCount(0);
  await expect(profilePage.retiredSeg("ready_to_eat_default_action")).toHaveCount(0);
  await expect(profilePage.pageText("Lunch strategy")).toHaveCount(0);
  await expect(profilePage.pageText("Ready-to-eat items")).toHaveCount(0);
});

test("the Store card exposes four honest adapter tabs from one projection", async ({ profilePage }) => {
  const adapters = SEED.app.storeAdapters;
  await profilePage.openTab("prefs");
  await expect(profilePage.storeCard()).toBeVisible();
  await expect(profilePage.storePanel("kroger")).toContainText(adapters.kroger.name);
  await expect(profilePage.storePanel("kroger")).toContainText(adapters.kroger.address);

  await profilePage.openStoreTab("instacart");
  await expect(profilePage.storePanel("instacart")).toContainText("Coming later");
  await expect(profilePage.storePanel("instacart").getByRole("button")).toHaveCount(0);

  await profilePage.openStoreTab("satellites");
  await expect(profilePage.storePanel("satellites")).toContainText("Freshness unavailable");
  await expect(profilePage.storePanel("satellites")).toContainText("not available in the member app yet");
  await expect(profilePage.storePanel("satellites").getByRole("link", { name: "Open Satellites" })).toHaveCount(0);
  await expect(profilePage.storePanel("satellites").getByRole("link", { name: "Adapter authoring guide" })).toBeVisible();

  await profilePage.openStoreTab("offline");
  for (const store of adapters.offline) await expect(profilePage.offlineStore(store.slug)).toContainText(store.name);
  await expect(profilePage.storePanel("offline")).not.toContainText("Aisle map");
  await profilePage.captureForReview("profile-store-adapters");
  await profilePage.setViewport(390, 844);
  await profilePage.captureForReview("profile-store-adapters-mobile");
});

test("the Kroger picker selects one exact provider result and cancel/empty/error never write", async ({ profilePage }) => {
  const adapters = SEED.app.storeAdapters;
  await profilePage.routeKrogerLocations({ locations: adapters.search });
  await profilePage.openTab("prefs");
  await profilePage.openKrogerPicker();
  await profilePage.searchKrogerZip("76109");
  await expect(profilePage.krogerModal().getByTestId("kroger-location-result")).toHaveCount(2);
  await profilePage.captureForReview("profile-kroger-picker");
  await profilePage.chooseKrogerLocation(adapters.search[0].location_id);
  await expect(profilePage.storePanel("kroger")).toContainText(adapters.search[0].name);
  await expect(profilePage.storePanel("kroger")).toContainText(adapters.search[0].address);

  await profilePage.openKrogerPicker();
  await profilePage.cancelKrogerPicker();
  await expect(profilePage.storePanel("kroger")).toContainText(adapters.search[0].name);

  await profilePage.clearKrogerLocationsRoute();
  await profilePage.routeKrogerLocations({ locations: [] });
  await profilePage.openKrogerPicker();
  await profilePage.searchKrogerZip("76109");
  await expect(profilePage.krogerModal().getByTestId("kroger-location-empty")).toBeVisible();
  await profilePage.cancelKrogerPicker();

  await profilePage.clearKrogerLocationsRoute();
  await profilePage.routeKrogerLocations({ error: "upstream_unavailable", message: "Kroger is unavailable" }, 503);
  await profilePage.openKrogerPicker();
  await profilePage.searchKrogerZip("76109");
  await expect(profilePage.krogerModal().getByTestId("kroger-location-error")).toContainText("Kroger is unavailable");
  await expect(profilePage.krogerModal().getByTestId("kroger-location-result")).toHaveCount(0);
  await profilePage.cancelKrogerPicker();
});

test("a later Kroger search wins when an earlier response finishes last", async ({ profilePage }) => {
  const first = { locations: [{ location_id: "first", name: "Old result", address: "1 First St", zip: "76109" }] };
  const second = { locations: [{ location_id: "second", name: "New result", address: "2 Second St", zip: "76116" }] };
  await profilePage.routeOverlappingKrogerLocations("76109", first, "76116", second);
  await profilePage.openTab("prefs");
  await profilePage.openKrogerPicker();
  await profilePage.submitKrogerZipWithEnter("76109");
  await profilePage.submitKrogerZipWithEnter("76116");
  await expect(profilePage.krogerModal().getByText("New result")).toBeVisible();
  await expect(profilePage.krogerModal().getByText("Old result")).toHaveCount(0);
});

test("Kroger connect follows the minted URL in the same window", async ({ profilePage, page }) => {
  await profilePage.routeKrogerConnect("/profile?connected=1");
  await profilePage.openTab("prefs");
  await profilePage.connectKroger();
  await expect(page).toHaveURL(/\/profile\?connected=1$/);
});

test("disconnect refreshes the Store card and grocery launcher without mutating the list", async ({
  profilePage,
  groceryPage,
}) => {
  await profilePage.routeDisconnectProjection();
  await profilePage.goto();
  await profilePage.openTab("prefs");
  const before = await profilePage.grocerySnapshot();
  await expect(profilePage.storePanel("kroger")).toContainText("Connected");

  await profilePage.disconnectKroger();
  await expect(profilePage.storePanel("kroger")).toContainText("Not connected");
  await groceryPage.goto();
  await groceryPage.landmark();
  await expect(groceryPage.launcherEntry("kroger")).toContainText("Connect Kroger in Profile first");
  await expect(groceryPage.launcherEntry("kroger").getByRole("button")).toBeDisabled();
  expect(await profilePage.grocerySnapshot()).toEqual(before);
});

test("legacy/missing Offline preferences remain visible without silent replacement", async ({ profilePage }) => {
  await profilePage.setStores({
    primary: "kroger",
    fulfillment: null,
    preferred_location: "Kroger - 76104",
    preferred_location_name: null,
    preferred_location_address: null,
  });
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await expect(profilePage.storePanel("kroger")).toContainText("Kroger - 76104");

  await profilePage.setStores({
    primary: "missing-store",
    fulfillment: null,
    preferred_location_name: null,
    preferred_location_address: null,
  });
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.openStoreTab("offline");
  await expect(profilePage.storePanel("offline")).toContainText("missing-store");
  await expect(profilePage.storePanel("offline")).toContainText("no longer available");
});

test("meal vibes group by meal, and the pinned indicator marks pinned rows (de-emphasizing debt)", async ({
  profilePage,
}) => {
  const V = SEED.app.vibes;
  await profilePage.openTab("vibes");

  // Each seeded vibe renders inside its own meal group.
  await profilePage.expectVibeInGroup("breakfast", V.eggs.vibe);
  await profilePage.expectVibeInGroup("breakfast", V.toast.vibe);
  await profilePage.expectVibeInGroup("lunch", V.bowl.vibe);
  await profilePage.expectVibeInGroup("dinner", V.sauce.vibe);

  // Pinned rows carry the indicator; unpinned rows do not.
  await profilePage.expectPinned("breakfast", V.eggs.vibe);
  await profilePage.expectNotPinned("breakfast", V.toast.vibe);
  await profilePage.expectPinned("dinner", V.sauce.vibe);
  await profilePage.expectNotPinned("dinner", V.stir.vibe);

  // A pinned row carries the `pinned` class (the de-emphasized debt meter rides it).
  await expect(profilePage.vibeInGroup("dinner", V.sauce.vibe)).toHaveClass(/pinned/);
  await profilePage.captureForReview("profile-vibes");
});

test("an inline add_vibe suggestion adds the vibe into its meal group and leaves the queue", async ({
  profilePage,
}) => {
  const addA = SEED.app.proposals.addA; // add_vibe, meal: dinner
  await profilePage.openTab("vibes");

  // The dinner group carries the add_vibe footer card; adding upserts the vibe.
  await expect(profilePage.addSuggestCard("dinner")).toBeVisible();
  await profilePage.addGroupSuggestion("dinner");
  await profilePage.expectVibeInGroup("dinner", addA.vibe);
  await expect(profilePage.addSuggestCard("dinner")).toHaveCount(0);

  // Durable: a reload keeps the vibe and never re-surfaces the resolved proposal.
  await profilePage.goto();
  await profilePage.openTab("vibes");
  await profilePage.expectVibeInGroup("dinner", addA.vibe);
  await expect(profilePage.addSuggestCard("dinner")).toHaveCount(0);
});

test("an inline adjust_cadence suggestion applies to its palette row and resolves", async ({
  profilePage,
}) => {
  const adjust = SEED.app.proposals.adjust; // targets the lunch "big grain bowl", → 21d
  const bowl = SEED.app.vibes.bowl;
  await profilePage.openTab("vibes");

  // The lunch bowl row carries a wand; opening it reveals the suggestion; applying it
  // upserts the row's cadence and resolves the proposal.
  await profilePage.openRowSuggestion(bowl.vibe);
  await expect(profilePage.vibeRow(bowl.vibe).getByTestId("vibe-suggest")).toBeVisible();
  await profilePage.applyRowSuggestion(bowl.vibe);

  // The proposal is resolved (the wand is gone), and the row now reads its new cadence.
  await expect(profilePage.vibeRow(bowl.vibe).getByTestId("vibe-wand")).toHaveCount(0);
  await expect(profilePage.vibeRow(bowl.vibe)).toContainText(`every ${adjust.cadence_days} days`);
});

test("no merge_recipes proposal ever surfaces on the member vibes tab", async ({
  profilePage,
}) => {
  const merge = SEED.app.proposals.merge;
  await profilePage.openTab("vibes");
  await expect(profilePage.vibesTab()).toBeVisible();
  // The dup-scan merge is chat-guided (D8) — it renders nowhere on this tab: no title, no
  // rationale, no accept/dismiss surface for it.
  await expect(profilePage.pageText(merge.titles[0])).toHaveCount(0);
  await expect(profilePage.pageText(merge.titles[1])).toHaveCount(0);
  await expect(profilePage.pageText("look like the same dish")).toHaveCount(0);
});

// --- the Preferred-brands tier card (brand-tier model) -----------------------------

const LADDER = SEED.app.brands.ladder; // butter: [["Kerrygold"], ["store brand"]]
const DONT_CARE = SEED.app.brands.dontCare; // yellow_onion: any-brand

test("brand chips move across tiers; a past-edge move creates a new tier", async ({
  profilePage,
}) => {
  await profilePage.openTab("prefs");
  const [top, second] = [LADDER.tiers[0][0], LADDER.tiers[1][0]];
  await profilePage.expectTierBrands(LADDER.term, 0, [top]);
  await profilePage.expectTierBrands(LADDER.term, 1, [second]);

  // Mid-ladder ▲ JOINS the tier above (equals — the emptied tier collapses)…
  await profilePage.moveBrand(LADDER.term, second, "up");
  await expect(profilePage.brandTiers(LADDER.term)).toHaveCount(1);
  await profilePage.expectTierBrands(LADDER.term, 0, [top, second]);
  await expect(profilePage.brandTiers(LADDER.term).first()).toContainText("either works — cheapest wins");

  // …and ▲ from the TOP tier goes past the edge: a new top tier of just that brand.
  await profilePage.moveBrand(LADDER.term, second, "up");
  await expect(profilePage.brandTiers(LADDER.term)).toHaveCount(2);
  await profilePage.expectTierBrands(LADDER.term, 0, [second]);
  await profilePage.expectTierBrands(LADDER.term, 1, [top]);
  await profilePage.captureForReview("profile-brands");

  // The structure persisted through the family-scoped merge-patch.
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.expectTierBrands(LADDER.term, 0, [second]);
  await profilePage.expectTierBrands(LADDER.term, 1, [top]);
});

test("the any-brand toggle is a partial family patch — the tiers are preserved", async ({
  profilePage,
}) => {
  await profilePage.openTab("prefs");
  await profilePage.expectAnyBrand(LADDER.term, false);
  await profilePage.toggleAnyBrand(LADDER.term);
  await profilePage.expectAnyBrand(LADDER.term, true);
  await expect(profilePage.brandFamily(LADDER.term).getByTestId("brand-any-state")).toBeVisible();

  // Reload: any_brand stuck AND both tiers survived the merge (nothing clobbered).
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.expectAnyBrand(LADDER.term, true);
  await expect(profilePage.brandTiers(LADDER.term)).toHaveCount(2);

  // Toggling back off is the same partial patch.
  await profilePage.toggleAnyBrand(LADDER.term);
  await profilePage.expectAnyBrand(LADDER.term, false);
});

test("remove-family clears to ambiguous; add-family + first brand creates a ladder", async ({
  profilePage,
}) => {
  await profilePage.openTab("prefs");
  // The seeded don't-care family renders the any-brand state, then clears with `null`.
  await expect(profilePage.brandFamily(DONT_CARE.term).getByTestId("brand-any-state")).toBeVisible();
  await profilePage.removeBrandFamily(DONT_CARE.term);
  await expect(profilePage.brandFamily(DONT_CARE.term)).toHaveCount(0);

  // A new category is a LOCAL draft (an empty tier persists nothing) until its
  // first brand lands, which writes the family's tier object.
  await profilePage.addBrandFamily("pasta");
  await expect(profilePage.brandTiers("pasta")).toHaveCount(1);
  await profilePage.addBrandToTier("pasta", 0, "De Cecco");
  await profilePage.expectTierBrands("pasta", 0, ["De Cecco"]);

  // Both edits persisted (the removed family stays gone; the new ladder survives).
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await expect(profilePage.brandFamily(DONT_CARE.term)).toHaveCount(0);
  await profilePage.expectTierBrands("pasta", 0, ["De Cecco"]);
});
