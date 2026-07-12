// Plan your week (member-app-propose / shared-propose-orchestration): the propose flow against
// the REAL stateless endpoint, with ZERO model calls — every proposal computes from the seed's
// synthetic vectors. The shared seed provisions a meal-vibe palette
// (profile-planning-and-vibes-ui), so these flow specs control it explicitly: wipePalette() for
// the empty-palette assertion first, then self-provision the two seeded-vector vibes through the
// member API. The surface is the shared component (D20): its D8-cut controls (re-roll, per-slot
// lock + exclude, adventurousness, protein wants, freeform) are ABSENT; refinement is per-meal
// counts / swap / facet pins / per-slot vibe / sides editing / commit.
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

  test("first propose: intro → slots and the variety bar", async ({ proposePage }) => {
    await proposePage.expectIntro();
    await proposePage.awaitPropose(() => proposePage.start());
    await expect(proposePage.slotCards()).toHaveCount(2);
    await expect(proposePage.varietyBar()).toBeVisible();
    expect(await proposePage.mains()).toHaveLength(2);
    await proposePage.captureForReview("propose");
  });

  test("the shared surface omits the D8/D20-cut controls (per-meal steppers, no lock/exclude/reroll/nudges)", async ({
    proposePage,
    page,
  }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    await proposePage.mains();
    // Per-meal steppers replace the single nights stepper (D20).
    await expect(proposePage.mealStepper("breakfast")).toBeVisible();
    await expect(proposePage.mealStepper("lunch")).toBeVisible();
    await expect(proposePage.mealStepper("dinner")).toBeVisible();
    await expect(page.getByTestId("nights-n")).toHaveCount(0);
    // The cuts: re-roll, per-slot lock + exclude, adventurousness, protein wants, freeform.
    for (const id of ["propose-reroll", "slot-lock", "slot-exclude", "nudge-variety", "nudge-freeform"]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
  });

  test("session resume by replay: the same request yields the same week on reload", async ({
    proposePage,
  }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    const week = await proposePage.mains();

    // Reload: the client session replays the SAME request body → the SAME week, with no
    // server-side session read (the endpoint is stateless and deterministic).
    await proposePage.goto();
    expect(await proposePage.mains()).toEqual(week);
  });

  test("a per-meal stepper is a request change — it re-queries the week", async ({ proposePage }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    await proposePage.mains();
    // Move the dinner count to a value that differs from the default (which varies with the
    // member's `default_cooking_nights`), so the click always fires a real request change.
    const before = Number(await proposePage.mealStepper("dinner").innerText());
    const target = before < 6 ? before + 1 : before - 1;
    await proposePage.awaitPropose(() => proposePage.setMeal("dinner", target));
    await expect(proposePage.mealStepper("dinner")).toHaveText(String(target));
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

    // Add a cuisine pin no fish recipe satisfies → the explicit empty slot, pins clearable IN
    // PLACE (the wider session survives).
    await proposePage.awaitPropose(() => proposePage.pinFacet(COMFORT, "cuisine", "indian"));
    await proposePage.expectEmptySlot(COMFORT);
    await proposePage.captureForReview("propose-over-constrained");
    // Clearing the pin returns to the PREVIOUS request; assert on the re-rendered content directly.
    await proposePage.clearFacet(COMFORT, "cuisine");
    await expect(proposePage.slot(COMFORT)).not.toHaveAttribute("data-empty", "true");
    await proposePage.expectPinned(COMFORT, "protein", "fish"); // the other pin survived
  });

  test("swap-similar applies the endpoint's alt_similar", async ({ proposePage }) => {
    await proposePage.awaitPropose(() => proposePage.start());
    await proposePage.mains();

    // Swap: the menu's "Something similar" names the endpoint's alt_similar; picking it pins that
    // recipe to the slot's vibe (identity intact) and re-diversifies the rest.
    await proposePage.openSwapMenu(SEAFOOD);
    const offered = await proposePage.swapSimilarOffer(SEAFOOD);
    await proposePage.awaitPropose(() => proposePage.swapSimilar(SEAFOOD));
    await expect(proposePage.slot(SEAFOOD).locator(".slot-title")).toHaveText(offered);
    await proposePage.expectWhy(SEAFOOD, "your pick");
    await proposePage.captureForReview("propose-swapped");
  });

  test("a sides edit is a local refinement — it does NOT re-query, and rides to the plan on commit", async ({
    proposePage,
    planPage,
    page,
  }) => {
    await proposePage.wipePlan();
    await proposePage.goto();
    await proposePage.awaitPropose(() => proposePage.start());
    const mains = await proposePage.mains();
    expect(mains.length).toBeGreaterThan(0);

    // Adding a side must NOT fire a propose re-query (decision 1: the D4 inverse).
    let requeried = false;
    const onRequest = (r: { url(): string; method(): string }) => {
      if (r.url().includes("/api/propose") && !r.url().includes("/weather") && r.method() === "POST") requeried = true;
    };
    page.on("request", onRequest);
    await proposePage.addSide(SEAFOOD, "Griddled Bread");
    await expect(proposePage.slotSides(SEAFOOD)).toContainText("Griddled Bread");
    await page.waitForTimeout(300);
    page.off("request", onRequest);
    expect(requeried, "a sides edit must not re-query the proposal").toBe(false);

    // Commit: the edited side rides onto the seafood row's plan entry.
    await proposePage.commit();
    await planPage.landmark();
    const rows = await proposePage.readPlan();
    const seafoodRow = rows.find((r) => r.from_vibe === SEAFOOD);
    expect(seafoodRow, "seafood row committed").toBeDefined();
    expect(seafoodRow!.sides ?? []).toContain("Griddled Bread");
  });

  test("commit lands the week on the plan with dates and from_vibe provenance", async ({
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

    // The plan READ confirms the rows: every committed main present, client-assigned open dates,
    // and the slot's vibe id threaded as from_vibe (the provenance that stamps satisfied_vibe when
    // it's cooked — cadence debt + the tighten signal).
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

    // Committing wrote the plan and cleared the client session — nothing else: back on the propose
    // page, the flow starts fresh from the intro.
    await proposePage.goto();
    await proposePage.expectIntro();
  });
});
