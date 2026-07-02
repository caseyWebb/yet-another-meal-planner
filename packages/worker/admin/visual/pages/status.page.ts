// Status (/admin) — the service-health home: gate posture, corpus stat tiles, the background-job
// rows (sparkline + since-label), and the reconcile status row.
// Fixtures: SEED.jobs rows in job_health + job_runs (rows for every registered job so no row
// renders never-run), plus `grocery-reconcile` job_runs for the reconcile row — see seed.mjs.
import { expect } from "@playwright/test";
import { AdminPage } from "./base.page";
import { StatTilesComponent } from "../components/stat-tiles.component";
import { JobCardComponent } from "../components/job-card.component";

export class StatusPage extends AdminPage {
  readonly path = "/admin";
  readonly area = "status";
  readonly tiles = new StatTilesComponent(this.page);
  readonly jobs = new JobCardComponent(this.page);

  async landmark(): Promise<void> {
    await expect(this.page.locator("p.group-label", { hasText: "Background jobs" })).toBeVisible();
  }

  /** The four corpus stat tiles (labels owned here, markup by the component). */
  async expectStatTiles(): Promise<void> {
    for (const label of ["Recipes", "Members", "RSS feeds", "Cached SKUs"]) {
      await this.tiles.expectTile(label);
    }
  }
}
