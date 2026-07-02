// The page-object base (POM): every admin area's page object extends AdminPage, which owns the
// shell contract — the `<h1>grocery-agent admin</h1>` heading, the area nav, the global health
// dock — and the review-screenshot capture. Subclasses own their route, their area-unique
// landmark, and their sub-surface accessors; specs consume page objects via fixtures.ts and
// never address routes or shell markup directly.
//
// Landmark discipline (see src/admin/CLAUDE.md): a landmark is SSR-rendered (no island-hydration
// wait), unique to its area, and time-free (never relative-age text — those strings depend on
// the run clock even with the seeded now-relative fixtures).
import { expect, type Locator, type Page } from "@playwright/test";
import { NavComponent } from "../components/nav.component";
import { HealthDockComponent } from "../components/health-dock.component";

/** Review screenshots land here (stable ASCII names — the publish step and mobile rendering
 *  depend on them); gitignored, uploaded as a CI artifact and pushed to the screenshots branch. */
const SCREENSHOT_DIR = "admin/visual/.screenshots";

export abstract class AdminPage {
  readonly nav: NavComponent;
  readonly healthDock: HealthDockComponent;

  constructor(protected readonly page: Page) {
    this.nav = new NavComponent(page);
    this.healthDock = new HealthDockComponent(page);
  }

  /** The area's route (subclasses define; the registry's smoke loop uses it). */
  abstract readonly path: string;
  /** The area's registry/screenshot name (ASCII, kebab-case). */
  abstract readonly area: string;
  /** The area-unique, SSR-rendered, time-free assertion proving the surface rendered. */
  abstract landmark(): Promise<void>;

  /** Navigate to the area (or a sub-path of it) and assert the shell rendered. */
  async goto(path: string = this.path): Promise<void> {
    await this.page.goto(path);
    await this.expectShell();
  }

  /** The shared shell: the persistent title heading (nav/dock asserted where a spec needs them). */
  async expectShell(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "grocery-agent admin" })).toBeVisible();
  }

  /** Full-page review screenshot under a stable per-area name (not a pixel assertion). */
  async captureForReview(name: string = this.area): Promise<void> {
    await this.page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
  }
}

/** The constructor-with-statics shape the registry holds (page-object classes, not instances). */
export interface AdminPageClass {
  new (page: Page): AdminPage;
}

export type { Locator, Page };
