// Discovery (/admin/discovery) — the candidate-pipeline view (stat strip, filter pills,
// progression-track cards); Scrapers is its sub-page. Fixtures: SEED.discovery rows in
// discovery_log — a retryable error (non-null next_retry_at → Retry/Delete buttons), a
// dietary-gated skip, and an import — see seed.mjs.
import { expect, type Page } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";

export class DiscoveryPage extends AdminPage {
  readonly path = "/admin/discovery";
  readonly area = "discovery";

  async landmark(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Discovery" })).toBeVisible();
  }

  /** A seeded candidate's card is on the pipeline (by its title). */
  async expectCandidate(title: string = SEED.discovery.errTitle): Promise<void> {
    await expect(this.page.getByText(title).first()).toBeVisible();
  }

  scrapers(): ScrapersPage {
    return new ScrapersPage(this.page);
  }
}

/** Discovery › Scrapers (/admin/discovery/scrapers) — the walled-source ingest liveness view.
 *  No fixtures: with zero ingest keys it renders its explicit "No scrapers yet" empty state
 *  (minting a key would require a real key hash — out of the seed's scope by design), so the
 *  landmark is the unconditional Throughput section label, not the liveness grid's. */
export class ScrapersPage extends AdminPage {
  readonly path = "/admin/discovery/scrapers";
  readonly area = "discovery-scrapers";

  constructor(page: Page) {
    super(page);
  }

  async landmark(): Promise<void> {
    await expect(this.page.locator("p.group-label", { hasText: "Throughput" })).toBeVisible();
  }
}
