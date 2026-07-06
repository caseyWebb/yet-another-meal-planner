// Discovery (/admin/discovery) — the candidate-pipeline view (stat strip, filter pills,
// progression-track cards); Satellites is its sub-page. Fixtures: SEED.discovery rows in
// discovery_log — a retryable error (non-null next_retry_at → Retry/Delete buttons), a
// dietary-gated skip, and an import — see seed.mjs.
import { expect, type Locator, type Page } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";
import { DialogComponent } from "../components/dialog.component";

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

  satellites(): SatellitesPage {
    return new SatellitesPage(this.page);
  }
}

/** Discovery › Satellites (/admin/discovery/satellites) — the satellite ingest liveness view + the
 *  source-health audit (satellite-source-audit). The landmark is the unconditional Throughput section
 *  label (SSR, time-free). The audit hero SSR-renders the quality dimension for first paint and
 *  hydrates client/satellite-audit.tsx for the drill-down + quarantine toggle; the audit accessors
 *  below scope to a source row and retry the toggle click past hydration (time-free assertions only). */
export class SatellitesPage extends AdminPage {
  readonly path = "/admin/discovery/satellites";
  readonly area = "discovery-satellites";

  constructor(page: Page) {
    super(page);
  }

  async landmark(): Promise<void> {
    await expect(this.page.locator("p.group-label", { hasText: "Throughput" })).toBeVisible();
  }

  /** A source's audit row, scoped by its name (the `.ig-srcx-name` cell). */
  sourceRow(source: string): Locator {
    return this.page.locator(".ig-srcx", { has: this.page.locator(".ig-srcx-name", { hasText: source }) });
  }

  /** The accept/fail quality label for a source ("92% ok" / "60% failing" / "rejecting"). */
  qualityLabel(source: string): Locator {
    return this.sourceRow(source).locator(".ig-qual-lbl");
  }

  /** The degrading-source quarantine recommendation chip. */
  recommendationChip(source: string): Locator {
    return this.sourceRow(source).locator(".ig-rec");
  }

  /** The recommendation chip's "Quarantine" button (opens the confirm dialog). */
  quarantineButton(source: string): Locator {
    return this.sourceRow(source).locator(".ig-rec-btn");
  }

  /** The held-state block on a quarantined source. */
  quarantinedBlock(source: string): Locator {
    return this.sourceRow(source).locator(".ig-quar");
  }

  /** The held block's "Un-quarantine" button. */
  unquarantineButton(source: string): Locator {
    return this.sourceRow(source).locator(".ig-quar-undo");
  }

  /** A source's rejection-ledger drill-down (revealed after its head is toggled). */
  drilldown(source: string): Locator {
    return this.sourceRow(source).locator(".ig-drill");
  }

  /** Toggle a source's drill-down open (retry the head click past island hydration). */
  async openDrilldown(source: string): Promise<Locator> {
    const drill = this.drilldown(source);
    const head = this.sourceRow(source).locator(".ig-srcx-head");
    await expect(async () => {
      await head.click();
      await expect(drill).toBeVisible({ timeout: 1_000 });
    }).toPass();
    return drill;
  }

  /** The quarantine confirm modal (native <dialog>, scoped by its labelled title). */
  quarantineConfirm(): DialogComponent {
    return new DialogComponent(this.page.locator('dialog.dialog[aria-labelledby="satellite-quarantine-title"]'));
  }

  /** Open the confirm dialog from a source's recommendation chip (hydration-safe retry). */
  async openQuarantineConfirm(source: string): Promise<DialogComponent> {
    const dialog = this.quarantineConfirm();
    await dialog.openVia(this.quarantineButton(source));
    return dialog;
  }

  /** Confirm a pending quarantine (the confirm dialog's destructive submit). */
  async confirmQuarantine(): Promise<void> {
    await this.quarantineConfirm().root.getByRole("button", { name: "Quarantine source" }).click();
  }

  /** Un-quarantine a held source, retrying the click past island hydration (asserts it releases). */
  async unquarantine(source: string): Promise<void> {
    const held = this.quarantinedBlock(source);
    await expect(async () => {
      await this.unquarantineButton(source).click();
      await expect(held).toBeHidden({ timeout: 1_000 });
    }).toPass();
  }
}
