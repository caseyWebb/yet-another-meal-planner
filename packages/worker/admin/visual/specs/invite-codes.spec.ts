// The Members › Invite codes sub-tab (self-service-signup): the roster of group codes with
// live usage, the mint dialog (shown-once banner), and the revoke confirm. Mint accumulates a
// harmless extra code in the shared local D1; revoke is only ever CANCELLED here so the app
// suite's live `PW-GROUP-OPEN` code stays redeemable.
import { test, expect } from "../fixtures";
import { SEED } from "../seed.mjs";

test("invite-codes roster lists a seeded code with its usage", async ({ membersPage }) => {
  await membersPage.gotoCodes();
  const row = membersPage.codeRow(SEED.groupCode.open);
  await expect(row).toBeVisible();
  await expect(row).toContainText("summer camp crew");
  await expect(row).toContainText("/10 used");
  await membersPage.captureForReview("invite-codes-roster");
});

test("mint opens a dialog and shows the code once", async ({ membersPage }) => {
  await membersPage.gotoCodes();
  const dialog = await membersPage.openMintCodeDialog();
  await expect(dialog.title("Mint invite code")).toBeVisible();
  await dialog.root.getByRole("button", { name: "Mint invite" }).click();
  await expect(membersPage.mintedBanner).toContainText("Invite code minted");
  await membersPage.captureForReview("invite-codes-minted");
  await membersPage.bannerDismiss.click();
  await expect(membersPage.mintedBanner).toBeHidden();
});

test("revoke opens its confirm from a code row (cancelled, never confirmed)", async ({ membersPage }) => {
  await membersPage.gotoCodes();
  await membersPage.revokeCodeButton(SEED.groupCode.open).click();
  await expect(membersPage.revokeCodeDialog()).toBeVisible();
  await membersPage.captureForReview("invite-codes-revoke");
  // Cancel, not confirm — revoking the shared seed's open code would break the app signup spec.
  await membersPage.revokeCodeDialog().getByRole("button", { name: "Cancel" }).click();
  await expect(membersPage.revokeCodeDialog()).toBeHidden();
});
