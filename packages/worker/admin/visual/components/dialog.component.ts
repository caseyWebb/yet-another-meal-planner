// A native <dialog> (the panel's only modal primitive — Basecoat CSS-only, opened by island
// state via showModal()). `expectOpen` asserts the `open` JS property, the robust check for a
// native dialog (its element box can read oddly to visibility heuristics). `openVia` retries the
// trigger click until the dialog reports open, absorbing island-hydration timing: the click
// handlers attach on hydration, and a click that lands before them is silently lost.
import { expect, type Locator } from "@playwright/test";

export class DialogComponent {
  constructor(readonly root: Locator) {}

  async expectOpen(): Promise<void> {
    await expect(this.root).toHaveJSProperty("open", true);
  }

  /** Click `trigger` until the dialog opens (retry beats a pre-hydration lost click). */
  async openVia(trigger: Locator): Promise<void> {
    await expect(async () => {
      await trigger.click();
      await expect(this.root).toHaveJSProperty("open", true, { timeout: 1_000 });
    }).toPass();
  }

  title(text: string): Locator {
    return this.root.getByRole("heading", { name: text });
  }
}
