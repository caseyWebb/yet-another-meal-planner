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

  // --- The identity-audit convergence row + the recipe-backfill gauge
  // (admin-audit-observability): a self-terminating backlog, so the row carries a burndown
  // and NEVER an uptime% (assert its absence — the design's one negative guarantee).

  /** The one identity-audit sibling row: name link, backlog burndown, no uptime%. */
  async expectAuditRow(): Promise<void> {
    const row = this.page.locator(".au-job");
    await expect(row).toBeVisible();
    await expect(row.locator(".rk-job-name", { hasText: "identity-audit" })).toBeVisible();
    await expect(row.getByText("Backlog burndown")).toBeVisible();
    await expect(row.getByText(/% uptime/)).toHaveCount(0);
  }

  /** Expand the audit row's per-pass disclosure and assert the three passes' counts render. */
  async expandAuditPasses(): Promise<void> {
    await this.page.locator(".au-job-passes > summary").click();
    for (const pass of ["alias audit", "edge audit", "sku-cache re-key"]) {
      await expect(this.page.locator(".au-job-passes .jstat-k", { hasText: pass })).toBeVisible();
    }
  }

  /** The recipe-index row's inline backfill gauge (unresolved burndown + calm degraded chip). */
  async expectRecipeBackfillGauge(): Promise<void> {
    await expect(this.page.getByText("Recipe backfill")).toBeVisible();
    await expect(this.page.getByText(/unresolved · \d+% resolved/)).toBeVisible();
    await expect(this.page.locator(".bf-degraded")).toBeVisible();
  }
}
