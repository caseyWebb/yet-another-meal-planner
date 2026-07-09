// Login (/login) — passkey sign-in (primary) over the invite-code bootstrap field
// (member-session-auth + webauthn-passkey-auth). Fixtures: the seeded invite mapping
// `invite:<SEED.invite>` → the active member (admin/visual/seed.mjs).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class LoginPage extends AppPage {
  readonly path = "/login";
  readonly area = "login";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("login-form")).toBeVisible();
    await expect(this.page.getByLabel("Invite code")).toBeVisible();
  }

  /** Submit an invite code (any string — validity is the Worker's call). The testid pins the
   *  bootstrap submit, disambiguating it from the "Sign in with a passkey" primary. */
  async login(code: string): Promise<void> {
    await this.page.getByLabel("Invite code").fill(code);
    await this.page.getByTestId("invite-submit").click();
  }

  /** The primary passkey affordance — a discoverable `navigator.credentials.get()` ceremony. */
  async signInWithPasskey(): Promise<void> {
    await this.page.getByTestId("passkey-login").click();
  }

  /** The first-run enrollment nudge shown after a bootstrap-code login. */
  enrollPrompt(): Locator {
    return this.page.getByTestId("enroll-prompt");
  }

  /** Run the passkey enrollment ceremony from the first-run nudge. */
  async addPasskey(): Promise<void> {
    await this.page.getByTestId("enroll-passkey").click();
  }

  /** Decline enrollment and continue into the app. */
  async skipEnroll(): Promise<void> {
    await this.page.getByTestId("enroll-skip").click();
  }

  /** The UNIFORM auth error (unknown code and revoked member render identically). */
  async expectUniformError(): Promise<void> {
    await expect(this.page.getByTestId("login-error")).toContainText("That invite code didn't work");
  }
}
