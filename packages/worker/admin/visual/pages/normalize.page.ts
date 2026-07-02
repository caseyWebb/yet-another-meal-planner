// Normalization (/admin/normalize) — the ingredient-identity audit surface: Decisions / Queue /
// Aliases / Reconcile / Nodes tabs (tab = query param, every combination deep-linkable), plus
// the Override and Add-alias native dialogs (hydrated by the Normalize island).
// Fixtures: SEED.normalize — an ingredient_identity node + alias row, a normalization-log
// decision (its row carries the Override button), and a queued novel term — see seed.mjs.
import { expect, type Locator } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";
import { DialogComponent } from "../components/dialog.component";

export type NormalizeTab = "decisions" | "queue" | "aliases" | "reconcile" | "nodes";

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

  /** The seeded decision row's Override trigger (Decisions tab). */
  get overrideTrigger(): Locator {
    return this.page.locator(`[data-action="override"][data-term="${SEED.normalize.decisionTerm}"]`);
  }

  /** The Aliases tab's Add-mapping trigger. */
  get addAliasTrigger(): Locator {
    return this.page.locator('[data-action="alias-add"]');
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
