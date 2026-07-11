// Retrospective (member-app-core, retrospective-shell): the renamed cooking-log destination,
// now a tabbed shell whose default Cooking log tab carries the meal-aware composer (meal +
// source segments, backdating) and a day-grouped, meal-tagged list. The page object owns the
// tab switches and the composer flow so specs never address the markup directly.
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
