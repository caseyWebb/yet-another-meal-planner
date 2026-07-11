// The authenticated app shell (member-app-core 7.1): sidebar nav + account menu.
// Reaching its landmark proves the whoami boot check resolved a session; the nav
// helpers are how specs move between areas without addressing URLs.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class ShellPage extends AppPage {
  readonly path = "/";
  readonly area = "shell";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("app-shell")).toBeVisible();
  }

  /** The offline indicator (member-app-offline D10) — driven by onlineManager. */
  offlinePill(): Locator {
    return this.page.getByTestId("offline-pill");
  }

  /** The prompt-to-reload banner (D7) — renders only on a waiting SW (`needRefresh`). */
  reloadBanner(): Locator {
    return this.page.getByTestId("reload-banner");
  }

  /** The account menu's install affordance (rendered only when the browser offered
   *  beforeinstallprompt and the app isn't standalone — usually absent in CI). */
  installItem(): Locator {
    return this.page.getByTestId("install-app");
  }

  /** The sidebar shows the signed-in member in the account button. */
  async expectSignedInAs(id: string): Promise<void> {
    await expect(this.page.getByTestId("account-menu")).toContainText(`@${id}`);
  }

  async openAccountMenu(): Promise<void> {
    await this.page.getByTestId("account-menu").click();
    await expect(this.page.getByTestId("account-menu-panel")).toBeVisible();
  }

  /** Self-service "Add a device" — runs the passkey enrollment ceremony from the menu
   *  (webauthn-passkey-auth 8.2). */
  async addDevice(): Promise<void> {
    await this.openAccountMenu();
    await this.page.getByTestId("add-device").click();
  }

  /** The account menu carries the member's Kroger link badge. */
  async expectKrogerBadge(linked: boolean): Promise<void> {
    await expect(this.page.getByTestId("kroger-badge")).toContainText(linked ? "kroger" : "kroger unlinked");
  }

  async logout(): Promise<void> {
    await this.openAccountMenu();
    await this.page.getByTestId("logout").click();
  }

  async navTo(label: string): Promise<void> {
    await this.page.locator(".sb-link", { hasText: label }).click();
  }

  /** The live count badge on a nav entry (`.sb-count`) — absent (zero matches) when the
   *  count is zero and no badge renders (sidebar-live-counts). */
  navBadge(label: string): Locator {
    return this.page.locator(".sb-link", { hasText: label }).locator(".sb-count");
  }

  /** The sidebar's Connect-to-Claude CTA opens the guided modal (connect-modal). */
  async openConnectModal(): Promise<void> {
    await this.page.getByTestId("connect-claude-cta").click();
    await expect(this.page.getByTestId("connect-modal")).toBeVisible();
  }

  /** Switch the modal's client tab. */
  async switchConnectTab(tab: "web" | "code"): Promise<void> {
    await this.page.getByTestId(`connect-tab-${tab}`).click();
  }

  /** Step n's copyable command text. */
  connectCmd(n: number): Locator {
    return this.page.getByTestId(`connect-cmd-${n}`);
  }

  /** Step n's copy button (flips to "Copied" on success). */
  connectCopy(n: number): Locator {
    return this.page.getByTestId(`connect-copy-${n}`);
  }

  /** Step n's whole row (title + desc + command). */
  connectStep(n: number): Locator {
    return this.page.getByTestId(`connect-step-${n}`);
  }
}
