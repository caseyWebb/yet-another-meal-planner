// Signup (/signup) — self-service group-code signup (self-service-signup). A visitor picks a
// username + enters a group invite code; on success they land on the same first-run passkey
// enrollment nudge as a bootstrap login. `username_taken` renders inline on the username field;
// an unusable code renders the uniform form error. Not authed (reached with no session).
import { expect, type Locator } from "@playwright/test";
import { AppPage } from "./base.page";

export class SignupPage extends AppPage {
  readonly path = "/signup";
  readonly area = "signup";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("signup-form")).toBeVisible();
  }

  /** Fill the username + code and submit. */
  async signup(username: string, code: string): Promise<void> {
    await this.page.getByLabel("Username").fill(username);
    await this.page.getByLabel("Invite code").fill(code);
    await this.page.getByTestId("signup-submit").click();
  }

  /** The first-run passkey enrollment nudge shown after a successful signup. */
  enrollPrompt(): Locator {
    return this.page.getByTestId("enroll-prompt");
  }

  async addPasskey(): Promise<void> {
    await this.page.getByTestId("enroll-passkey").click();
  }

  /** The inline "username taken" message on the username field. */
  usernameError(): Locator {
    return this.page.getByTestId("signup-username-error");
  }

  /** The uniform form-level failure (a bad/exhausted/expired/revoked code). */
  formError(): Locator {
    return this.page.getByTestId("signup-error");
  }
}
