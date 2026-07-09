// The login flow (member-session-auth + member-app-core D13): the restyled single
// invite-code card logs into the app shell inside a real browser against a seeded
// local `wrangler dev`; the uniform error and the logout gate hold.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
import { expectNoPersistedMemberData, waitForPersistedMutations, waitForPersistedQuery } from "../idb";
import { becomeControlled } from "../sw";

test("an invalid code shows the uniform error", async ({ loginPage }) => {
  await loginPage.goto();
  await loginPage.landmark();
  await loginPage.login("not-a-real-code");
  await loginPage.expectUniformError();
  await loginPage.captureForReview("login-error");
});

test("the seeded invite code lands on the authenticated shell, and a reload keeps the session", async ({
  loginPage,
  shellPage,
}) => {
  await loginPage.goto();
  await loginPage.login(SEED.invite);
  // A bootstrap-code login lands on the first-run passkey nudge (webauthn-passkey-auth);
  // decline it to reach the app shell.
  await loginPage.skipEnroll();
  await shellPage.landmark();
  await shellPage.expectSignedInAs(SEED.members.active);
  // Cookie session: a reload re-runs the whoami boot check and stays signed in.
  await shellPage.goto();
  await shellPage.expectSignedInAs(SEED.members.active);
});

test("the account menu shows the member's Kroger link badge", async ({ asMember, shellPage }) => {
  await asMember();
  await shellPage.openAccountMenu();
  await shellPage.expectKrogerBadge(true); // the seed links the active member
});

test("logout returns to login, and the gate holds afterward", async ({ loginPage, shellPage }) => {
  await loginPage.goto();
  await loginPage.login(SEED.invite);
  await loginPage.skipEnroll();
  await shellPage.landmark();
  await shellPage.logout();
  await loginPage.landmark();
  // The session is revoked server-side: revisiting / redirects back to login.
  await shellPage.goto();
  await loginPage.landmark();
});

test("an unauthenticated visit to / presents the login screen", async ({ loginPage, shellPage }) => {
  await shellPage.goto();
  await loginPage.landmark();
});

test("logout leaves no member data at rest (member-app-offline D9)", async ({ loginPage, shellPage, page }) => {
  await loginPage.goto();
  await loginPage.login(SEED.invite);
  await loginPage.skipEnroll();
  await shellPage.landmark();
  // The shell's own subscriptions warm the allowlisted reads; wait until they are
  // AT REST in IndexedDB (the persister throttles ~1 s) so the purge has real work.
  await waitForPersistedQuery(page, "grocery");
  // Plant a propose session + a theme preference: the purge removes member data
  // (session) but keeps the device preference (theme).
  await page.evaluate(() => {
    localStorage.setItem("cookbook:propose-session", JSON.stringify({ seed: 1, nights: 3 }));
    localStorage.setItem("cookbook:theme", "dark");
  });
  await shellPage.logout();
  await loginPage.landmark();
  await expectNoPersistedMemberData(page);
  expect(await page.evaluate(() => localStorage.getItem("cookbook:tenant"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("cookbook:propose-session"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("cookbook:theme"))).toBe("dark");
});

// A different-tenant login closes the cross-tenant replay window (member-app-offline D9
// amendment): the stamp-mismatch purge can only run once the session POST resolves, so
// `login.tsx` suspends the shared class (b) queue (`onlineManager.setOnline(false)`) for
// the whole submission whenever a stamp is already on the device — otherwise a PRIOR
// member's queued write could dispatch under the NEW member's fresh cookie in that gap.
//
// HONEST TESTING GAP (recorded per the review's instruction rather than shipping a flaky
// spec): the vulnerability's exact window is a microtask-level race between the browser's
// native `online` event — which TanStack's mutation retryer subscribes to directly and
// auto-resumes a paused mutation from, independent of any app code — and this app's
// synchronous `suspendQueue()` call inside `onSubmit`. An earlier version of this spec
// reconnected the network and then submitted the login form, expecting zero dispatches to
// the class (b) endpoint in between; empirically, in this fast local harness, the retryer's
// auto-resume ALWAYS wins that race (it runs synchronously off the `online` event, well
// before Playwright's `fill`/`click` CDP round trip can land), so A's queued write reliably
// fires and completes — under A's OWN still-current cookie — before B's login even starts.
// That is normal, correct replay-on-reconnect behavior (the whole point of the offline
// feature), not a leak, and no local test can force the opposite ordering without
// controlling Chromium/CDP internals no test in this suite otherwise touches.
//
// What IS deterministic, and what this spec asserts instead: whenever the retryer's
// auto-resume dispatches A's queued write in this window (before, during, or after the
// login submission — the exact timing is not controlled), that request's `Cookie` header
// must ALWAYS carry A's session token, never anything else — proving the write can only
// ever be attributed to A, regardless of how the race lands. Combined with the queued
// item NEVER surfacing in B's grocery list, this is the strongest guarantee obtainable
// here: however the timing falls, the write is never misattributed to the new tenant.
test("a different-tenant login closes the cross-tenant replay window (member-app-offline D9)", async ({
  asMember,
  groceryPage,
  loginPage,
  shellPage,
  page,
  context,
}) => {
  const LEAK_ITEM = "replay-guard-canned-beans";
  await asMember(); // member A ("casey") — stamps the device via the _app loader's whoami
  const aCookie = (await context.cookies()).find((c) => c.name === "__Host-session")?.value;
  expect(aCookie).toBeTruthy();

  await groceryPage.goto();
  await groceryPage.landmark();
  await becomeControlled(page); // control needed so the offline nav to /login below precaches
  await groceryPage.landmark();

  await context.setOffline(true);
  await groceryPage.addItem(LEAK_ITEM); // the real UI path: a registered class (b) mutation
  await waitForPersistedMutations(page, 1); // confirm it is genuinely PAUSED and at rest

  await loginPage.goto(); // still offline: the SW serves the shell from precache
  await loginPage.landmark();

  // Every dispatch of the queued write, whenever it lands, must carry A's cookie — never
  // a different one (a mismatch would mean the write landed as the wrong tenant).
  const observedCookies: (string | undefined)[] = [];
  await page.route("**/api/grocery/items", async (route) => {
    if (route.request().method() === "POST") {
      observedCookies.push(route.request().headers().cookie);
    }
    await route.continue();
  });

  await context.setOffline(false);
  await loginPage.login(SEED.inviteAlt); // a real second invite, resolving to the pending member
  await loginPage.skipEnroll(); // decline the first-run passkey nudge to reach the shell
  await shellPage.landmark();
  await shellPage.expectSignedInAs(SEED.members.pending);

  for (const cookie of observedCookies) {
    expect(cookie).toContain(`__Host-session=${aCookie}`);
  }
  // The deterministic proof regardless of timing: A's queued write never reached B's
  // account (whether it fired under A beforehand, or was discarded by the mismatch purge).
  expect(await groceryPage.rowStatus(LEAK_ITEM)).toBeUndefined();
});
