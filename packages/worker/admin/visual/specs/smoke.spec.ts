// The all-areas smoke: every registered area renders its shell + area landmark + the global
// health dock, and captures its full-page review screenshot (published on admin-UI PRs — see
// admin/visual/README.md). Plus the routed sub-surfaces (member detail, Discovery › Satellites,
// Normalize › Reconcile) and the seeded-content checks proving each data-hungry area renders
// its fixtures, not an empty state.
import { test } from "../fixtures";
import { AREAS } from "../registry";
import { SEED } from "../seed.mjs";

for (const { area, make } of AREAS) {
  test(`${area} area renders`, async ({ page }) => {
    const po = make(page);
    await po.goto();
    await po.landmark();
    await po.healthDock.expectPresent();
    await po.captureForReview();
  });
}

test("member detail renders for the connected member", async ({ membersPage }) => {
  const detail = membersPage.memberDetail(SEED.members.active);
  await detail.goto();
  await detail.landmark();
  await detail.captureForReview();
});

test("discovery satellites sub-page renders", async ({ discoveryPage }) => {
  const satellites = discoveryPage.satellites();
  await satellites.goto();
  await satellites.landmark();
  await satellites.captureForReview();
});

test("normalize reconcile tab renders its convergence card", async ({ normalizePage }) => {
  await normalizePage.gotoTab("reconcile");
  await normalizePage.expectReconcileCard();
  await normalizePage.captureForReview("normalize-reconcile");
});

test("normalize audits tab renders the convergence surface and its logs", async ({ normalizePage }) => {
  await normalizePage.gotoTab("audits");
  await normalizePage.expectAuditsSurface();
  // Per-card burndown states the seed pins: alias/edge converging (one un-audited row each),
  // sku (empty live plan) and the disjunction sweep (no disjunctive ids) converged — both
  // states render side by side.
  await normalizePage.expectPassBurndown("alias audit", "auditing", "1");
  await normalizePage.expectPassBurndown("edge audit", "auditing", "1");
  await normalizePage.expectPassBurndown("sku-cache re-key", "settled", "0");
  await normalizePage.expectPassBurndown("disjunction sweep", "settled", "0");
  // The one-shot replay's backlog: seed log row 9103 is an un-replayed pre-calibration drop.
  await normalizePage.expectReplayLine("1 pre-calibration drop awaiting replay");
  await normalizePage.expectRestoration(SEED.audit.droppedEdge);
  await normalizePage.expectRejection(SEED.audit.rejection);
  await normalizePage.captureForReview("normalize-audits");
});

test("data sub-nav routes to stores and guidance", async ({ dataPage }) => {
  await dataPage.gotoStores();
  await dataPage.captureForReview("data-stores");
  await dataPage.gotoGuidance();
  await dataPage.captureForReview("data-guidance");
});

test("config sub-nav routes to its four groups", async ({ configPage }) => {
  await configPage.gotoIngestKeys();
  await configPage.captureForReview("config-ingest-keys");
  await configPage.gotoFlyer();
  await configPage.captureForReview("config-flyer");
  await configPage.gotoRanking();
  await configPage.captureForReview("config-ranking");
});

test.describe("seeded fixtures render", () => {
  test("status shows the stat tiles and a registered job", async ({ statusPage }) => {
    await statusPage.goto();
    await statusPage.expectStatTiles();
    await statusPage.jobs.expectJob(SEED.jobs[0]!);
  });

  test("status shows the identity-audit row and the recipe backfill gauge", async ({ statusPage }) => {
    await statusPage.goto();
    await statusPage.expectAuditRow();
    await statusPage.expectRecipeBackfillGauge();
    await statusPage.expandAuditPasses();
    await statusPage.captureForReview("status-identity-audit");
  });

  test("data lists the seeded recipe", async ({ dataPage }) => {
    await dataPage.goto();
    await dataPage.expectSeededRecipe();
  });

  test("insights boards include the seeded recipe", async ({ insightsPage }) => {
    await insightsPage.goto();
    await insightsPage.expectSeededRecipeOnBoard();
  });

  test("usage renders its three dashboard sections", async ({ usagePage }) => {
    await usagePage.goto();
    await usagePage.expectSections();
  });

  test("discovery shows the seeded candidates", async ({ discoveryPage }) => {
    await discoveryPage.goto();
    await discoveryPage.expectCandidate(SEED.discovery.errTitle);
    await discoveryPage.expectCandidate(SEED.discovery.importedTitle);
  });

  test("logs show a seeded run entry", async ({ logsPage }) => {
    await logsPage.goto();
    await logsPage.expectSeededRun();
  });
});
