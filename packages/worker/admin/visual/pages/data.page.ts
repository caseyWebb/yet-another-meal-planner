// Data (/admin/data) — the read-only explorer with its Recipes / Stores / Guidance sub-nav.
// Fixtures: SEED.recipe row in the recipes table (the list renders D1-indexed and R2-sourced
// slugs; a D1-only row renders with the "orphaned" status chip, which is fine — the local R2
// corpus is empty by design) — see seed.mjs.
import { expect } from "@playwright/test";
import { SEED } from "../seed.mjs";
import { AdminPage } from "./base.page";
import { TableComponent } from "../components/table.component";

export class DataPage extends AdminPage {
  readonly path = "/admin/data";
  readonly area = "data";

  /** The recipe list (an ItemGroup lens — row lookup owned by the table component). */
  get list(): TableComponent {
    return new TableComponent(this.page.locator(".item-group").first());
  }

  async landmark(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  }

  /** The seeded recipe appears as a list row. */
  async expectSeededRecipe(): Promise<void> {
    await this.list.expectRow(SEED.recipe.title);
  }

  async gotoStores(): Promise<void> {
    await this.goto("/admin/data/stores");
    await expect(this.page.getByRole("heading", { name: "Stores" })).toBeVisible();
  }

  async gotoGuidance(): Promise<void> {
    await this.goto("/admin/data/guidance");
    await expect(this.page.getByRole("heading", { name: "Guidance" })).toBeVisible();
  }
}
