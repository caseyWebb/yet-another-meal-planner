// Profile & preferences (member-app-core + profile-planning-and-vibes-ui): the three tabs —
// taste (derived read + If-Match markdown editors with the rebase-on-412 notice), preferences
// (merge-patch knobs — per-meal cadence steppers + the weekly-budget control), and meal vibes
// (the meal-grouped palette with the pinned indicator + inline suggestions — row-attached
// wands and per-meal-group footer cards, which replaced the standalone reconciliation queue).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";
import { SEED } from "../../../admin/visual/seed.mjs";

type Meal = "breakfast" | "lunch" | "dinner";

export class ProfilePage extends AppPage {
  readonly path = "/profile";
  readonly area = "profile";

  /**
   * Navigate/reload and WAIT for the assembled-profile read (`GET /api/profile`) to settle
   * before returning. The prefs controls seed their local draft from the loaded value ON
   * MOUNT — the weekly-budget field most visibly — so opening the prefs tab before the
   * profile query resolves renders a stale-empty control that never re-syncs. Gating each
   * navigation on the real read (not a fixed wait) makes every reload deterministic, so a
   * set→reload→assert round-trip can't race the load (which otherwise fails the attempt AND
   * poisons its retry, since the write already landed). Matches the assembled read exactly —
   * `/api/profile`, not its `/api/profile/*` sub-resources.
   */
  async goto(path: string = this.path): Promise<void> {
    await Promise.all([
      this.page.waitForResponse(
        (r) => r.request().method() === "GET" && r.url().split("?")[0].endsWith("/api/profile"),
      ),
      this.page.goto(path),
    ]);
  }

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("profile-page")).toBeVisible();
    await expect(this.page.getByTestId("taste-tab")).toBeVisible(); // the default tab
  }

  async openTab(tab: "taste" | "prefs" | "vibes"): Promise<void> {
    await this.page.getByTestId(`profile-tab-${tab}`).click();
  }

  /**
   * Reset casey's mutable PREFERENCES — the per-meal cadence, the weekly budget, and the
   * brand-tier families — to the exact seed via a DIRECT, AWAITED merge-patch through the
   * browser session (mirrors `competingTasteWrite`: fresh GET for the ETag, PATCH under
   * If-Match + the CSRF header, assert 200). It writes through the API, never the optimistic
   * UI (steppers/toggles read a stale display and race the server reconcile — the exact
   * defect that let a failed attempt poison its retry). Deterministic BY CONSTRUCTION: one
   * awaited write, no optimistic UI, no reload race, no reconcile. Wired as the prefs specs'
   * `beforeEach` so every run — first attempt, Playwright retry, `--repeat-each` iteration —
   * starts from the identical seed and a poisoned prior run cannot leak forward. Seed values
   * mirror `admin/visual/seed.mjs` (profile.cadence / profile.weekly_budget / SEED.app.brands).
   */
  async resetPrefs(): Promise<void> {
    const ladder = SEED.app.brands.ladder; // butter → [["Kerrygold"], ["store brand"]], any_brand off
    const dontCare = SEED.app.brands.dontCare; // yellow_onion → any-brand
    const patch = {
      cadence: { breakfast: 2, lunch: 1, dinner: 4 }, // seed.mjs profile.cadence
      weekly_budget: 95, // seed.mjs profile.weekly_budget
      brands: {
        [ladder.term]: { tiers: ladder.tiers, any_brand: false },
        [dontCare.term]: { tiers: [], any_brand: true },
        // The remove-family spec adds a "pasta" family; a merge-patch `null` deletes it (a
        // no-op when it was never added), so a retry starts from the seed's two families only.
        pasta: null,
      },
    };
    const status = await this.page.evaluate(async (p: Record<string, unknown>) => {
      const read = await fetch("/api/profile/preferences");
      const etag = read.headers.get("etag") ?? "";
      const res = await fetch("/api/profile/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json", "X-App-Csrf": "1", "If-Match": etag },
        body: JSON.stringify({ patch: p }),
      });
      return res.status;
    }, patch);
    if (status !== 200) throw new Error(`prefs reset failed (${status})`);
  }

  // --- taste tab: the class (a) markdown editors -----------------------------

  async openTasteEditor(): Promise<void> {
    await this.page.getByTestId("md-edit-taste").click();
  }

  async typeTaste(content: string): Promise<void> {
    await this.page.getByLabel("In your words").fill(content);
  }

  async saveTaste(): Promise<void> {
    await this.page.getByTestId("md-save-taste").click();
  }

  async expectRebaseNotice(): Promise<void> {
    await expect(this.page.getByTestId("md-rebase-notice")).toBeVisible();
  }

  async expectTasteView(text: string): Promise<void> {
    await expect(this.page.getByTestId("md-view-taste")).toContainText(text);
  }

  /** A competing writer: PUT the taste field through the BROWSER's session fetch
   *  (fresh GET → ETag → PUT), so the open editor's precondition goes stale. */
  async competingTasteWrite(content: string): Promise<void> {
    const status = await this.page.evaluate(async (c: string) => {
      const read = await fetch("/api/profile/taste");
      const etag = read.headers.get("etag") ?? "";
      const res = await fetch("/api/profile/taste", {
        method: "PUT",
        headers: { "content-type": "application/json", "X-App-Csrf": "1", "If-Match": etag },
        body: JSON.stringify({ content: c }),
      });
      return res.status;
    }, content);
    if (status !== 200) throw new Error(`competing write failed (${status})`);
  }

  // --- prefs tab: per-meal cadence steppers + weekly-budget control -------------

  /**
   * Run `trigger` (a blur/click that commits a preferences knob) and RESOLVE ONLY once
   * the merge-patch has landed server-side — the succeeding `PATCH /api/profile/preferences`.
   * The prefs controls save on blur/click through an unawaited If-Match merge-patch, so a
   * caller that reloads immediately would otherwise race the write (a stale reload, and — since
   * the write DID land — a poisoned Playwright retry sharing this D1). The control rebases on a
   * 412 (a fresh GET + retry), so we wait for the OK PATCH, not merely the first response.
   * A genuine save signal — never a fixed wait.
   */
  private async awaitPreferencesSave(trigger: () => Promise<void>): Promise<void> {
    await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.request().method() === "PATCH" &&
          r.url().includes("/api/profile/preferences") &&
          r.ok(),
      ),
      trigger(),
    ]);
  }

  cadenceItem(meal: Meal): Locator {
    return this.page.locator(`[data-testid="cadence-item"][data-meal="${meal}"]`);
  }

  /** Nudge a meal's weekly cadence by `delta` steps (+ increments, − decrements). Each
   *  step is its own merge-patch; wait for each to land so a later reload can't race it. */
  async setCadence(meal: Meal, delta: number): Promise<void> {
    const btn = this.cadenceItem(meal).getByTestId(delta > 0 ? "cadence-inc" : "cadence-dec");
    for (let i = 0; i < Math.abs(delta); i++) await this.awaitPreferencesSave(() => btn.click());
  }

  async expectCadence(meal: Meal, n: number): Promise<void> {
    await expect(this.cadenceItem(meal).getByTestId("cadence-n")).toHaveText(String(n));
  }

  prefsTab(): Locator {
    return this.page.getByTestId("prefs-tab");
  }

  /** A retired preferences control's old segmented-control host — asserted ABSENT. */
  retiredSeg(name: "lunch_strategy" | "ready_to_eat_default_action"): Locator {
    return this.page.locator(`[data-seg="${name}"]`);
  }

  /** Any visible text on the page (for absence assertions — retired labels, merge titles). */
  pageText(text: string): Locator {
    return this.page.getByText(text);
  }

  budgetField(): Locator {
    return this.page.getByTestId("budget-field");
  }

  budgetInput(): Locator {
    return this.budgetField().getByLabel("Weekly grocery budget in dollars");
  }

  async setBudget(n: number): Promise<void> {
    await this.budgetInput().fill(String(n));
    // Blur commits the value through the unawaited merge-patch; wait for the write to land.
    await this.awaitPreferencesSave(() => this.budgetInput().blur());
  }

  async clearBudget(): Promise<void> {
    await this.awaitPreferencesSave(() => this.budgetField().getByLabel("Clear budget").click());
  }

  async expectBudget(n: number): Promise<void> {
    await expect(this.budgetInput()).toHaveValue(String(n));
  }

  /** The unset state: the field is empty AND the "no budget line" helper renders (proving a
   *  clear wrote `weekly_budget: null`, not `0`). */
  async expectBudgetUnset(): Promise<void> {
    await expect(this.budgetInput()).toHaveValue("");
    await expect(this.budgetField().getByTestId("budget-off")).toBeVisible();
  }

  // --- prefs tab: the Preferred-brands tier card ----------------------------------

  brandFamily(term: string): Locator {
    return this.page.locator(`[data-testid="brand-family"][data-term="${term}"]`);
  }

  /** The family's tier boxes, in ladder order (a trailing draft tier included). */
  brandTiers(term: string): Locator {
    return this.brandFamily(term).getByTestId("brand-tier");
  }

  brandChip(term: string, brand: string): Locator {
    return this.brandFamily(term).locator(`[data-testid="brand-chip"][data-brand="${brand}"]`);
  }

  async moveBrand(term: string, brand: string, dir: "up" | "down"): Promise<void> {
    await this.brandChip(term, brand).getByLabel(`Move ${brand} ${dir} a tier`).click();
  }

  async expectTierBrands(term: string, tierIndex: number, brands: string[]): Promise<void> {
    const chips = this.brandTiers(term).nth(tierIndex).getByTestId("brand-chip");
    await expect(chips).toHaveCount(brands.length);
    for (const b of brands) {
      await expect(this.brandTiers(term).nth(tierIndex).locator(`[data-brand="${b}"]`)).toBeVisible();
    }
  }

  async addBrandToTier(term: string, tierIndex: number, brand: string): Promise<void> {
    const input = this.brandTiers(term).nth(tierIndex).getByLabel("Add brand to this tier");
    await input.fill(brand);
    await input.press("Enter");
  }

  anyBrandToggle(term: string): Locator {
    return this.brandFamily(term).getByTestId("brand-any-toggle");
  }

  async toggleAnyBrand(term: string): Promise<void> {
    await this.anyBrandToggle(term).click();
  }

  async expectAnyBrand(term: string, on: boolean): Promise<void> {
    await expect(this.anyBrandToggle(term)).toHaveAttribute("aria-pressed", String(on));
  }

  async removeBrandFamily(term: string): Promise<void> {
    await this.brandFamily(term).getByTestId("brand-family-remove").click();
  }

  async addBrandFamily(cat: string): Promise<void> {
    const form = this.page.getByTestId("brand-family-add");
    await form.getByLabel("New category").fill(cat);
    await form.getByRole("button", { name: "Add category" }).click();
  }

  // --- meal vibes tab: meal-grouped palette + inline suggestions -----------------

  vibeRows(): Locator {
    return this.page.getByTestId("vibe-row");
  }

  /** A meal group's section (its rows, empty line, and add-suggestion footer). */
  vibeGroup(meal: Meal): Locator {
    return this.page.locator(`[data-testid="vibe-group"][data-meal="${meal}"]`);
  }

  /** A specific vibe row within a meal group, matched by its phrase. */
  vibeInGroup(meal: Meal, text: string): Locator {
    return this.vibeGroup(meal).getByTestId("vibe-row").filter({ hasText: text });
  }

  async expectVibeInGroup(meal: Meal, text: string): Promise<void> {
    await expect(this.vibeInGroup(meal, text)).toHaveCount(1);
  }

  async expectPinned(meal: Meal, text: string): Promise<void> {
    await expect(this.vibeInGroup(meal, text).getByTestId("vibe-pin")).toBeVisible();
  }

  async expectNotPinned(meal: Meal, text: string): Promise<void> {
    await expect(this.vibeInGroup(meal, text).getByTestId("vibe-pin")).toHaveCount(0);
  }

  /** A vibe row anywhere in the palette (for inline row-suggestion actions), by phrase. */
  vibeRow(text: string): Locator {
    return this.vibeRows().filter({ hasText: text });
  }

  /** Toggle open a row's inline "Suggestion from your cooking" panel (the wand icon). */
  async openRowSuggestion(text: string): Promise<void> {
    await this.vibeRow(text).getByTestId("vibe-wand").click();
  }

  async applyRowSuggestion(text: string): Promise<void> {
    // Applying confirms the proposal server-side; wait for that write so a following reload
    // can't race it. Proposals aren't API-resettable (no member endpoint recreates a seeded
    // proposal), so this determinism is what keeps the spec retry-safe — a first attempt that
    // can't flake never resolves the proposal out from under its own retry.
    await this.awaitProposalConfirm(() => this.vibeRow(text).getByTestId("suggest-apply").click());
  }

  async dismissRowSuggestion(text: string): Promise<void> {
    await this.vibeRow(text).getByTestId("suggest-dismiss").click();
  }

  /** The per-meal-group `add_vibe` footer card (there is at most one per group in the seed). */
  addSuggestCard(meal: Meal): Locator {
    return this.vibeGroup(meal).getByTestId("vibe-add-suggest");
  }

  async addGroupSuggestion(meal: Meal): Promise<void> {
    // Confirms the add_vibe proposal server-side; wait for that write so the spec's reload
    // (which asserts the vibe persisted) can't race it — and so a first attempt can't flake
    // and resolve the (non-API-resettable) proposal out from under its retry.
    await this.awaitProposalConfirm(() => this.addSuggestCard(meal).getByTestId("add-suggest-add").click());
  }

  async dismissGroupSuggestion(meal: Meal): Promise<void> {
    await this.addSuggestCard(meal).getByTestId("add-suggest-dismiss").click();
  }

  /** Run `trigger` (a proposal-apply/add click) and resolve only once the confirm write —
   *  `POST /api/vibes/proposals/:id/confirm` — has landed ok, so a following reload/assertion
   *  can't race the optimistic mutation. A real save signal, never a fixed wait. */
  private async awaitProposalConfirm(trigger: () => Promise<void>): Promise<void> {
    await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes("/api/vibes/proposals/") &&
          r.url().endsWith("/confirm") &&
          r.ok(),
      ),
      trigger(),
    ]);
  }

  vibesTab(): Locator {
    return this.page.getByTestId("vibes-tab");
  }

  async expectToast(text: string): Promise<void> {
    await expect(this.page.getByTestId("toaster")).toContainText(text);
  }
}
