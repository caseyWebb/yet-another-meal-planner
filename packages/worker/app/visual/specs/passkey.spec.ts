// Passkey enrollment + usernameless login (webauthn-passkey-auth 10.4), driven through
// Chromium's CDP virtual authenticator so the WebAuthn ceremonies complete without a real
// device. The RP ID is the request host EXACTLY (src/webauthn.ts rpFromRequest), so these
// specs drive the app over `localhost` — Chrome accepts `localhost` as an RP ID where a bare
// IP is rejected. The seeded D1/KV and the __Host- session cookie are host-agnostic, so the
// switch from the harness's 127.0.0.1 baseURL to localhost is transparent to the server.
import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { SEED } from "../../../admin/visual/seed.mjs";

/** A discoverable platform virtual authenticator that auto-satisfies user presence +
 *  verification (no interaction) so startRegistration/startAuthentication resolve. Each call
 *  adds a fresh authenticator (a distinct "device"). */
async function addVirtualAuthenticator(context: BrowserContext, page: Page): Promise<void> {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** The harness serves on 127.0.0.1; rewrite to localhost for the WebAuthn RP ID (see header). */
function localOrigin(baseURL: string | undefined): string {
  return (baseURL ?? "http://127.0.0.1:8788").replace("127.0.0.1", "localhost");
}

test("bootstrap login → enroll a passkey → logout → sign in with the passkey", async ({
  page,
  context,
  baseURL,
  loginPage,
  shellPage,
}) => {
  await addVirtualAuthenticator(context, page);

  // Bootstrap with the invite code → the first-run enrollment nudge (not straight into the app).
  await page.goto(`${localOrigin(baseURL)}/login`);
  await loginPage.landmark();
  await loginPage.login(SEED.invite);
  await expect(loginPage.enrollPrompt()).toBeVisible();

  // Enroll a passkey against the just-minted session (this consumes the bootstrap code
  // server-side) → land in the app.
  await loginPage.addPasskey();
  await shellPage.landmark();
  await shellPage.expectSignedInAs(SEED.members.active);

  // Sign out, then sign back in with the passkey ALONE — no invite code typed.
  await shellPage.logout();
  await loginPage.landmark();
  await loginPage.signInWithPasskey();
  await shellPage.landmark();
  await shellPage.expectSignedInAs(SEED.members.active);
});

test("the account menu's Add a device enrolls a passkey from an authenticated session", async ({
  page,
  context,
  baseURL,
  loginPage,
  shellPage,
}) => {
  await addVirtualAuthenticator(context, page);

  // A different member (pat, via the second seeded invite) so this test's enrollment consumes
  // its own bootstrap code — independent of the round-trip test's (casey).
  await page.goto(`${localOrigin(baseURL)}/login`);
  await loginPage.login(SEED.inviteAlt);
  await expect(loginPage.enrollPrompt()).toBeVisible();
  await loginPage.skipEnroll(); // decline the first-run nudge — enroll from the menu instead
  await shellPage.landmark();
  await shellPage.expectSignedInAs(SEED.members.pending);

  // Self-service add: the same enroll ceremony from the account menu (pat's first credential,
  // so no excludeCredentials conflict on the single authenticator). The toast is the feedback.
  await shellPage.addDevice();
  await expect(page.getByText("Passkey added")).toBeVisible();
});
