// Normalization interactions: the Override and Add-alias native dialogs (hydrated by the
// Normalize island; the open-retry lives in the dialog component).
import { test, expect } from "../fixtures";
import { SEED } from "../seed.mjs";

test("override opens as a native dialog from a decision row", async ({ normalizePage }) => {
  await normalizePage.gotoTab("decisions");
  const dialog = await normalizePage.openOverrideDialog();
  await expect(dialog.title("Override normalization")).toBeVisible();
});

test("add-alias opens as a native dialog on the aliases tab", async ({ normalizePage }) => {
  await normalizePage.gotoTab("aliases");
  const dialog = await normalizePage.openAddAliasDialog();
  await expect(dialog.title("Add alias mapping")).toBeVisible();
});

test("aliases tab lists real mappings only, self-entries as a count chip", async ({ normalizePage }) => {
  await normalizePage.gotoTab("aliases");
  await normalizePage.expectMappingsOnly(SEED.normalize.aliasVariant, SEED.normalize.selfEntryVariant, 1);
  await normalizePage.captureForReview("normalize-aliases-mappings");
});

test("decisions edges segment lists verdicts and links a revisited drop to restorations", async ({ normalizePage }) => {
  await normalizePage.gotoEdgesStream();
  await expect(normalizePage.streamSegment).toBeVisible();
  await normalizePage.expectEdgeDecision(SEED.audit.keptEdge, "Kept");
  await normalizePage.expectEdgeDecision(SEED.audit.droppedEdge, "Dropped");
  await normalizePage.captureForReview("normalize-decisions-edges");
  // The dropped edge was later revisited by the replay — its pointer lands on the Audits tab's
  // restorations log.
  await normalizePage.followRevisitedPointer();
  await normalizePage.expectRestoration(SEED.audit.droppedEdge);
});
