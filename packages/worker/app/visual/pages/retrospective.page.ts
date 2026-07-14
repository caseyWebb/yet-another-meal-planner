// Retrospective (member-app-core, retrospective-shell): the renamed cooking-log destination,
// now a tabbed shell whose default Cooking log tab carries the meal-aware composer (meal +
// source segments, backdating) and a day-grouped, meal-tagged list. The page object owns the
// tab switches, shared analyzer ranges, Spend/Waste semantics and review captures, and
// composer flow so specs never address production markup directly.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class RetrospectivePage extends AppPage {
  readonly path = "/retrospective";
  readonly area = "retrospective";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("retro-page")).toBeVisible();
  }

  rows(): Locator {
    return this.page.getByTestId("log-row");
  }

  /** A tab button (`log | spend | waste`). */
  tab(key: "log" | "spend" | "waste"): Locator {
    return this.page.getByTestId(`retro-tab-${key}`);
  }

  async selectTab(key: "log" | "spend" | "waste"): Promise<void> {
    await this.tab(key).click();
  }

  panel(key: "log" | "spend" | "waste"): Locator {
    return this.page.locator(`#retro-panel-${key}`);
  }

  analyzerRangeGroup(): Locator {
    return this.page.getByRole("group", { name: "Analysis range" });
  }

  analyzerRange(range: "4w" | "8w" | "12w"): Locator {
    return this.analyzerRangeGroup().getByRole("button", {
      name: `${range.slice(0, -1)} weeks`,
      exact: true,
    });
  }

  spendRange(range: "4w" | "8w" | "12w"): Locator {
    return this.analyzerRange(range);
  }

  wasteRange(range: "4w" | "8w" | "12w"): Locator {
    return this.analyzerRange(range);
  }

  async selectAnalyzerRange(range: "4w" | "8w" | "12w"): Promise<void> {
    await this.analyzerRange(range).click();
  }

  async selectSpendRange(range: "4w" | "8w" | "12w"): Promise<void> {
    await this.selectAnalyzerRange(range);
  }

  async selectWasteRange(range: "4w" | "8w" | "12w"): Promise<void> {
    await this.selectAnalyzerRange(range);
  }

  spendKpi(key: "total" | "average" | "meal" | "trend"): Locator {
    return this.page.getByTestId(`spend-kpi-${key}`);
  }

  spendWeeks(): Locator {
    return this.page.getByTestId("spend-week");
  }

  spendAwaiting(): Locator {
    return this.page.getByTestId("spend-awaiting");
  }

  spendInsight(): Locator {
    return this.page.getByTestId("spend-insight");
  }

  spendState(state: "empty" | "unavailable" | "partial" | "complete"): Locator {
    return this.page.getByTestId(`spend-state-${state}`);
  }

  spendLoading(): Locator {
    return this.page.getByTestId("spend-loading");
  }

  spendError(): Locator {
    return this.page.getByTestId("spend-error");
  }

  async retrySpend(): Promise<void> {
    await this.page.getByRole("button", { name: "Retry spend analysis" }).click();
  }

  wastePanel(): Locator {
    return this.page.getByTestId("waste-page");
  }

  wasteHeading(): Locator {
    return this.wastePanel().getByRole("heading", { name: "Household waste" });
  }

  wasteKpi(key: "tossed" | "items" | "rate" | "trend"): Locator {
    return this.page.getByTestId(`waste-kpi-${key}`);
  }

  wasteWeeks(): Locator {
    return this.page.getByTestId("waste-week");
  }

  wasteWeeksRegion(): Locator {
    return this.page.getByRole("region", { name: "Weekly waste chart" });
  }

  wasteBarGeometry(): Locator {
    return this.wasteWeeks().locator(".waste-bar-wrap");
  }

  wasteBreakdown(key: "department" | "reason" | "avoidability"): Locator {
    return this.page.getByTestId(`waste-breakdown-${key}`);
  }

  wasteItems(): Locator {
    return this.page.getByTestId("waste-most-wasted");
  }

  wasteInsight(): Locator {
    return this.page.getByTestId("waste-insight");
  }

  wasteDepartmentCoverage(): Locator {
    return this.page.getByTestId("waste-department-coverage");
  }

  wasteState(state: "empty" | "unavailable" | "partial" | "complete"): Locator {
    return this.page.getByTestId(`waste-state-${state}`);
  }

  wasteLoading(): Locator {
    return this.page.getByTestId("waste-loading");
  }

  wasteError(): Locator {
    return this.page.getByTestId("waste-error");
  }

  async retryWaste(): Promise<void> {
    await this.page.getByRole("button", { name: "Retry waste analysis" }).click();
  }

  async pressTabKey(key: "ArrowLeft" | "ArrowRight" | "Home" | "End"): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async captureSpendDesktop(): Promise<void> {
    await this.setViewport(1100, 900);
    await this.captureForReview("retro-spend-desktop");
  }

  async captureSpendTall(): Promise<void> {
    await this.setViewport(760, 1100);
    await this.captureForReview("retro-spend-tall");
  }

  async captureSpendNarrow(): Promise<void> {
    await this.setViewport(390, 844);
    await this.captureForReview("retro-spend-narrow");
  }

  async captureWasteDesktop(): Promise<void> {
    await this.setViewport(1100, 900);
    await this.captureForReview("retro-waste-desktop");
  }

  async captureWasteTall(): Promise<void> {
    await this.setViewport(760, 1100);
    await this.captureForReview("retro-waste-tall");
  }

  async captureWasteNarrow(): Promise<void> {
    await this.setViewport(390, 844);
    await this.captureForReview("retro-waste-narrow");
  }

  /** The day-section relative headers ("Today", "Yesterday", "Wed Jul 8"). */
  dayHeads(): Locator {
    return this.page.locator(".log-day-rel");
  }

  /** A row's meal tag text (uppercased via CSS; the raw value is the meal key). */
  mealTag(row: Locator): Locator {
    return row.locator(".log-meal");
  }

  /** Pick the composer's meal segment (Breakfast/Lunch/Dinner). */
  async pickMeal(label: "Breakfast" | "Lunch" | "Dinner"): Promise<void> {
    await this.page.locator('.seg[data-seg="meal"] button', { hasText: label }).click();
  }

  /** Log a recipe cook (the default "From cookbook" source). */
  async logCook(title: string): Promise<void> {
    await this.page.getByLabel("Recipe cooked").selectOption({ label: title });
    await this.page.getByRole("button", { name: "Log it" }).click();
  }

  /** Log a non-recipe "Something else" (ad_hoc) entry by free-text name. */
  async logSomethingElse(name: string): Promise<void> {
    await this.page.locator('.seg[data-seg="source"] button', { hasText: "Something else" }).click();
    await this.page.getByLabel("What you ate").fill(name);
    await this.page.getByRole("button", { name: "Log it" }).click();
  }

  /** Backdate the composer's date field (ISO yyyy-mm-dd). */
  async setDate(iso: string): Promise<void> {
    await this.page.getByLabel("Date cooked").fill(iso);
  }

  async removeFirst(): Promise<void> {
    await this.rows().first().getByTestId("log-remove").click();
  }
}
