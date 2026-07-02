// Normalization interactions: the Override and Add-alias native dialogs (hydrated by the
// Normalize island; the open-retry lives in the dialog component).
import { test, expect } from "../fixtures";

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
