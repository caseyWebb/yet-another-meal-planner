// Cookbook — the unified browse page (member-app-core "Cookbook browse and keyword
// search" + member-app-differentiators' promoted panel): the debounced keyword
// searchbar, the view-mode tab row (All recipes / Favorites — the favorites view's
// entry control, with its count pill), the global filter bar (cuisine/protein selects
// + time segments + Clear + "N of M match"), the promoted "Recommended for you" panel
// with its reason badges, and the flat organic list. Also owns the API-level
// cooking-log provisioning the sparse-trending spec uses (delete own rows → below the
// guard → restore).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class CookbookPage extends AppPage {
  readonly path = "/";
  readonly area = "cookbook";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("cookbook-page")).toBeVisible();
    await expect(this.page.getByLabel("Search recipes")).toBeVisible();
  }

  /** Load the page with explicit search params (the URL-state deep-link entrance). */
  async gotoWith(params: string): Promise<void> {
    await this.page.goto(params ? `/?${params}` : "/");
    await this.landmark();
  }

  row(slug: string): Locator {
    return this.page.locator(`[data-testid="recipe-row"][data-slug="${slug}"]`).first();
  }

  // --- the view-mode tab row (All recipes / Favorites) ------------------------------

  viewTabs(): Locator {
    return this.page.getByTestId("cookbook-viewtabs");
  }

  /** One tab by its accessible name ("All recipes" / "Favorites"). */
  viewTab(name: "All recipes" | "Favorites"): Locator {
    return this.viewTabs().getByRole("tab", { name });
  }

  /** The Favorites tab's mono count pill (absent at zero favorites). */
  favoritesTabCount(): Locator {
    return this.page.getByTestId("favorites-tab-count");
  }

  /** Enter a view through the control (the URL param is the derived state). */
  async openView(name: "All recipes" | "Favorites"): Promise<void> {
    await this.viewTab(name).click();
    await expect(this.viewTab(name)).toHaveAttribute("aria-selected", "true");
  }

  // --- the global filter bar -------------------------------------------------------

  filterBar(): Locator {
    return this.page.getByTestId("cookbook-filters");
  }

  cuisineSelect(): Locator {
    return this.page.getByLabel("Filter by cuisine");
  }

  proteinSelect(): Locator {
    return this.page.getByLabel("Filter by protein");
  }

  /** One time-segment button by its visible label ("Any" / "≤20" / "≤30" / "≤45"). */
  timeOption(label: string): Locator {
    return this.filterBar().locator('[data-seg="cook_time"] button', { hasText: label });
  }

  /** The active-only "N of M match" count label. */
  countLabel(): Locator {
    return this.page.getByTestId("filter-count");
  }

  clearFiltersButton(): Locator {
    return this.page.getByTestId("clear-filters");
  }

  /** The filtered-empty line (browse or favorites copy) with its inline clear link. */
  filterEmpty(): Locator {
    return this.page.getByTestId("filter-empty");
  }

  inlineClearFilters(): Locator {
    return this.filterEmpty().locator("button.plain-link");
  }

  // --- the promoted panel + organic list (member-app-differentiators) ---------------

  promotedPanel(): Locator {
    return this.page.getByTestId("promoted");
  }

  promotedRow(slug: string): Locator {
    return this.promotedPanel().locator(`[data-testid="recipe-row"][data-slug="${slug}"]`);
  }

  /** A promoted row's uppercase reason badge ("Just Added" / "Trending" / "Picked for You"). */
  reasonBadge(slug: string): Locator {
    return this.promotedRow(slug).getByTestId("reason-badge");
  }

  anyReasonBadges(): Locator {
    return this.page.getByTestId("reason-badge");
  }

  organicList(): Locator {
    return this.page.getByTestId("organic-list");
  }

  organicRow(slug: string): Locator {
    return this.organicList().locator(`[data-testid="recipe-row"][data-slug="${slug}"]`);
  }

  /** The honest group-counts chip on a listed trending recipe (panel or organic). */
  trendingChip(slug: string): Locator {
    return this.row(slug).getByTestId("trending-chip");
  }

  /** Every trending chip on the page (the empty-state's no-fake-badge assertion). */
  anyTrendingChips(): Locator {
    return this.page.getByTestId("trending-chip");
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

  // --- the searchbar (one custom clear affordance; the native one is suppressed) ---

  searchbar(): Locator {
    return this.page.locator(".searchbar");
  }

  searchInput(): Locator {
    return this.page.getByLabel("Search recipes");
  }

  /** The custom clear button — the ONE clear affordance (CSS-hidden until text). */
  clearButton(): Locator {
    return this.searchbar().locator(".search-clear");
  }

  async clearSearch(): Promise<void> {
    await this.clearButton().click();
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
   *  for each PUT to land (the row flips optimistically), and re-drives if the row
   *  hasn't converged — the write is an explicit SET, so repeating the intended
   *  state is idempotent (back-to-back ensures race the promoted panel's
   *  favorites-driven recomposition; a converging retry is the honest driver). */
  async ensureFavorite(slug: string, target: boolean): Promise<void> {
    const btn = this.row(slug).getByTestId("row-fav");
    await btn.waitFor();
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await btn.getAttribute("aria-pressed")) === String(target)) break;
      const done = this.page.waitForResponse(
        (r) => r.url().includes("/api/overlay/favorite") && r.request().method() === "PUT",
      );
      await btn.click();
      await done;
      // Give the optimistic flip / settle-time refetch a beat before re-driving.
      const settled = await expect(btn)
        .toHaveAttribute("aria-pressed", String(target), { timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (settled) break;
    }
    await this.expectFavorited(slug, target);
  }

  /** Deterministic fixture setup for recommendation tests. Those tests assert the
   * derived panel, not the favorite button's optimistic path (covered separately). */
  async provisionFavorite(slug: string, favorite: boolean): Promise<void> {
    await this.page.evaluate(async ({ slug, favorite }) => {
      const response = await fetch("/api/overlay/favorite", {
        method: "PUT",
        headers: { "content-type": "application/json", "X-App-Csrf": "1" },
        body: JSON.stringify({ slug, favorite }),
      });
      if (!response.ok) throw new Error(`favorite fixture write failed (${response.status})`);
    }, { slug, favorite });
  }
}
