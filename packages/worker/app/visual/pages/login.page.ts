// Login (/login) — the invite-code screen (member-session-auth). Fixtures: the seeded
// invite mapping `invite:<SEED.invite>` → the active member (admin/visual/seed.mjs).
import { expect } from "@playwright/test";
import { AppPage } from "./base.page";

export class LoginPage extends AppPage {
  readonly path = "/login";
  readonly area = "login";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("login-form")).toBeVisible();
    await expect(this.page.getByLabel("Invite code")).toBeVisible();
  }

  /** Submit an invite code (any string — validity is the Worker's call). */
  async login(code: string): Promise<void> {
    await this.page.getByLabel("Invite code").fill(code);
    await this.page.getByRole("button", { name: "Sign in" }).click();
  }

  /** The UNIFORM auth error (unknown code and revoked member render identically). */
  async expectUniformError(): Promise<void> {
    await expect(this.page.getByTestId("login-error")).toContainText("That invite code didn't work");
  }
}
