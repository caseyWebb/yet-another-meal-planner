// Config (/admin/config) — the consolidated knob consoles + editors, a pill sub-nav over four
// routed groups: Discovery (default), Ingest Keys, Kroger Flyer, Ranking. (The old Aliases
// group redirects to Normalize › Aliases.) No fixtures: the consoles render the default merged
// knob values without any seeded row.
import { expect } from "@playwright/test";
import { AdminPage } from "./base.page";

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

  async gotoFlyer(): Promise<void> {
    await this.goto("/admin/config/flyer");
    await expect(this.page.locator("h3.cfg-section-title", { hasText: "Flyer behaviour" })).toBeVisible();
  }

  async gotoRanking(): Promise<void> {
    await this.goto("/admin/config/ranking");
    await expect(this.page.locator("h3.cfg-section-title", { hasText: "Ranking weights" })).toBeVisible();
  }
}
