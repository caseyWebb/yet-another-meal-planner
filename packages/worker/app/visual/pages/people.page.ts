// People (households-friends-and-people-page / pages 08): the requests inbox, the
// nickname mechanics, HOUSEHOLD with the find/invite adders, Awaiting response, and —
// under the SaaS variant — FRIENDS with "N shared". Selector knowledge for both profile
// variants of the ONE page component lives here.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class PeoplePage extends AppPage {
  readonly path = "/people";
  readonly area = "people";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("people-page")).toBeVisible();
  }

  /** The rendered profile variant (the page stamps `data-profile`). */
  variant(): Locator {
    return this.page.getByTestId("people-page");
  }

  // --- inbox -------------------------------------------------------------------------

  inbox(): Locator {
    return this.page.getByTestId("people-inbox");
  }

  inboxRow(handle: string): Locator {
    return this.page
      .locator('[data-testid="inbox-row"]')
      .filter({ has: this.page.locator('[data-testid="inbox-handle"]', { hasText: `@${handle}` }) });
  }

  async accept(handle: string): Promise<void> {
    await this.inboxRow(handle).getByTestId("inbox-accept").click();
    await this.page.getByTestId("accept-confirm").click();
  }

  async decline(handle: string): Promise<void> {
    await this.inboxRow(handle).getByTestId("inbox-decline").click();
  }

  // --- household ----------------------------------------------------------------------

  memberRow(handle: string): Locator {
    return this.page.locator(`[data-testid="member-row"][data-handle="${handle}"]`);
  }

  async setNickname(handle: string, nickname: string): Promise<void> {
    const row = this.memberRow(handle);
    await row.getByTestId("nickname-edit").click();
    const editor = row.getByTestId("nickname-editor");
    await editor.locator("input").fill(nickname);
    await row.getByTestId("nickname-save").click();
  }

  async expectNickname(handle: string, nickname: string): Promise<void> {
    await expect(this.memberRow(handle).getByTestId("member-nickname")).toHaveText(nickname);
  }

  async expectNoNickname(handle: string): Promise<void> {
    await expect(this.memberRow(handle).getByTestId("member-nickname")).toHaveCount(0);
    await expect(this.memberRow(handle).getByTestId("nickname-edit")).toHaveText("Add a nickname");
  }

  nicknameExample(): Locator {
    return this.page.getByTestId("nickname-example");
  }

  // --- adders ---------------------------------------------------------------------------

  async openInvitePopover(tier: "household" | "friend"): Promise<void> {
    await this.page.getByTestId(`adder-${tier}-invite`).click();
  }

  async mintInvite(tier: "household" | "friend"): Promise<void> {
    await this.openInvitePopover(tier);
    await this.page.getByTestId("invite-mint").click();
    await expect(this.page.getByTestId("invite-link")).toBeVisible();
  }

  // --- awaiting --------------------------------------------------------------------------

  awaitingRow(handle: string): Locator {
    return this.page
      .locator('[data-testid="awaiting-row"]')
      .filter({ hasText: `@${handle}` });
  }

  awaitingInvites(): Locator {
    return this.page.locator('[data-testid="awaiting-invite"]');
  }

  // --- friends (SaaS) ----------------------------------------------------------------------

  friendsSection(): Locator {
    return this.page.getByTestId("people-friends");
  }

  friendRow(tenant: string): Locator {
    return this.page.locator(`[data-testid="friend-row"][data-tenant="${tenant}"]`);
  }
}
