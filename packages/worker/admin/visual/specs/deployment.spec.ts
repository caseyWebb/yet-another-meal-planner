// Config › Deployment (deployment-profiles-and-visibility-lens): the profile card renders
// the never-written default (self-hosted + the compiled curated URL); the self-hosted → SaaS
// flip goes through the Worker's REAL structured needs-confirm round trip (first PUT without
// confirm → dialog → confirming re-submits with confirm:true); the curated-source knob
// round-trips edit → clear-to-disable → reset-to-default through the real PUT. The flip test
// restores self-hosted (the consent-inversion guard passes — the seed has no second household
// owning a cookbook), and the curated test ends back on the default, so later specs and the
// smoke screenshots see a converged card.
import { test, expect } from "../fixtures";

test("deployment card renders the unset self-hosted default", async ({ configPage }) => {
  await configPage.gotoDeployment();
  await configPage.expectDeploymentProfile("self-hosted", { isDefault: true });
  await configPage.expectCuratedDefault();
  await configPage.captureForReview("config-deployment-default");
});

test("flip to SaaS demands the confirm dialog; confirming lands; flip back restores self-hosted", async ({
  configPage,
}) => {
  await configPage.gotoDeployment();
  // The first submit goes WITHOUT confirm — the Worker's structured needsConfirm opens the dialog.
  await configPage.switchProfileButton("SaaS").click();
  const dialog = configPage.saasConfirmDialog();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Implicit all-to-all visibility ends immediately");
  await expect(dialog).toContainText("households stop seeing each other's recipes");
  await expect(dialog).toContainText("narrows to the curated tier");
  await configPage.captureForReview("config-deployment-confirm");
  // Confirming re-submits with confirm:true — the card shows the written profile.
  await dialog.getByRole("button", { name: "Switch to SaaS" }).click();
  await configPage.expectDeploymentProfile("saas", { isDefault: false });
  // Flip back (no confirm dialog this direction; the consent-inversion guard passes here) —
  // the card returns to self-hosted, now explicitly written, so the "(default)" hint is gone.
  await configPage.switchProfileButton("self-hosted").click();
  await configPage.expectDeploymentProfile("self-hosted", { isDefault: false });
});

test("curated source URL edit, clear-to-disable, and reset-to-default round-trip", async ({ configPage }) => {
  const custom = "https://example.com/pw-curated-feed.xml";
  await configPage.gotoDeployment();
  await configPage.curatedButton("Edit URL").click();
  await configPage.curatedUrlInput.fill(custom);
  await configPage.curatedButton("Save URL").click();
  await configPage.expectCuratedCustom(custom);
  await configPage.curatedButton("Disable").click();
  await configPage.expectCuratedDisabled();
  await configPage.captureForReview("config-deployment-curated-disabled");
  await configPage.curatedButton("Reset to default").click();
  await configPage.expectCuratedDefault();
});
