// The app harness's extended `test`: one fixture per area page object, constructed on the
// spec's `page`, plus the shared logged-in entry (`asMember`). Specs import { test, expect }
// from here — never from @playwright/test directly and never constructing page objects
// inline — so route/selector knowledge stays in the objects (the admin harness's exact
// organization).
import { test as base, expect } from "@playwright/test";
import { LoginPage } from "./pages/login.page";
import { SignupPage } from "./pages/signup.page";
import { ShellPage } from "./pages/shell.page";
import { ConnectPage } from "./pages/connect.page";
import { CookbookPage } from "./pages/cookbook.page";
import { RecipePage } from "./pages/recipe.page";
import { PlanPage } from "./pages/plan.page";
import { GroceryPage } from "./pages/grocery.page";
import { PantryPage } from "./pages/pantry.page";
import { RetrospectivePage } from "./pages/retrospective.page";
import { ProfilePage } from "./pages/profile.page";
import { ProposePage } from "./pages/propose.page";
import { PeoplePage } from "./pages/people.page";
import { SEED } from "../../admin/visual/seed.mjs";

interface AppFixtures {
  loginPage: LoginPage;
  signupPage: SignupPage;
  shellPage: ShellPage;
  connectPage: ConnectPage;
  cookbookPage: CookbookPage;
  recipePage: RecipePage;
  planPage: PlanPage;
  groceryPage: GroceryPage;
  pantryPage: PantryPage;
  retrospectivePage: RetrospectivePage;
  profilePage: ProfilePage;
  proposePage: ProposePage;
  peoplePage: PeoplePage;
  /** Enter the app as the seeded member (lands on /). Most authed specs start here. */
  asMember: () => Promise<void>;
}

export const test = base.extend<AppFixtures>({
  // The entry stylesheet @imports the design system's webfont; the harness runs
  // offline, and the hanging fetch otherwise stalls every page-load event for ~20s.
  // Abort it up front — the font stacks carry real fallbacks by design.
  page: async ({ page }, use) => {
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await use(page);
  },
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  signupPage: async ({ page }, use) => use(new SignupPage(page)),
  shellPage: async ({ page }, use) => use(new ShellPage(page)),
  // Bound to the APPROVE ref — the approval spec mutates it; the smoke screenshot uses the
  // independent VIEW ref (registry.ts), so the two never collide regardless of order.
  connectPage: async ({ page }, use) => use(new ConnectPage(page, SEED.connect.approveRef)),
  cookbookPage: async ({ page }, use) => use(new CookbookPage(page)),
  recipePage: async ({ page }, use) => use(new RecipePage(page, SEED.recipe.slug)),
  planPage: async ({ page }, use) => use(new PlanPage(page)),
  groceryPage: async ({ page }, use) => use(new GroceryPage(page)),
  pantryPage: async ({ page }, use) => use(new PantryPage(page)),
  retrospectivePage: async ({ page }, use) => use(new RetrospectivePage(page)),
  profilePage: async ({ page }, use) => use(new ProfilePage(page)),
  proposePage: async ({ page }, use) => use(new ProposePage(page)),
  peoplePage: async ({ page }, use) => use(new PeoplePage(page)),
  asMember: async ({ page }, use) => {
    await use(async () => {
      // The `authed` project pre-authenticates the context via storageState (the
      // server-side session seeded in app/visual/setup.mjs), so entering the app is a
      // plain navigation — ZERO login HTTP, no per-test UI login, no 10/min limiter
      // pressure. The real login/enrollment UI keeps its dedicated coverage in the
      // `noauth` project's login/signup/passkey specs.
      await page.goto("/");
      await new ShellPage(page).landmark();
    });
  },
});

export { expect };
