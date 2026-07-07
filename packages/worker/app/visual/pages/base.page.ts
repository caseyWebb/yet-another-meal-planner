// The app harness's page-object base (app-ui-testing), mirroring the admin harness:
// every app area's page object extends AppPage, which owns navigation and the
// review-screenshot capture. Subclasses own their route and their area-unique landmark;
// specs consume page objects via fixtures.ts and never address routes or markup
// directly. Unlike the SSR admin panel, landmarks here render CLIENT-SIDE — Playwright's
// locator auto-wait covers hydration, so landmark assertions need no explicit waits.
import type { Locator, Page } from "@playwright/test";

/** Review screenshots land here (stable ASCII names — the publish step depends on them);
 *  gitignored, uploaded as a CI artifact and pushed to the screenshots branch. */
const SCREENSHOT_DIR = "app/visual/.screenshots";

export abstract class AppPage {
  constructor(protected readonly page: Page) {}

  /** The area's route (subclasses define; the registry's smoke loop uses it). */
  abstract readonly path: string;
  /** The area's registry/screenshot name (ASCII, kebab-case). */
  abstract readonly area: string;
  /** The area-unique assertion proving the surface rendered. */
  abstract landmark(): Promise<void>;

  /** Navigate to the area (or a sub-path of it). */
  async goto(path: string = this.path): Promise<void> {
    await this.page.goto(path);
  }

  /** Full-page review screenshot under a stable per-area name (not a pixel assertion). */
  async captureForReview(name: string = this.area): Promise<void> {
    await this.page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
  }
}

export type { Locator, Page };
