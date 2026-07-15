// The SaaS deployment variant (deployment-profiles-and-visibility-lens), LIVE against
// the sibling `wrangler dev` whose D1 carries `operator_config.deployment_profile =
// 'saas'` over the IDENTICAL fixture set (the `saas` Playwright project's baseURL —
// see app/visual/setup.mjs). The seeded active household owns ZERO non-curated imports
// (every corpus grant belongs to the pending household; a subset also carries curated
// grants), so this server boots straight into the cookbook cold-start posture:
//   - the curated-floor onboarding panel over the badged curated list (design req #11),
//   - the true-zero variant once the household hides the curated tier (design req #10's
//     Preferences card, round-tripped through the real merge-patch),
//   - household-level dismiss persistence across reload,
//   - the browse lens: the pending household's non-friend rows render NOWHERE.
// Specs restore every household flag they set (the two servers share nothing, but specs
// within this file share the saas D1), so order and retries stay deterministic.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
import { RecipePage } from "../pages/recipe.page";
import { ShellPage } from "../pages/shell.page";

const LENS = SEED.app.lens;

test.beforeEach(async ({ asMember }) => {
  await asMember();
});

test("curated-floor cold start: the onboarding panel carries three cards over the badged curated list", async ({
  cookbookPage,
}) => {
  await cookbookPage.landmark();
  // The onboarding panel renders ABOVE the list with its three compact action cards.
  await expect(cookbookPage.onboardingPanel()).toBeVisible();
  await expect(cookbookPage.onboardingCard("friends")).toBeVisible();
  await expect(cookbookPage.onboardingCard("agent")).toBeVisible();
  await expect(cookbookPage.onboardingCard("curated")).toBeVisible();
  // The "Add friends" card links the People destination (the nav stub the People
  // change fills); the agent card carries the paste-a-URL copy (this member's profile
  // is initialized, so the Connect-to-Claude modal branch doesn't render its button).
  await expect(cookbookPage.onboardingCard("friends").getByRole("link", { name: "Open People" })).toBeVisible();
  await expect(cookbookPage.onboardingCard("agent")).toContainText("Paste a recipe URL in a Claude chat");
  // The curated card's anchor-scroll affordance lands on the list below.
  await cookbookPage.page.getByTestId("onboarding-browse-curated").click();
  await expect(cookbookPage.organicList()).toBeVisible();
  // The filter bar and the Recommended panel are HIDDEN in this state.
  await expect(cookbookPage.filterBar()).toHaveCount(0);
  await expect(cookbookPage.promotedPanel()).toHaveCount(0);
  // The curated rows below carry the "Curated" provenance badge, hearts + plan-toggles live.
  for (const slug of LENS.curated) {
    await expect(cookbookPage.organicRow(slug)).toBeVisible();
    await expect(cookbookPage.curatedBadge(slug)).toHaveText("Curated");
    await expect(cookbookPage.row(slug).getByTestId("row-fav")).toBeVisible();
    await expect(cookbookPage.row(slug).getByTestId("row-plan-toggle")).toBeVisible();
  }
  await cookbookPage.captureForReview("cookbook-saas-cold-start");
});

test("browse lens: a non-friend household's recipe renders nowhere — list, search, or badges", async ({
  cookbookPage,
}) => {
  await cookbookPage.landmark();
  // The pending household's non-curated recipe (visible under self-hosted) is out of
  // this household's saas lens: absent from the page entirely.
  await expect(cookbookPage.row(LENS.outOfLens)).toHaveCount(0);
  // Keyword search runs over the lens too — the out-of-lens title never matches.
  await cookbookPage.search("ragu");
  await cookbookPage.expectNoMatches();
  await cookbookPage.clearSearch();
  // Exactly the curated tier is visible: every listed row is badged, nothing else renders.
  await expect(cookbookPage.organicList().getByTestId("recipe-row")).toHaveCount(LENS.curated.length);
  await expect(cookbookPage.anyCuratedBadges()).toHaveCount(LENS.curated.length);
});

