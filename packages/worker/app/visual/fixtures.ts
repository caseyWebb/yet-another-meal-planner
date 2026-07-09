// The app harness's extended `test`: one fixture per area page object, constructed on the
// spec's `page`, plus the shared logged-in entry (`asMember`). Specs import { test, expect }
// from here — never from @playwright/test directly and never constructing page objects
// inline — so route/selector knowledge stays in the objects (the admin harness's exact
// organization).
import { test as base, expect, type Cookie } from "@playwright/test";
import { LoginPage } from "./pages/login.page";
import { ShellPage } from "./pages/shell.page";
import { ConnectPage } from "./pages/connect.page";
import { CookbookPage } from "./pages/cookbook.page";
import { RecipePage } from "./pages/recipe.page";
import { FavoritesPage } from "./pages/favorites.page";
import { PlanPage } from "./pages/plan.page";
import { GroceryPage } from "./pages/grocery.page";
import { PantryPage } from "./pages/pantry.page";
import { LogPage } from "./pages/log.page";
import { ProfilePage } from "./pages/profile.page";
import { ProposePage } from "./pages/propose.page";
import { SEED } from "../../admin/visual/seed.mjs";

interface AppFixtures {
  loginPage: LoginPage;
  shellPage: ShellPage;
  connectPage: ConnectPage;
  cookbookPage: CookbookPage;
  recipePage: RecipePage;
  favoritesPage: FavoritesPage;
  planPage: PlanPage;
  groceryPage: GroceryPage;
  pantryPage: PantryPage;
  logPage: LogPage;
  profilePage: ProfilePage;
  proposePage: ProposePage;
  /** Log in as the seeded member (lands on /). Most authed specs start here. */
  asMember: () => Promise<void>;
}

/** The member session cookie, minted once per worker and replayed (see asMember). */
let memberCookies: Cookie[] | null = null;

export const test = base.extend<AppFixtures>({
  // The entry stylesheet @imports the design system's webfont; the harness runs
  // offline, and the hanging fetch otherwise stalls every page-load event for ~20s.
  // Abort it up front — the font stacks carry real fallbacks by design.
  page: async ({ page }, use) => {
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await use(page);
  },
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  shellPage: async ({ page }, use) => use(new ShellPage(page)),
  // Bound to the APPROVE ref — the approval spec mutates it; the smoke screenshot uses the
  // independent VIEW ref (registry.ts), so the two never collide regardless of order.
  connectPage: async ({ page }, use) => use(new ConnectPage(page, SEED.connect.approveRef)),
  cookbookPage: async ({ page }, use) => use(new CookbookPage(page)),
  recipePage: async ({ page }, use) => use(new RecipePage(page, SEED.recipe.slug)),
  favoritesPage: async ({ page }, use) => use(new FavoritesPage(page)),
  planPage: async ({ page }, use) => use(new PlanPage(page)),
  groceryPage: async ({ page }, use) => use(new GroceryPage(page)),
  pantryPage: async ({ page }, use) => use(new PantryPage(page)),
  logPage: async ({ page }, use) => use(new LogPage(page)),
  profilePage: async ({ page }, use) => use(new ProfilePage(page)),
  proposePage: async ({ page }, use) => use(new ProposePage(page)),
  asMember: async ({ page, context }, use) => {
    await use(async () => {
      // ONE UI login per worker, then the session cookie is replayed — the login
      // limiter allows 10/min/IP and a fast suite logging in per test would trip it.
      if (memberCookies) {
        await context.addCookies(memberCookies);
        await page.goto("/");
        await new ShellPage(page).landmark();
      } else {
        const login = new LoginPage(page);
        await login.goto();
        await login.login(SEED.invite);
        // A bootstrap-code login now lands on the first-run passkey enrollment nudge
        // (webauthn-passkey-auth 8.2); the harness declines it to reach the app shell.
        await login.skipEnroll();
        // Reach the shell FIRST — the session cookie only exists once the login
        // response landed; capturing on click races Set-Cookie and caches nothing.
        await new ShellPage(page).landmark();
        memberCookies = await context.cookies();
      }
    });
  },
});

export { expect };
