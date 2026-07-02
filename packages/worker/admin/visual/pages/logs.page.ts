// Logs (/admin/logs) — the all-cron-jobs run log (query-param job filter + pagination, inline
// native-disclosure expand; no sidebar). Fixtures: the SEED.jobs job_runs history — the same
// rows that draw the Status sparklines populate this log — see seed.mjs.
import { expect } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";
import { TableComponent } from "../components/table.component";

export class LogsPage extends AdminPage {
  readonly path = "/admin/logs";
  readonly area = "logs";

  /** The run log (a `details.log-entry` list — row lookup owned by the table component). */
  get log(): TableComponent {
    return new TableComponent(this.page.locator(".log-list"));
  }

  async landmark(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Logs" })).toBeVisible();
  }

  /** At least one seeded run entry renders (the first seeded job's name appears in the log). */
  async expectSeededRun(): Promise<void> {
    await this.log.expectRow(SEED.jobs[0]!);
  }
}
