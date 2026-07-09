// /connect — the cross-device MCP approval screen (webauthn-passkey-auth). Reached from
// Claude.ai's /authorize deep link with `?authz=<ref>`; fixtures seed pending `authz:<ref>`
// records (SEED.connect.viewRef / approveRef in admin/visual/seed.mjs). A signed-in member
// confirms the verification code and approves; an unauthenticated visit bounces to /login.
import { expect } from "@playwright/test";
import { AppPage, type Locator, type Page } from "./base.page";

export class ConnectPage extends AppPage {
  readonly path: string;
  readonly area = "connect";

  constructor(page: Page, ref: string) {
    super(page);
    this.path = `/connect?authz=${encodeURIComponent(ref)}`;
  }

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("connect-screen")).toBeVisible();
  }

  /** The requesting client name (the confused-deputy guard's human half, beside the code). */
  client(): Locator {
    return this.page.getByTestId("connect-client");
  }

  /** The verification code the member matches against the /authorize screen. */
  code(): Locator {
    return this.page.getByTestId("connect-code");
  }

  async approve(): Promise<void> {
    await this.page.getByTestId("connect-approve").click();
  }

  /** The success panel ("Connected — return to Claude"). */
  approved(): Locator {
    return this.page.getByTestId("connect-approved");
  }

  /** The expired/unknown-reference panel. */
  gone(): Locator {
    return this.page.getByTestId("connect-gone");
  }
}
