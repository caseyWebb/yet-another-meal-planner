// The cross-device MCP approval screen (webauthn-passkey-auth 10.4 / 8.3). Claude.ai's
// /authorize deep-links the member to /connect?authz=<ref>; a passkey-authenticated member
// confirms the verification code and approves, binding their tenant to the reference so the
// /authorize poll can complete the grant. Fixtures seed two pending `authz:<ref>` records
// (SEED.connect.approveRef, viewRef) so the approve round-trip never disturbs the smoke
// screenshot's viewing ref. Approval only needs a session (invite login via asMember) — no
// WebAuthn here.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test("a signed-in member approves a pending cross-device connection", async ({
  asMember,
  connectPage,
}) => {
  await asMember();
  await connectPage.goto(); // /connect?authz=<approveRef>
  await connectPage.landmark();

  // The requesting client + the verification code the member matches against /authorize.
  await expect(connectPage.client()).toHaveText(SEED.connect.clientName);
  await expect(connectPage.code()).toContainText(SEED.connect.code);

  await connectPage.approve();
  await expect(connectPage.approved()).toBeVisible();
});

test("an unauthenticated /connect visit is parked at login, preserving the ref", async ({
  page,
  context,
  loginPage,
}) => {
  // This spec runs in the pre-authenticated `authed` project; drop the seeded session
  // cookie so the gate genuinely sees an unauthenticated visitor.
  await context.clearCookies();
  await page.goto(`/connect?authz=${SEED.connect.viewRef}`);
  await loginPage.landmark();
  // The return path round-trips (url-encoded) so the member lands back on the SAME pending
  // reference after signing in.
  const current = page.url();
  expect(current).toContain("/login");
  expect(current).toContain("redirect=");
  expect(current).toContain("connect");
  expect(current).toContain(SEED.connect.viewRef);
});

test("an expired or unknown reference reports itself as gone", async ({ asMember, page }) => {
  await asMember();
  await page.goto("/connect?authz=this-ref-does-not-exist");
  await expect(page.getByTestId("connect-gone")).toBeVisible();
});
