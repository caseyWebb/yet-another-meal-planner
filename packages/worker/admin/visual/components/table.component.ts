// A tabular region — the panel renders row-shaped data three ways (a Basecoat `table.table`'s
// `<tr>`s, an ItemGroup's `.item`/`a.item-link` rows, the Logs `details.log-entry` disclosures),
// and this component owns row-by-text lookup across all of them so a lens restyle lands here,
// not in page objects. Owns no page-specific text — page objects pass the seeded literals in.
import { expect, type Locator } from "@playwright/test";

const ROW_SELECTOR = "tr, a.item-link, details.log-entry, .item";

export class TableComponent {
  constructor(private readonly root: Locator) {}

  row(text: string): Locator {
    return this.root.locator(ROW_SELECTOR, { hasText: text }).first();
  }

  async expectRow(text: string): Promise<void> {
    await expect(this.row(text)).toBeVisible();
  }
}
