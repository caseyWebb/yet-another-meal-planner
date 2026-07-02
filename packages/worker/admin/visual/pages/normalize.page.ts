// Normalization (/admin/normalize) — the ingredient-identity audit surface: Decisions / Queue /
// Aliases / Reconcile / Nodes tabs (tab = query param, every combination deep-linkable), plus
// the Override and Add-alias native dialogs (hydrated by the Normalize island).
// Fixtures: SEED.normalize — an ingredient_identity node + alias row, a normalization-log
// decision (its row carries the Override button), and a queued novel term — see seed.mjs.
import { expect, type Locator } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";
import { DialogComponent } from "../components/dialog.component";

export type NormalizeTab = "decisions" | "audits" | "queue" | "aliases" | "reconcile" | "nodes";

export class NormalizePage extends AdminPage {
  readonly path = "/admin/normalize";
  readonly area = "normalize";

  async landmark(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Normalization" })).toBeVisible();
  }

  /** Deep-link to a tab (tab state is route state — no client-side tab switching). */
  async gotoTab(tab: NormalizeTab): Promise<void> {
    await this.goto(tab === "decisions" ? this.path : `${this.path}?tab=${tab}`);
  }

  /** The Reconcile tab's convergence card (the grocery/pantry key-reconcile observability). */
  async expectReconcileCard(): Promise<void> {
    await expect(this.page.locator(".rk-title", { hasText: "grocery / pantry reconcile" })).toBeVisible();
  }

  // --- The Audits tab (admin-audit-observability): backlog-burndown hero + pass cards +
  // restorations log + merge-rejection memory. All SSR, time-free landmarks.

  /** The Audits tab's convergence surface: the burndown hero + the three pass cards. */
  async expectAuditsSurface(): Promise<void> {
    await expect(this.page.locator(".rk-title", { hasText: "audit backlog" })).toBeVisible();
    for (const pass of ["alias audit", "edge audit", "sku-cache re-key"]) {
      await expect(this.page.locator(".au-pass-name", { hasText: pass })).toBeVisible();
    }
  }

  /** A restorations-log entry for a revisited edge (asserted by its from-endpoint). */
  async expectRestoration(edge: { from: string; to: string }): Promise<void> {
    await expect(this.page.locator(".au-rst", { hasText: edge.from }).first()).toBeVisible();
  }

  /** A merge-rejection row for a co-resolution pair under backoff. */
  async expectRejection(pair: { a: string; b: string }): Promise<void> {
    await expect(this.page.locator(".au-rej-pair", { hasText: pair.a }).first()).toBeVisible();
  }

  // --- The Decisions Terms/Edges stream segment (stream = query param, deep-linkable).

  /** Deep-link to the Decisions › Edges stream. */
  async gotoEdgesStream(): Promise<void> {
    await this.goto(`${this.path}?stream=edges`);
  }

  /** The Terms/Edges segment control on the Decisions tab. */
  get streamSegment(): Locator {
    return this.page.locator(".nz-stream-seg");
  }

  /** An edge-decision card carrying the expected outcome badge ("Kept" / "Dropped"). */
  async expectEdgeDecision(edge: { from: string; to: string }, outcome: "Kept" | "Dropped"): Promise<void> {
    const card = this.page
      .locator(".ec-card", { hasText: edge.from })
      .filter({ has: this.page.locator(".nz-badge", { hasText: outcome }) })
      .first();
    await expect(card).toBeVisible();
  }

  /** Follow a revisited drop's "see Restorations" pointer into the Audits tab. */
  async followRevisitedPointer(): Promise<void> {
    await this.page.locator("a.ec-restored").first().click();
    await this.page.waitForURL(/tab=audits/);
  }

  /** The seeded decision row's Override trigger (Decisions tab). */
  get overrideTrigger(): Locator {
    return this.page.locator(`[data-action="override"][data-term="${SEED.normalize.decisionTerm}"]`);
  }

  /** The Aliases tab's Add-mapping trigger. */
  get addAliasTrigger(): Locator {
    return this.page.locator('[data-action="alias-add"]');
  }

  // --- The Aliases tab's mappings-only listing (alias-target-convergence): real mappings
  // (variant ≠ id) render as rows; canonical self-entries collapse into a count chip.

  /** An alias row's variant cell, matched exactly (a variant may be a substring of another). */
  aliasRowVariant(variant: string): Locator {
    return this.page.locator(".nz-al-table .nz-al-variant").filter({ hasText: new RegExp(`^${variant}$`) });
  }

  /** The canonical self-entry count chip beside the source pills. */
  get selfEntryChip(): Locator {
    return this.page.locator(".nz-al-selfcount");
  }

  /** A real mapping lists; a canonical self-entry never renders a row, only the chip's count. */
  async expectMappingsOnly(mappingVariant: string, selfVariant: string, selfCount: number): Promise<void> {
    await expect(this.aliasRowVariant(mappingVariant)).toBeVisible();
    await expect(this.aliasRowVariant(selfVariant)).toHaveCount(0);
    await expect(this.selfEntryChip).toHaveText(`${selfCount} canonical ${selfCount === 1 ? "entry" : "entries"}`);
  }

  overrideDialog(): DialogComponent {
    return new DialogComponent(this.page.locator("dialog#nz-override"));
  }

  addAliasDialog(): DialogComponent {
    return new DialogComponent(this.page.locator("dialog#nz-add"));
  }

  async openOverrideDialog(): Promise<DialogComponent> {
    const dialog = this.overrideDialog();
    await dialog.openVia(this.overrideTrigger);
    return dialog;
  }

  async openAddAliasDialog(): Promise<DialogComponent> {
    const dialog = this.addAliasDialog();
    await dialog.openVia(this.addAliasTrigger);
    return dialog;
  }
}
