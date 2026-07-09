// Usage (/admin/usage) — the observability dashboards. Every reader requires Cloudflare
// Analytics creds (CF_ACCOUNT_ID / CF_ANALYTICS_TOKEN); locally they return
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

  /** The three original dashboard sections render (their group labels are unconditional). */
  async expectSections(): Promise<void> {
    for (const label of ["Account resources", "Per-job runs", "Tool usage"]) {
      await expect(this.page.locator("p.group-label", { hasText: label })).toBeVisible();
    }
  }

  /** The AI-usage attribution panel renders — keyed on its always-present group label (the panel
   *  itself renders its not-configured state in the seeded local env, so this is time-/data-free). */
  async expectNeuronsByActivity(): Promise<void> {
    await expect(this.page.locator("p.group-label", { hasText: "Neurons by activity" })).toBeVisible();
  }
}
