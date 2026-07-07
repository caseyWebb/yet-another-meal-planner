// The app harness's extended `test`: one fixture per area page object, constructed on the
// spec's `page`. Specs import { test, expect } from here — never from @playwright/test
// directly and never constructing page objects inline — so route/selector knowledge stays
// in the objects (the admin harness's exact organization).
import { test as base, expect } from "@playwright/test";
import { LoginPage } from "./pages/login.page";
import { HomePage } from "./pages/home.page";

interface AppFixtures {
  loginPage: LoginPage;
  homePage: HomePage;
}

export const test = base.extend<AppFixtures>({
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  homePage: async ({ page }, use) => use(new HomePage(page)),
});

export { expect };
