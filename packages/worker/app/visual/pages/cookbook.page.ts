// Cookbook browse + search (member-app-core 7.3 + member-app-differentiators D7-D9):
// the landing page — the "New & trending" and "Picked for you" slots, the third
// all-recipes section, the debounced keyword searchbar, and the shared recipe rows
// (plan-toggle + favorite actions). Also owns the API-level cooking-log provisioning
// the trending empty-state spec uses (delete own rows → below the guard → restore).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class CookbookPage extends AppPage {
  readonly path = "/";
  readonly area = "cookbook";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("cookbook-page")).toBeVisible();
    await expect(this.page.getByLabel("Search recipes")).toBeVisible();
  }

  row(slug: string): Locator {
    return this.page.locator(`[data-testid="recipe-row"][data-slug="${slug}"]`).first();
  }

  // --- the browse slots (member-app-differentiators D9) ---------------------------

  newTrendingSection(): Locator {
    return this.page.getByTestId("new-trending");
  }

  pickedSection(): Locator {
    return this.page.getByTestId("picked-for-you");
  }

  allRecipesSection(): Locator {
    return this.page.getByTestId("all-recipes");
  }

  /** A recipe row inside slot 1 (New & trending). */
  newTrendingRow(slug: string): Locator {
    return this.newTrendingSection().locator(`[data-testid="recipe-row"][data-slug="${slug}"]`);
  }

  /** The honest group-counts chip on a trending backfill row. */
  trendingChip(slug: string): Locator {
    return this.newTrendingRow(slug).getByTestId("trending-chip");
  }

  /** Every trending chip on the page (the empty-state's no-fake-badge assertion). */
  anyTrendingChips(): Locator {
    return this.page.getByTestId("trending-chip");
  }

  /** A recipe row inside slot 2 (Picked for you). */
  pickedRow(slug: string): Locator {
    return this.pickedSection().locator(`[data-testid="recipe-row"][data-slug="${slug}"]`);
  }

  // --- cooking-log provisioning (through the browser's session fetch) --------------

  /** The caller's own cooking-log entries (id + fields), via the real API. */
  async ownLogEntries(): Promise<{ id: number; date: string; type: string; recipe: string | null }[]> {
    return this.page.evaluate(async () => {
      const res = await fetch("/api/log");
      const { entries } = (await res.json()) as {
        entries: { id: number; date: string; type: string; recipe: string | null }[];
      };
      return entries;
    });
  }

  /** Delete the caller's own type='recipe' log rows (the trending empty-state input). */
  async deleteOwnRecipeCooks(): Promise<{ date: string; recipe: string }[]> {
    const entries = await this.ownLogEntries();
    const removed: { date: string; recipe: string }[] = [];
    for (const e of entries) {
      if (e.type !== "recipe" || !e.recipe) continue;
      removed.push({ date: e.date, recipe: e.recipe });
      await this.page.evaluate(async (id: number) => {
        await fetch(`/api/log/${id}`, { method: "DELETE", headers: { "X-App-Csrf": "1" } });
      }, e.id);
    }
    return removed;
  }

  /** Restore cook rows through the real log write (dedupe-keyed on date+type+recipe). */
  async logCooks(rows: { date: string; recipe: string }[]): Promise<void> {
    for (const r of rows) {
      await this.page.evaluate(async (row: { date: string; recipe: string }) => {
        await fetch("/api/log", {
          method: "POST",
          headers: { "content-type": "application/json", "X-App-Csrf": "1" },
          body: JSON.stringify({ type: "recipe", date: row.date, recipe: row.recipe }),
        });
      }, r);
    }
  }

  async search(q: string): Promise<void> {
    await this.page.getByLabel("Search recipes").fill(q);
  }

  async expectResultCount(n: number): Promise<void> {
    await expect(this.page.getByTestId("search-results").getByTestId("recipe-row")).toHaveCount(n);
  }

  async expectNoMatches(): Promise<void> {
    await expect(this.page.getByTestId("search-results")).toContainText("No matches");
  }

  async openRecipe(slug: string): Promise<void> {
    await this.row(slug).locator(".rrow-link").click();
  }

  async favorite(slug: string): Promise<void> {
    await this.row(slug).getByTestId("row-fav").click();
  }

  async expectFavorited(slug: string, on: boolean): Promise<void> {
    await expect(this.row(slug).getByTestId("row-fav")).toHaveAttribute("aria-pressed", String(on));
  }

  /** Drive the favorite to an explicit target state regardless of the seed's. Waits
   *  for the PUT to land (the row flips optimistically) so back-to-back ensures can
   *  never race their writes past each other. */
  async ensureFavorite(slug: string, target: boolean): Promise<void> {
    const btn = this.row(slug).getByTestId("row-fav");
    await btn.waitFor();
    if ((await btn.getAttribute("aria-pressed")) !== String(target)) {
      const done = this.page.waitForResponse(
        (r) => r.url().includes("/api/overlay/favorite") && r.request().method() === "PUT",
      );
      await btn.click();
      await done;
    }
    await this.expectFavorited(slug, target);
  }
}
