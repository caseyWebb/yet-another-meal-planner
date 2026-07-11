// Plan your week (member-app-propose D12): the propose flow against the REAL stateless
// endpoint, with ZERO model calls — every proposal computes from the seed's synthetic
// vectors, and the freeform spec's phrase is a pre-warmed query-embedding-cache HIT
// (an uncached embed would hit the absent local Workers AI and fail the request, so
// the no-model guarantee is self-enforcing). The shared seed provisions a meal-vibe
// palette (profile-planning-and-vibes-ui), so these flow specs control it explicitly:
// wipePalette() for the empty-palette assertion first, then self-provision the two
// seeded-vector vibes through the member API.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

const P = SEED.app.propose;
const SEAFOOD = P.vibes.seafood.id;
const COMFORT = P.vibes.comfort.id;

test.beforeEach(async ({ asMember, proposePage }) => {
  await asMember();
  await proposePage.goto();
  await proposePage.landmark();
});

test("an empty palette renders the set-up-your-palette state, not a broken planner", async ({
  proposePage,
}) => {
  await proposePage.wipePalette();
  await proposePage.goto();
  await proposePage.expectEmptyPalette();
  await proposePage.captureForReview("propose-empty-palette");
});

test.describe("with the self-provisioned palette", () => {
  test.beforeEach(async ({ proposePage }) => {
    await proposePage.provisionPalette();
    await proposePage.goto();
  });

  test("first propose: intro → slots and the variety bar", async ({
    proposePage,
  }) => {
    await proposePage.expectIntro();
    await proposePage.awaitPropose(() => proposePage.start());
    await expect(proposePage.slotCards()).toHaveCount(2);
    await expect(proposePage.varietyBar()).toBeVisible();
    const mains = await proposePage.mains();
    expect(mains).toHaveLength(2);
    await proposePage.captureForReview("propose");
  });

  test("same request, same week (session resume by replay); a reroll finds a different one", async ({
    proposePage,
  }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    const week = await proposePage.mains();

    // Reload: the client session replays the SAME request body → the SAME week, with
    // no server-side session read (the endpoint is stateless and deterministic).
    await proposePage.goto();
    expect(await proposePage.mains()).toEqual(week);

    // Reroll advances only the seed. A given seed pair may legitimately produce the
    // same valid week from a small corpus, so roll until it differs (bounded).
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {
      await proposePage.awaitPropose(() => proposePage.reroll());
      changed = JSON.stringify(await proposePage.mains()) !== JSON.stringify(week);
    }
    expect(changed, "five rerolls never changed the week").toBe(true);
  });

  test("a locked slot survives a reroll (identity-preserving pin, 'your pick')", async ({
    proposePage,
  }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    await proposePage.mains();
    const kept = await proposePage.slot(SEAFOOD).getAttribute("data-recipe");
    await proposePage.awaitPropose(() => proposePage.lock(SEAFOOD));
    await proposePage.awaitPropose(() => proposePage.reroll());
    await proposePage.awaitPropose(() => proposePage.reroll());
    await expect(proposePage.slot(SEAFOOD)).toHaveAttribute("data-recipe", kept!);
    await proposePage.expectWhy(SEAFOOD, "your pick");
    await proposePage.captureForReview("propose-locked");
  });

  test("a facet pin narrows one night; an over-constrained night relaxes in place", async ({
    proposePage,
  }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    await proposePage.mains();

    // Pin fish onto the comfort slot: its main re-fills as fish, chip renders pinned.
    await proposePage.awaitPropose(() => proposePage.pinFacet(COMFORT, "protein", "fish"));
    await proposePage.expectPinned(COMFORT, "protein", "fish");
    await expect(proposePage.slot(COMFORT).getByTestId("facet-protein")).toContainText("fish");

    // Add a cuisine pin no fish recipe satisfies → the explicit empty slot, pins
    // clearable IN PLACE (the wider session survives).
    await proposePage.awaitPropose(() => proposePage.pinFacet(COMFORT, "cuisine", "indian"));
    await proposePage.expectEmptySlot(COMFORT);
    await proposePage.captureForReview("propose-over-constrained");
    // Clearing the pin returns to the PREVIOUS request — served from the query cache
    // (no network round-trip), so assert on the re-rendered content directly.
    await proposePage.clearFacet(COMFORT, "cuisine");
    await expect(proposePage.slot(COMFORT)).not.toHaveAttribute("data-empty", "true");
    await proposePage.expectPinned(COMFORT, "protein", "fish"); // the other pin survived
  });

  test("swap-similar applies the endpoint's alt_similar; exclude refills the night", async ({
    proposePage,
  }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    await proposePage.mains();

    // Swap: the menu's "Something similar" names the endpoint's alt_similar; picking it
    // pins that recipe to the slot's vibe (identity intact) and re-diversifies the rest.
    await proposePage.openSwapMenu(SEAFOOD);
    const offered = await proposePage.swapSimilarOffer(SEAFOOD);
    await proposePage.awaitPropose(() => proposePage.swapSimilar(SEAFOOD));
    await expect(proposePage.slot(SEAFOOD).locator(".slot-title")).toHaveText(offered);
    await proposePage.expectWhy(SEAFOOD, "your pick");
    await proposePage.captureForReview("propose-swapped");

    // Exclude ("not this one"): clears the pin, adds to exclude, and the night refills
    // with something else — the excluded recipe appears nowhere.
    const excluded = await proposePage.slot(SEAFOOD).getAttribute("data-recipe");
    await proposePage.awaitPropose(() => proposePage.exclude(SEAFOOD));
    await expect(proposePage.slot(SEAFOOD)).not.toHaveAttribute("data-recipe", excluded!);
    expect(await proposePage.mains()).not.toContain(excluded);
  });

  test("the cache-warmed freeform phrase reshapes the week and says why", async ({ proposePage }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    await proposePage.mains();
    // The EXACT seeded phrase — served from the pre-warmed query-embedding cache (a
    // miss would need Workers AI, absent here, and fail: the zero-model gate).
    await proposePage.awaitPropose(() => proposePage.typeFreeform(P.freeform));
    // The phrase's vector IS the soup axis: the comfort slot picks the soup and its
    // why chips carry the matched ask.
    await expect(proposePage.slot(COMFORT)).toHaveAttribute("data-recipe", P.soup.slug);
    await proposePage.expectWhy(COMFORT, "matches your ask");
    await proposePage.captureForReview("propose-freeform");
  });

  test("commit lands the week on the plan with dates, sides, and from_vibe provenance", async ({
    proposePage,
    planPage,
  }) => {
    await proposePage.wipePlan();
    await proposePage.goto();
    await proposePage.awaitPropose(() => proposePage.start());
    const mains = await proposePage.mains();
    expect(mains).toHaveLength(2);

    await proposePage.commit();
    await planPage.landmark(); // commit clears the session and lands on the plan page

    // The plan READ confirms the rows: every committed main present, client-assigned
    // open dates, and the slot's vibe id threaded as from_vibe (the provenance that
    // stamps satisfied_vibe when it's cooked — cadence debt + the tighten signal).
    const rows = await proposePage.readPlan();
    const bySlug = new Map(rows.map((r) => [r.recipe, r]));
    for (const slug of mains) {
      const row = bySlug.get(slug);
      expect(row, `plan row for ${slug}`).toBeDefined();
      expect(row!.planned_for).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([SEAFOOD, COMFORT]).toContain(row!.from_vibe);
    }
    // The soup's corpus side (pairs_with) rode along as an open-world side title.
    const soup = bySlug.get(P.soup.slug);
    if (soup) expect(soup.sides).toContain(P.side.title);
    await planPage.captureForReview("propose-committed-plan");

    // Committing wrote the plan and cleared the client session — nothing else: back on
    // the propose page, the flow starts fresh from the intro.
    await proposePage.goto();
    await proposePage.expectIntro();
  });
});
