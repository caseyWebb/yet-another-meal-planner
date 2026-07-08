// Members interactions: the invite dialog (the shared Radix Dialog, located by its
// accessible name) and the pending-member detail state.
import { test, expect } from "../fixtures";
import { SEED } from "../seed.mjs";

test("invite opens as a dialog", async ({ membersPage }) => {
  await membersPage.goto();
  const dialog = await membersPage.openInviteDialog();
  await expect(dialog.title("Invite member")).toBeVisible();
  await membersPage.captureForReview("members-dialog");
});

test("pending member detail shows the not-yet-connected state", async ({ membersPage }) => {
  const detail = membersPage.memberDetail(SEED.members.pending);
  await detail.goto();
  await detail.landmark();
  await detail.expectPendingEmptyState();
});

// Row actions run in place. The roster row is a <Link>, and a menu-item click bubbles up the
// REACT tree (Radix portals the menu content in the DOM, but synthetic events still propagate
// to React ancestors) — which used to trigger the row's navigation to the member page instead
// of running the action. These guard that Rotate and Revoke fire without leaving the roster.
// Rotate re-mints the pending member's invite in the shared local KV — deleting every invite
// resolving to `pat`, including the app suite's `PW-APP-INVITE-2` login fixture (seed.mjs). The
// app suite re-seeds `kvEntries()` at its own startup, so don't assert a specific `pat` invite
// code after this test; the observable here is the freshly-minted banner, not the code itself.
test("rotate runs from the row menu without navigating away", async ({ membersPage, page }) => {
  await membersPage.goto();
  await membersPage.openRowMenu(SEED.members.pending);
  // The open menu must not lock the page — a modal Radix menu sets `pointer-events: none` on
  // <body> the instant it opens (the bug that left the whole admin page click-dead). Deterministic,
  // so it reddens on a modal menu regardless of close-cleanup timing.
  await membersPage.expectNotPointerLocked();
  await membersPage.menuItem("Rotate invite").click();
  await expect(membersPage.mintedBanner).toContainText("Invite minted");
  await expect(membersPage.mintedBanner).toContainText(`@${SEED.members.pending}`);
  await expect(page).toHaveURL(/\/admin\/members$/);
  await membersPage.captureForReview("members-rotate");
  // And a body-level click still lands after the flow (end-to-end interactivity).
  await membersPage.bannerDismiss.click();
  await expect(membersPage.mintedBanner).toBeHidden();
});

test("revoke opens its confirm dialog from the row menu without navigating away", async ({ membersPage, page }) => {
  await membersPage.goto();
  await membersPage.openRowMenu(SEED.members.pending);
  await membersPage.expectNotPointerLocked(); // the non-modal menu doesn't lock the page
  await membersPage.menuItem("Revoke invite").click(); // pending member → "Revoke invite"
  await expect(membersPage.revokeDialog()).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/members$/);
  await membersPage.captureForReview("members-revoke");
  // Closing the confirm dialog must leave the page interactive — the dropdown→AlertDialog handoff
  // is where overlapping-layer pointer-events leaks historically surface. (Cancel, not confirm, so
  // the destructive revoke never runs against the shared seed.)
  await membersPage.revokeDialog().getByRole("button", { name: "Cancel" }).click();
  await expect(membersPage.revokeDialog()).toBeHidden();
  await membersPage.expectNotPointerLocked();
});
