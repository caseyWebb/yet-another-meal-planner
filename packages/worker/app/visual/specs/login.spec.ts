// The login flow (member-session-auth) — the P0 acceptance: the seeded invite code logs
// into the app at / inside a real browser against a seeded local `wrangler dev`.
import { test } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test("an invalid code shows the uniform error", async ({ loginPage }) => {
  await loginPage.goto();
  await loginPage.landmark();
  await loginPage.login("not-a-real-code");
  await loginPage.expectUniformError();
  await loginPage.captureForReview("login-error");
});

test("the seeded invite code lands on the authenticated shell, and a reload keeps the session", async ({
  loginPage,
  homePage,
}) => {
  await loginPage.goto();
  await loginPage.login(SEED.invite);
  await homePage.landmark();
  await homePage.expectSignedInAs(SEED.members.active);
  // Cookie session: a reload re-runs the whoami boot check and stays signed in.
  await homePage.goto();
  await homePage.expectSignedInAs(SEED.members.active);
});

test("logout returns to login, and the gate holds afterward", async ({ loginPage, homePage }) => {
  await loginPage.goto();
  await loginPage.login(SEED.invite);
  await homePage.landmark();
  await homePage.logout();
  await loginPage.landmark();
  // The session is revoked server-side: revisiting / redirects back to login.
  await homePage.goto();
  await loginPage.landmark();
});

test("an unauthenticated visit to / presents the login screen", async ({ loginPage, homePage }) => {
  await homePage.goto();
  await loginPage.landmark();
});
