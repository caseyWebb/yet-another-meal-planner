// Config (/admin/config) — the consolidated knob consoles + editors, a pill sub-nav over four
// routed groups: Discovery (default), Ingest Keys, Kroger Flyer, Ranking. (The old Aliases
// group redirects to Normalize › Aliases.) No fixtures: the consoles render the default merged
// knob values without any seeded row.
import { expect, type Locator } from "@playwright/test";
import { AdminPage } from "./base.page";
import { DialogComponent } from "../components/dialog.component";

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
    // The island renders two <dialog class="dialog"> (Mint + Revoke) — scope to the mint one by
    // its labelled title so the open-state assertion is unambiguous.
    return new DialogComponent(this.page.locator('dialog.dialog[aria-labelledby="mint-key-title"]'));
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
}
