// The global service-health dock (src/admin/ui/health-dock.tsx), spliced before </body> on every
// HTML response by the injectHealthDock middleware — the panel's universal, time-free cross-page
// landmark. The component asserts presence, not the healthy/degraded word: the rollup depends on
// live gate posture, and the harness gates on structure, not health state.
import { expect, type Locator, type Page } from "@playwright/test";

export class HealthDockComponent {
  constructor(private readonly page: Page) {}

  get pill(): Locator {
    return this.page.locator("button.health-pill");
  }

  /** The dock rendered on this page (its aria-label always starts "Service health:"). */
  async expectPresent(): Promise<void> {
    await expect(this.pill).toBeVisible();
    const label = await this.pill.getAttribute("aria-label");
    expect(label).toMatch(/^Service health:/);
  }
}
