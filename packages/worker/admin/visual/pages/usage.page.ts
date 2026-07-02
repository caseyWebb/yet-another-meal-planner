// Usage (/admin/usage) — the three observability dashboards. All three readers require
// Cloudflare Analytics creds (CF_ACCOUNT_ID / CF_ANALYTICS_TOKEN); locally they return
// `{ configured: false }` without a network call, so the page deterministically renders its
// explicit not-configured states. No fixtures.
import { expect } from "@playwright/test";
import { AdminPage } from "./base.page";

export class UsagePage extends AdminPage {
  readonly path = "/admin/usage";
  readonly area = "usage";

  async landmark(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Usage" })).toBeVisible();
  }

  /** The three dashboard sections render (their group labels are unconditional). */
  async expectSections(): Promise<void> {
    for (const label of ["Account resources", "Per-job runs", "Tool usage"]) {
      await expect(this.page.locator("p.group-label", { hasText: label })).toBeVisible();
    }
  }
}
