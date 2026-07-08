// Meal plan (member-app-core 7.6): scheduled/unscheduled groups, the set-op edits —
// date set/CLEAR, side add/REMOVE — row removal, and the add-recipe combobox.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class PlanPage extends AppPage {
  readonly path = "/plan";
  readonly area = "plan";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("plan-page")).toBeVisible();
  }

  row(recipe: string): Locator {
    return this.page.locator(`[data-testid="plan-row"][data-recipe="${recipe}"]`);
  }

  /** Make sure the recipe is planned (add it through the combobox when absent). */
  async ensureRow(recipe: string, title: string): Promise<void> {
    const row = this.row(recipe);
    // Gate on the plan query being LOADED before deciding whether to add. The plan-page
    // landmark renders during the loading state too, so reading row.count() early races the
    // plan query: it can report 0 (still loading), commit us to clicking a combobox option,
    // then resolve with the recipe already planned — which filters that option out from under
    // the click ("element was detached from the DOM", the 30s timeout). Once the query has
    // loaded the page shows either at least one plan row or the empty state.
    await this.page.locator('[data-testid="plan-row"], .empty').first().waitFor();
    if ((await row.count()) > 0) return; // already planned — nothing to add
    // Plan is loaded and this recipe isn't in it, so its option is stable (the plan query
    // won't drop it mid-click).
    const input = this.page.locator(".plan-add-inline").getByRole("combobox");
    await input.fill(title);
    await this.page.locator(".cb-option", { hasText: title }).first().click();
    await row.waitFor();
  }

  async setDate(recipe: string, isoDay: string): Promise<void> {
    await this.row(recipe).getByTestId("plan-date").fill(isoDay);
  }

  async addSide(recipe: string, side: string): Promise<void> {
    await this.row(recipe).getByTestId("side-add").click();
    const input = this.row(recipe).getByRole("combobox");
    await input.fill(side);
    await input.press("Enter");
  }

  async removeSide(recipe: string, side: string): Promise<void> {
    await this.row(recipe).getByLabel(`Remove side ${side}`).click();
  }

  async expectSides(recipe: string, sides: string[]): Promise<void> {
    await expect(this.row(recipe).getByTestId("side-chip")).toHaveCount(sides.length);
    for (const s of sides) await expect(this.row(recipe).getByTestId("side-chip").filter({ hasText: s })).toBeVisible();
  }

  async clearDate(recipe: string): Promise<void> {
    await this.row(recipe).getByTestId("plan-date").fill("");
  }

  async expectDate(recipe: string, value: string): Promise<void> {
    await expect(this.row(recipe).getByTestId("plan-date")).toHaveValue(value);
  }

  /** The row's group — Scheduled vs Unscheduled. */
  async expectInGroup(recipe: string, group: "scheduled" | "unscheduled"): Promise<void> {
    await expect(
      this.page.getByTestId(`plan-${group}`).locator(`[data-testid="plan-row"][data-recipe="${recipe}"]`),
    ).toBeVisible();
  }

  async removeRow(recipe: string): Promise<void> {
    await this.row(recipe).getByTestId("plan-remove").click();
  }

  async expectEmpty(): Promise<void> {
    await expect(this.page.locator(".empty")).toContainText("Nothing planned");
  }
}
