// Recipe detail (member-app-core 7.4): title/facets/body, the Cook-with-Claude deep
// link, action row, the notes split (own editable / community read-only) with the
// note-visibility-tiers composer (Public/Friends/Private segmented control + audience
// description, tier chips, tier-aware edit state), and the Similar section (absent
// when nothing is embedded — the seed's posture).
import { expect } from "@playwright/test";
import { AppPage, type Page } from "./base.page";

export type NoteTier = "public" | "friends" | "private";

export class RecipePage extends AppPage {
  readonly path: string;
  readonly area = "recipe-detail";

  constructor(page: Page, slug = "") {
    super(page);
    this.path = `/recipe/${slug}`;
  }

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("recipe-detail")).toBeVisible();
    await expect(this.page.getByTestId("recipe-title")).toBeVisible();
  }

  async expectTitle(title: string): Promise<void> {
    await expect(this.page.getByTestId("recipe-title")).toHaveText(title);
  }

  async expectBodyContains(text: string): Promise<void> {
    await expect(this.page.getByTestId("recipe-body")).toContainText(text);
  }

  /** The deep link opens claude.ai with the /cook command — never an in-app model call. */
  async expectCookDeepLink(slug: string): Promise<void> {
    const href = await this.page.getByTestId("cook-with-claude").getAttribute("href");
    if (href !== `https://claude.ai/new?q=${encodeURIComponent(`/cook ${slug}`)}`) {
      throw new Error(`unexpected deep link: ${href}`);
    }
  }

  async addNote(body: string, opts: { tag?: string; tier?: NoteTier } = {}): Promise<void> {
    await this.page.getByLabel("Note body").fill(body);
    if (opts.tag) await this.page.getByLabel("Tag").fill(opts.tag);
    if (opts.tier) await this.selectComposerTier(opts.tier);
    await this.page.getByRole("button", { name: "Add note" }).click();
  }

  // ── The tier composer (note-visibility-tiers, design request #9) ──────────────────
  /** One segment of the composer's Public/Friends/Private control. */
  composerTierButton(tier: NoteTier) {
    return this.page.getByTestId("note-tier").locator(".seg button", { hasText: tier });
  }

  async selectComposerTier(tier: NoteTier): Promise<void> {
    await this.composerTierButton(tier).click();
  }

  async expectComposerTierSelected(tier: NoteTier): Promise<void> {
    await expect(this.composerTierButton(tier)).toHaveAttribute("aria-pressed", "true");
  }

  /** The one-line audience description under the composer's control. */
  async expectTierDescription(text: string): Promise<void> {
    await expect(this.page.getByTestId("note-tier-desc")).toContainText(text);
  }

  /** The tier chip on a rendered note (lock = private, globe = public); Friends
   *  renders unmarked, so `null` asserts no chip inside the given list. */
  tierChips(list: "own-notes" | "community-notes", tier: NoteTier) {
    return this.page.getByTestId(list).locator(`[data-testid="note-tier-badge"][data-tier="${tier}"]`);
  }

  async expectOwnNote(body: string): Promise<void> {
    await expect(this.page.getByTestId("own-notes")).toContainText(body);
  }

  async expectCommunityNote(body: string): Promise<void> {
    await expect(this.page.getByTestId("community-notes")).toContainText(body);
  }

  /** Community notes are handle-attributed ("@handle"). */
  async expectCommunityHandle(handle: string): Promise<void> {
    await expect(this.page.getByTestId("community-notes").getByTestId("note-handle").first()).toHaveText(`@${handle}`);
  }

  /** Open the first own note's edit state, optionally re-tier via its seeded control,
   *  and save — the PATCH carries tier alongside body (same class (b) write). */
  async editFirstOwnNote(opts: { tier?: NoteTier } = {}): Promise<void> {
    await this.page.getByTestId("note-edit").first().click();
    await expect(this.page.getByTestId("note-edit-form")).toBeVisible();
    if (opts.tier) {
      await this.page.getByTestId("note-edit-tier").locator(".seg button", { hasText: opts.tier }).click();
    }
    await this.page.getByTestId("note-edit-form").getByRole("button", { name: "Save" }).click();
  }

  /** The edit state's control is seeded with the note's CURRENT tier. */
  async expectEditTierSelected(tier: NoteTier): Promise<void> {
    await expect(
      this.page.getByTestId("note-edit-tier").locator(".seg button", { hasText: tier }),
    ).toHaveAttribute("aria-pressed", "true");
  }

  async deleteFirstOwnNote(): Promise<void> {
    await this.page.getByTestId("note-delete").first().click();
  }

  /** Self-cleanup for specs that add notes: delete every own note (reused local
   *  servers keep D1 across runs — leftovers would break re-run determinism). */
  async deleteAllOwnNotes(): Promise<void> {
    while ((await this.page.getByTestId("note-delete").count()) > 0) {
      const before = await this.page.getByTestId("note-delete").count();
      await this.page.getByTestId("note-delete").first().click();
      await expect(this.page.getByTestId("note-delete")).toHaveCount(before - 1);
    }
  }

  async expectNoOwnNotes(): Promise<void> {
    await expect(this.page.getByTestId("own-notes")).toHaveCount(0);
  }

  async logAsCooked(): Promise<void> {
    await this.page.getByTestId("detail-log").click();
  }

  // ── Guided cook mode (recipe-card-cook-mode, D32) ──────────────────────────────────
  startCookingButton() {
    return this.page.getByTestId("start-cooking");
  }

  async startCooking(): Promise<void> {
    await this.startCookingButton().click();
    await expect(this.page.getByTestId("cook-mise")).toBeVisible();
  }

  async toggleMiseItem(index = 0): Promise<void> {
    await this.page.getByTestId("cook-check").nth(index).click();
  }

  async expectMiseCount(text: string): Promise<void> {
    await expect(this.page.getByTestId("cook-mise-count")).toHaveText(text);
  }

  /** Progress-bar fraction (0–1) — asserts the step nav actually advances the bar. */
  async progressFraction(): Promise<number> {
    const w = await this.page
      .getByTestId("cook-progress")
      .evaluate((el) => (el as unknown as { style: { width: string } }).style.width);
    return parseFloat(w) / 100;
  }

  async startStepping(): Promise<void> {
    await this.page.getByTestId("cook-start").click();
    await expect(this.page.getByTestId("cook-step")).toBeVisible();
  }

  async nextStep(): Promise<void> {
    await this.page.getByTestId("cook-next").click();
  }

  async prevStep(): Promise<void> {
    await this.page.getByTestId("cook-back").click();
  }

  async expectStepBody(text: string): Promise<void> {
    await expect(this.page.getByTestId("cook-step-body")).toContainText(text);
  }

  timer() {
    return this.page.getByTestId("cook-timer");
  }

  async armTimer(): Promise<void> {
    await this.page.getByTestId("cook-timer-toggle").click();
  }

  timerDisplay() {
    return this.page.getByTestId("cook-timer-display");
  }

  async expectDone(): Promise<void> {
    await expect(this.page.getByTestId("cook-done")).toBeVisible();
    await expect(this.page.getByTestId("cook-done")).toContainText("Plated up");
  }

  async exitCook(): Promise<void> {
    await this.page.getByTestId("cook-exit").click();
  }
}
