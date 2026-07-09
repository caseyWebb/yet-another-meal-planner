// Self-service signup (self-service-signup): redeem a group invite code under a chosen username
// → a new tenant + session → the first-run passkey enrollment nudge. The success path uses a
// per-run-unique username (so it never collides across retries/reruns as the shared seed's open
// code climbs), driven over `localhost` for the WebAuthn RP ID (as passkey.spec.ts). The
// taken-username and unusable-code cases create nothing, so they run on the plain baseURL.
import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { SEED } from "../../../admin/visual/seed.mjs";

/** A discoverable virtual authenticator so startRegistration resolves without a real device. */
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

/** The harness serves on 127.0.0.1; rewrite to localhost for the WebAuthn RP ID. */
function localOrigin(baseURL: string | undefined): string {
  return (baseURL ?? "http://127.0.0.1:8788").replace("127.0.0.1", "localhost");
}

test("a taken username is surfaced inline, creating nothing", async ({ signupPage }) => {
  await signupPage.goto();
  await signupPage.landmark();
  // `casey` is an already-onboarded member — the KV allowlist pre-check rejects it.
  await signupPage.signup(SEED.members.active, SEED.groupCode.open);
  await expect(signupPage.usernameError()).toContainText("taken");
  await signupPage.captureForReview("signup-username-taken");
});

test("an unusable invite code fails uniformly", async ({ signupPage }) => {
  await signupPage.goto();
  await signupPage.landmark();
  await signupPage.signup(`visitor${Date.now()}`, "not-a-real-code");
  await expect(signupPage.formError()).toContainText("didn't work");
});

test("signs up with a group code and is prompted to enroll a passkey", async ({
  page,
  context,
  baseURL,
  signupPage,
  shellPage,
}) => {
  await addVirtualAuthenticator(context, page);
  const username = `visitor${Date.now()}`;

  await page.goto(`${localOrigin(baseURL)}/signup`);
  await signupPage.landmark();
  await signupPage.signup(username, SEED.groupCode.open);
  await expect(signupPage.enrollPrompt()).toBeVisible();
  await signupPage.captureForReview("signup-enroll");

  // Enroll against the just-minted session → land in the app as the new member.
  await signupPage.addPasskey();
  await shellPage.landmark();
  await shellPage.expectSignedInAs(username);
});
