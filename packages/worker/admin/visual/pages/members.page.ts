// Members (/admin/members) — the roster + invite dialog; member detail is a sub-page object.
// Fixtures: SEED.members.active (tenant KV + OAuth grant + tenant_activity + cooked/favorite
// rows → an "active" row with counts) and SEED.members.pending (allowlist entry only → a
// "pending" row and the not-yet-connected detail state) — see seed.mjs.
import { expect, type Locator, type Page } from "@playwright/test";
import { AdminPage } from "./base.page";
import { DialogComponent } from "../components/dialog.component";

export class MembersPage extends AdminPage {
  readonly path = "/admin/members";
  readonly area = "members";

  async landmark(): Promise<void> {
    await expect(this.page.locator("p.group-label", { hasText: "Roster" })).toBeVisible();
  }

  /** The invite button lives in the hydrated roster island. */
  get inviteButton(): Locator {
    return this.page.getByRole("button", { name: "Invite member" });
  }

  inviteDialog(): DialogComponent {
    return new DialogComponent(this.page.getByRole("dialog", { name: "Invite member" }));
  }

  /** Open the invite dialog (click + open assertion live in the dialog component). */
  async openInviteDialog(): Promise<DialogComponent> {
    const dialog = this.inviteDialog();
    await dialog.openVia(this.inviteButton);
    return dialog;
  }

  /** A household's roster row (compact single-member row OR a group's header row). */
  rosterRow(id: string): Locator {
    return this.page.locator(`[data-testid="household-row"][data-household="${id}"]`);
  }

  /** A multi-member household's GROUP (header + indented member rows). */
  householdGroup(id: string): Locator {
    return this.page.locator(`[data-testid="household-group"][data-household="${id}"]`);
  }

  /** One member row inside a household group, by handle. */
  memberRow(handle: string): Locator {
    return this.page.locator(`[data-testid="member-row"][data-member="${handle}"]`);
  }

  /** A compact row's actions menu trigger (single-member household: both affordance sets). */
  rowMenuTrigger(id: string): Locator {
    return this.rosterRow(id).getByRole("button", { name: "Member actions" });
  }

  /** Open a compact household row's actions menu; returns the opened (portaled) menu. */
  async openRowMenu(id: string): Promise<Locator> {
    await this.rowMenuTrigger(id).click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  /** Open a multi-member household HEADER's actions menu (household-level actions). */
  async openHouseholdMenu(id: string): Promise<Locator> {
    await this.rosterRow(id).getByRole("button", { name: "Household actions" }).click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  /** Open a grouped MEMBER row's actions menu (member-level actions). */
  async openMemberMenu(handle: string): Promise<Locator> {
    await this.memberRow(handle).getByRole("button", { name: "Member actions" }).click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  /** A stat tile by label (the summary row above the roster). */
  statTile(label: string): Locator {
    return this.page.locator(".stat-card", { hasText: label });
  }

  /** A menu item by its accessible name ("Rotate invite" / "Revoke member" / "Purge household"…). */
  menuItem(name: string | RegExp): Locator {
    return this.page.getByRole("menuitem", { name });
  }

  /** The once-shown minted-credentials banner (a rotate/onboard result). */
  get mintedBanner(): Locator {
    return this.page.locator(".minted");
  }

  /** The minted banner's Dismiss button — a body-level control, so clicking it proves the page
   *  isn't `pointer-events`-locked after the (non-modal) row-menu flow. Scoped under the banner so
   *  it stays unambiguous if another surface ever grows a "Dismiss". */
  get bannerDismiss(): Locator {
    return this.mintedBanner.getByRole("button", { name: "Dismiss" });
  }

  /** Assert the page isn't pointer-events-locked. A modal Radix layer sets `pointer-events: none`
   *  on <body> — a per-row actions menu must never do that, so this holds even while the menu is
   *  open. Deterministic: it fails on a modal menu the instant it opens, independent of the flaky
   *  close-cleanup timing. */
  async expectNotPointerLocked(): Promise<void> {
    await expect(this.page.locator("body")).not.toHaveCSS("pointer-events", "none");
  }

  /** A revoke confirmation (the shared Radix AlertDialog) by its split-lifecycle name:
   *  "Purge household" (whole tenant) or "Revoke member" (single member). */
  revokeDialog(name: "Purge household" | "Revoke member" = "Purge household"): Locator {
    return this.page.getByRole("alertdialog", { name });
  }

  memberDetail(id: string): MemberDetailPage {
    return new MemberDetailPage(this.page, id);
  }

  // --- Invite codes sub-tab (self-service-signup, ?tab=codes) ---------------

  /** Deep-link the Invite-codes sub-tab and wait for its landmark. */
  async gotoCodes(): Promise<void> {
    await this.goto("/admin/members?tab=codes");
    await expect(this.codesLandmark).toBeVisible();
  }

  /** The Invite-codes section landmark (renders from its primary query, time-free). */
  get codesLandmark(): Locator {
    return this.page.locator("p.group-label", { hasText: "Invite codes" });
  }

  get mintCodeButton(): Locator {
    return this.page.getByRole("button", { name: "Mint code" });
  }

  mintCodeDialog(): DialogComponent {
    return new DialogComponent(this.page.getByRole("dialog", { name: "Mint invite code" }));
  }

  async openMintCodeDialog(): Promise<DialogComponent> {
    const dialog = this.mintCodeDialog();
    await dialog.openVia(this.mintCodeButton);
    return dialog;
  }

  /** A group code's roster row (an `.item` carrying the code text). */
  codeRow(code: string): Locator {
    return this.page.locator(".item", { hasText: code });
  }

  revokeCodeButton(code: string): Locator {
    return this.codeRow(code).getByRole("button", { name: "Revoke" });
  }

  /** The revoke-code confirmation (the shared Radix AlertDialog). */
  revokeCodeDialog(): Locator {
    return this.page.getByRole("alertdialog", { name: "Revoke invite code" });
  }
}

/** Member detail (/admin/members/:id[/:section]) — SSR sub-routes under Members. A pending
 *  member renders the not-yet-connected empty state instead of the section pills. */
export class MemberDetailPage extends AdminPage {
  readonly path: string;
  readonly area = "member-detail";

  constructor(page: Page, private readonly id: string) {
    super(page);
    this.path = `/admin/members/${encodeURIComponent(id)}`;
  }

  /** Both variants (active and pending) render the back-link to the roster. */
  async landmark(): Promise<void> {
    await expect(this.page.getByRole("link", { name: "All members" })).toBeVisible();
  }

  /** An active member's section pills (absent for a pending member). */
  sectionPill(name: string): Locator {
    return this.page.locator("a.pill", { hasText: name }).first();
  }

  async expectPendingEmptyState(): Promise<void> {
    await expect(this.page.getByText(`@${this.id} hasn't connected their Claude.ai yet`, { exact: false })).toBeVisible();
  }
}
