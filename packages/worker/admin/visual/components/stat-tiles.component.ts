// The stat-card grid (src/admin/ui/kit.tsx StatCardGrid/StatCard) used by Status, Members,
// Discovery, and Normalize headers. One component object owns the `.stat-grid` / `.stat-card`
// markup so a kit change lands here, not in every page object.
import { expect, type Locator, type Page } from "@playwright/test";

export class StatTilesComponent {
  constructor(private readonly page: Page) {}

  get grid(): Locator {
    return this.page.locator(".stat-grid").first();
  }

  /** The tile whose label text matches (a stat-card contains its label + count). */
  tile(label: string): Locator {
    return this.page.locator(".stat-card", { hasText: label }).first();
  }

  async expectTile(label: string): Promise<void> {
    await expect(this.tile(label)).toBeVisible();
  }
}
