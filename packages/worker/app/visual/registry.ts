// The all-areas registry: the ordered list of app areas the smoke spec iterates
// (landmark + review screenshot per entry). Adding an app area = its page object + one
// entry here (+ fixtures.ts registration and any seed rows); the smoke coverage picks it
// up with no other spec edits. `authed` areas are reached through the seeded invite login
// first (the login page object owns that flow) — the SPA redirects them to /login otherwise.
import type { AppPage, Page } from "./pages/base.page";
import { LoginPage } from "./pages/login.page";
import { HomePage } from "./pages/home.page";

export interface RegisteredArea {
  /** The area/screenshot name (matches the page object's `area`). */
  readonly area: string;
  /** Whether the area sits behind the session gate (the smoke logs in first). */
  readonly authed: boolean;
  readonly make: (page: Page) => AppPage;
}

export const AREAS: readonly RegisteredArea[] = [
  { area: "login", authed: false, make: (p) => new LoginPage(p) },
  { area: "home", authed: true, make: (p) => new HomePage(p) },
];
