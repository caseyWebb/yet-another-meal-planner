// The Status area's background-job rows. Deliberately loose about row markup (the fidelity
// passes restyle it): a job "renders" when its registered name is visible on the page. Keep any
// tighter row assertions here, not in specs, so a markup change lands in one file.
import { expect, type Page } from "@playwright/test";

export class JobCardComponent {
  constructor(private readonly page: Page) {}

  async expectJob(name: string): Promise<void> {
    await expect(this.page.getByText(name, { exact: true }).first()).toBeVisible();
  }
}
