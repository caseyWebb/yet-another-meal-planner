// Home (/) — the session-gated app shell (member-app-shell P0: hello-world). Reaching
// its landmark proves the whoami boot check resolved a session; unauthenticated visits
// land on /login instead (the login page object owns that surface).
import { expect } from "@playwright/test";
import { AppPage } from "./base.page";

export class HomePage extends AppPage {
  readonly path = "/";
  readonly area = "home";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("app-shell")).toBeVisible();
  }

  /** The shell greets the signed-in member by tenant id. */
  async expectSignedInAs(id: string): Promise<void> {
    await expect(this.page.getByTestId("app-shell")).toContainText(`Hello, ${id}`);
  }

  async logout(): Promise<void> {
    await this.page.getByTestId("logout").click();
  }
}
