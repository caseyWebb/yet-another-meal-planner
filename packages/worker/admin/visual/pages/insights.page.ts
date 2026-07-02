// Insights (/admin/insights) — the group-popularity dashboard (SSR first paint, hydrated island).
// Fixtures: SEED.recipe + type='recipe' cooking_log rows within the last week + a favorite
// overlay row, so the leaderboard, cook-activity counts, and heatmap render populated — see
// seed.mjs.
import { expect } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";

export class InsightsPage extends AdminPage {
  readonly path = "/admin/insights";
  readonly area = "insights";

  async landmark(): Promise<void> {
    await expect(this.page.locator("p.group-label", { hasText: "Cooking activity" })).toBeVisible();
  }

  /** The seeded recipe made the popularity board. */
  async expectSeededRecipeOnBoard(): Promise<void> {
    await expect(this.page.getByText(SEED.recipe.title).first()).toBeVisible();
  }
}