test("the Preferences curated card hides the tier for the household: the true-zero state carries the page", async ({
  profilePage,
  cookbookPage,
}) => {
  // The SaaS-only "Curated collection" card (design request #10): title, explanation,
  // one toggle, the household-scope hint — no confirm dialog.
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await expect(profilePage.curatedCard()).toBeVisible();
  await expect(profilePage.curatedCard()).toContainText("A starter set of recipes we maintain.");
  await expect(profilePage.curatedCard()).toContainText("Applies to everyone in your household");
  await expect(profilePage.curatedToggle()).toHaveAttribute("data-state", "checked");
  await expect(profilePage.curatedReversible()).toHaveCount(0);
  await profilePage.captureForReview("profile-saas-curated-card");
  // Off writes `curated_hide: true` and surfaces the reversibility copy on the off state.
  await profilePage.toggleCurated();
  await expect(profilePage.curatedToggle()).toHaveAttribute("data-state", "unchecked");
  await expect(profilePage.curatedReversible()).toContainText("nothing is deleted");
  await profilePage.captureForReview("profile-saas-curated-card-off");

  // With the curated tier hidden and zero own imports, the cookbook is the TRUE-ZERO
  // state: the same three cards on the fuller empty treatment — no list, no filter
  // bar, no promoted panel.
  await cookbookPage.goto();
  await cookbookPage.landmark();
  await expect(cookbookPage.onboardingZero()).toBeVisible();
  await expect(cookbookPage.onboardingCard("friends")).toBeVisible();
  await expect(cookbookPage.onboardingCard("agent")).toBeVisible();
  await expect(cookbookPage.onboardingCard("curated")).toBeVisible();
  await expect(cookbookPage.organicList()).toHaveCount(0);
  await expect(cookbookPage.page.getByTestId("recipe-row")).toHaveCount(0);
  await expect(cookbookPage.filterBar()).toHaveCount(0);
  await expect(cookbookPage.promotedPanel()).toHaveCount(0);
  await cookbookPage.captureForReview("cookbook-saas-true-zero");

  // Back on: `curated_hide` clears (merge-patch null — back to shown), and the curated
  // rows reappear exactly as promised — nothing was deleted.
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.toggleCurated();
  await expect(profilePage.curatedToggle()).toHaveAttribute("data-state", "checked");
  await cookbookPage.goto();
  await expect(cookbookPage.organicRow(LENS.curated[0])).toBeVisible();
});

test("explicit dismiss persists for the household across reload and never returns at zero own recipes", async ({
  cookbookPage,
}) => {
  await cookbookPage.landmark();
  await expect(cookbookPage.onboardingPanel()).toBeVisible();
  // Dismiss writes the household-level preferences flag; the standard browse page
  // takes over — the filter bar returns and the curated rows stay listed (badged).
  await cookbookPage.dismissOnboarding();
  await expect(cookbookPage.onboardingPanel()).toHaveCount(0);
  await expect(cookbookPage.filterBar()).toBeVisible();
  await expect(cookbookPage.curatedBadge(LENS.curated[0])).toBeVisible();
  // Reload: the household still owns zero non-curated imports, but a dismissed panel
  // MUST NOT return — the flag persists server-side, not in this tab's state.
  await cookbookPage.goto();
  await cookbookPage.landmark();
  await expect(cookbookPage.onboardingPanel()).toHaveCount(0);
  await expect(cookbookPage.filterBar()).toBeVisible();
  await cookbookPage.captureForReview("cookbook-saas-dismissed");
  // Restore for retries/other specs: clearing the flag (merge-patch null) brings the
  // panel back — proving the dismissal is exactly the stored household flag.
  await cookbookPage.patchPreferences({ custom: { cookbook_onboarding_dismissed: null } });
  await cookbookPage.goto();
  await cookbookPage.landmark();
  await expect(cookbookPage.onboardingPanel()).toBeVisible();
});

test("note composer: a curated (anonymously-visible) recipe carries the full Public copy", async ({ page }) => {
  // The active member's saas lens holds the curated tier — curated recipes ARE the
  // anonymous position under SaaS, so `anonymously_visible` is true and Public
  // states the full audience.
  const recipePage = new RecipePage(page, LENS.curated[0]);
  await recipePage.goto();
  await recipePage.landmark();
  await recipePage.selectComposerTier("public");
  await recipePage.expectTierDescription("including the public cookbook site");
});

test.describe("note composer: the reduced Public copy on a household-only recipe", () => {
  // A genuinely logged-out context: the pending household's member signs in with the
  // second deterministic invite (never consumed in the saas server — passkey.spec
  // only runs against the default one).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a recipe off the anonymous site states the note won't reach it", async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.login(SEED.inviteAlt);
    await new ShellPage(page).landmark();
    // The pending household owns this import; the anonymous lens (curated-only under
    // SaaS) does not include it — `anonymously_visible: false`.
    const recipePage = new RecipePage(page, LENS.outOfLens);
    await recipePage.goto();
    await recipePage.landmark();
    await recipePage.expectComposerTierSelected("friends");
    await recipePage.selectComposerTier("public");
    await recipePage.expectTierDescription("it isn't on the public site, so this note won't be either");
    await recipePage.captureForReview("recipe-note-public-copy-reduced");
  });
});
