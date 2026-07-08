// The all-areas registry: the ordered list of app areas the smoke spec iterates
// (landmark + review screenshot per entry). Adding an app area = its page object + one
// entry here (+ fixtures.ts registration and any seed rows); the smoke coverage picks it
// up with no other spec edits. `authed` areas are reached through the seeded invite login
// first (the login page object owns that flow) — the SPA redirects them to /login otherwise.
import type { AppPage, Page } from "./pages/base.page";
import { LoginPage } from "./pages/login.page";
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

export interface RegisteredArea {
  /** The area/screenshot name (matches the page object's `area`). */
  readonly area: string;
  /** Whether the area sits behind the session gate (the smoke logs in first). */
  readonly authed: boolean;
  readonly make: (page: Page) => AppPage;
}

export const AREAS: readonly RegisteredArea[] = [
  { area: "login", authed: false, make: (p) => new LoginPage(p) },
  { area: "cookbook", authed: true, make: (p) => new CookbookPage(p) },
  { area: "recipe-detail", authed: true, make: (p) => new RecipePage(p, SEED.recipe.slug) },
  { area: "favorites", authed: true, make: (p) => new FavoritesPage(p) },
  { area: "plan", authed: true, make: (p) => new PlanPage(p) },
  { area: "grocery", authed: true, make: (p) => new GroceryPage(p) },
  { area: "pantry", authed: true, make: (p) => new PantryPage(p) },
  { area: "log", authed: true, make: (p) => new LogPage(p) },
  { area: "profile", authed: true, make: (p) => new ProfilePage(p) },
  { area: "propose", authed: true, make: (p) => new ProposePage(p) },
];
