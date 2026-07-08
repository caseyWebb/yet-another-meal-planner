// Profile & preferences (member-app-core 7.10–7.12): the three tabs — taste (derived
// read + If-Match markdown editors with the rebase-on-412 notice), preferences
// (merge-patch knobs), and night vibes (palette + reconciliation queue + the gated
// suggest trigger).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class ProfilePage extends AppPage {
  readonly path = "/profile";
  readonly area = "profile";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("profile-page")).toBeVisible();
    await expect(this.page.getByTestId("taste-tab")).toBeVisible(); // the default tab
  }

  async openTab(tab: "taste" | "prefs" | "vibes"): Promise<void> {
    await this.page.getByTestId(`profile-tab-${tab}`).click();
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

  // --- prefs tab ---------------------------------------------------------------

  async setCookingNights(n: 2 | 3 | 4 | 5): Promise<void> {
    await this.page.locator('[data-seg="default_cooking_nights"] button', { hasText: String(n) }).click();
  }

  async expectCookingNights(n: 2 | 3 | 4 | 5): Promise<void> {
    await expect(
      this.page.locator(`[data-seg="default_cooking_nights"] button[aria-pressed="true"]`),
    ).toHaveText(String(n));
  }

  // --- vibes tab: palette + queue + suggest --------------------------------------

  proposalRows(): Locator {
    return this.page.getByTestId("proposal-row");
  }

  proposal(rationaleOrTitle: string): Locator {
    return this.proposalRows().filter({ hasText: rationaleOrTitle });
  }

  /** A row's accept button — absent by design for kinds with no backing op (merge_recipes). */
  proposalAccept(text: string): Locator {
    return this.proposal(text).getByTestId("proposal-accept");
  }

  /** The merge_recipes row's "merge with your agent in chat" hint. */
  mergeChatHint(): Locator {
    return this.page.getByTestId("merge-chat-hint");
  }

  async acceptProposal(text: string): Promise<void> {
    await this.proposal(text).getByTestId("proposal-accept").click();
  }

  async dismissProposal(text: string): Promise<void> {
    await this.proposal(text).getByTestId("proposal-dismiss").click();
  }

  vibeRows(): Locator {
    return this.page.getByTestId("vibe-row");
  }

  async expectPaletteEmpty(): Promise<void> {
    await expect(this.page.getByTestId("palette-empty")).toBeVisible();
  }

  async suggest(): Promise<void> {
    await this.page.getByTestId("vibe-suggest").click();
  }

  async expectToast(text: string): Promise<void> {
    await expect(this.page.getByTestId("toaster")).toContainText(text);
  }
}
