// Config (/admin/config) — the consolidated knob consoles + editors, a pill sub-nav over five
// routed groups: Discovery (default), Ingest Keys, Kroger Flyer, Ranking, Deployment. (The old
// Aliases group redirects to Normalize › Aliases.) No fixtures: the consoles render the default
// merged knob values without any seeded row, and the Deployment card renders the never-written
// profile default (the seed resets the two sparse operator_config columns).
import { expect, type Locator } from "@playwright/test";
import { AdminPage } from "./base.page";
import { DialogComponent } from "../components/dialog.component";

/** Mirrors operator-config.ts's DEFAULT_CURATED_SOURCE_URL — the compiled default the
 *  Deployment card renders as "not yet overridden". */
export const CURATED_SOURCE_DEFAULT =
  "https://raw.githubusercontent.com/caseyWebb/yet-another-meal-planner-deployment/main/curated-feed.xml";

export class ConfigPage extends AdminPage {
  readonly path = "/admin/config";
  readonly area = "config";

  async landmark(): Promise<void> {
    await expect(this.page.locator("h3.cfg-section-title", { hasText: "Calibration" })).toBeVisible();
  }

  async gotoIngestKeys(): Promise<void> {
    await this.goto("/admin/config/ingest-keys");
    await expect(this.page.locator("h3.cfg-section-title", { hasText: "Ingest keys" })).toBeVisible();
  }

  /** A key's roster row, located by its satellite label (the hydrated Ingest Keys island). */
  ingestKeyRow(label: string): Locator {
    return this.page.locator("tr", { hasText: label });
  }

  /** Assert a key's row shows the given tenant BINDING text ("operator-global" or a member id). */
  async expectIngestKeyBinding(label: string, binding: string): Promise<void> {
    await expect(this.ingestKeyRow(label)).toContainText(binding);
  }

  get mintKeyButton(): Locator {
    return this.page.getByRole("button", { name: "Mint key" }).first();
  }

  ingestKeyMintDialog(): DialogComponent {
    // The screen renders two Radix dialogs (Mint + Revoke) — scope to the mint one by its
    // accessible name so the open-state assertion is unambiguous.
    return new DialogComponent(this.page.getByRole("dialog", { name: "Mint ingest key" }));
  }

  /** Open the mint dialog (hydration-safe retry lives in the dialog component). */
  async openMintKeyDialog(): Promise<DialogComponent> {
    const dialog = this.ingestKeyMintDialog();
    await dialog.openVia(this.mintKeyButton);
    return dialog;
  }

  /** The mint dialog's tenant-binding <select> (default operator-global; options = allowlist). */
  get tenantBindingSelect(): Locator {
    return this.page.locator("#mint-key-tenant");
  }

  async gotoFlyer(): Promise<void> {
    await this.goto("/admin/config/flyer");
    await expect(this.page.locator("h3.cfg-section-title", { hasText: "Flyer behaviour" })).toBeVisible();
  }

  async gotoRanking(): Promise<void> {
    await this.goto("/admin/config/ranking");
    await expect(this.page.locator("h3.cfg-section-title", { hasText: "Ranking weights" })).toBeVisible();
  }

  // --- The Deployment group (deployment-profiles-and-visibility-lens) -----------------------

  async gotoDeployment(): Promise<void> {
    await this.goto("/admin/config/deployment");
    await expect(this.page.locator("h3.cfg-section-title", { hasText: "Deployment" })).toBeVisible();
  }

  /** The profile line on the Deployment card: the resolved-profile badge + the default hint. */
  get deploymentProfile(): Locator {
    return this.page.locator(".deploy-profile");
  }

  /** Assert the resolved profile, and (when given) whether the "(default)" hint shows. */
  async expectDeploymentProfile(profile: "self-hosted" | "saas", opts: { isDefault?: boolean } = {}): Promise<void> {
    await expect(this.deploymentProfile).toContainText(profile);
    if (opts.isDefault !== undefined) {
      const hint = this.deploymentProfile.locator(".deploy-default-hint");
      if (opts.isDefault) await expect(hint).toBeVisible();
      else await expect(hint).toHaveCount(0);
    }
  }

  /** The flip control (the button names its target profile). */
  switchProfileButton(target: "SaaS" | "self-hosted"): Locator {
    return this.page.getByRole("button", { name: `Switch to ${target}`, exact: true });
  }

  /** The self-hosted → SaaS confirmation (the shared Radix AlertDialog). */
  saasConfirmDialog(): Locator {
    return this.page.getByRole("alertdialog", { name: "Switch to the SaaS profile" });
  }

  /** The consent-inversion refusal rendered on the card after a refused SaaS → self-hosted flip. */
  get deploymentRefusal(): Locator {
    return this.page.locator(".deploy-refusal");
  }

  /** The curated-source control block on the Deployment card. */
  get curatedSource(): Locator {
    return this.page.locator(".deploy-curated");
  }

  get curatedUrlInput(): Locator {
    return this.page.locator("#curated-source-url");
  }

  /** A curated-source action button ("Edit URL" / "Save URL" / "Disable" / "Reset to default"). */
  curatedButton(name: string): Locator {
    return this.curatedSource.getByRole("button", { name, exact: true });
  }

  /** The default state: the compiled default URL shown as not-yet-overridden. */
  async expectCuratedDefault(): Promise<void> {
    await expect(this.curatedSource).toContainText(CURATED_SOURCE_DEFAULT);
    await expect(this.curatedSource).toContainText("not yet overridden");
  }

  async expectCuratedCustom(url: string): Promise<void> {
    await expect(this.curatedSource).toContainText(url);
    await expect(this.curatedSource).toContainText("overriding the compiled default");
  }

  async expectCuratedDisabled(): Promise<void> {
    await expect(this.curatedSource).toContainText("Curated intake is disabled");
  }
}
