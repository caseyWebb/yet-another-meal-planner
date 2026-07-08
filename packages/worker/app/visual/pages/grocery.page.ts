// Grocery (member-app-core 7.7 + member-app-grocery): the derived to-buy view (virtual
// rows with plan attribution, pantry coverage + verify nudges, materialize-on-pin, the
// underived notice), the P1 stored-row interactions (category groups, bottom add-row,
// explicit in-cart set, remove, Clear purchased), the order panel (preview →
// disposition → commit; driven via route interception in the order specs), and the
// user-asserted Mark order placed advance. Also owns the API-level plan/list
// provisioning the specs use (the propose page object's pattern) so each spec pins its
// own exact derivation inputs.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class GroceryPage extends AppPage {
  readonly path = "/grocery";
  readonly area = "grocery";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("grocery-page")).toBeVisible();
  }

  // --- provisioning (through the browser's session fetch) -----------------------

  /** Converge the meal plan to EXACTLY these recipes (the derivation's input). */
  async setPlan(recipes: string[]): Promise<void> {
    await this.page.evaluate(async (want: string[]) => {
      const res = await fetch("/api/plan");
      const { planned } = (await res.json()) as { planned: { recipe: string }[] };
      const ops: unknown[] = [];
      for (const p of planned) if (!want.includes(p.recipe)) ops.push({ op: "remove", recipe: p.recipe });
      for (const r of want) if (!planned.some((p) => p.recipe === r)) ops.push({ op: "add", recipe: r });
      if (!ops.length) return;
      await fetch("/api/plan/ops", {
        method: "POST",
        headers: { "content-type": "application/json", "X-App-Csrf": "1" },
        body: JSON.stringify({ ops }),
      });
    }, recipes);
  }

  /** Remove a grocery row by name through the real API (spec cleanup/provisioning). */
  async removeRow(name: string): Promise<void> {
    await this.page.evaluate(async (n: string) => {
      await fetch(`/api/grocery/items/${encodeURIComponent(n)}`, { method: "DELETE", headers: { "X-App-Csrf": "1" } });
    }, name);
  }

  /** Add a grocery row through the real API (spec provisioning). */
  async addRow(name: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.page.evaluate(
      async (input: Record<string, unknown>) => {
        await fetch("/api/grocery/items", {
          method: "POST",
          headers: { "content-type": "application/json", "X-App-Csrf": "1" },
          body: JSON.stringify(input),
        });
      },
      { name, ...extra },
    );
  }

  /** Set a row's status through the real API (in_cart provisioning for the order specs). */
  async setRowStatus(name: string, status: "active" | "in_cart"): Promise<void> {
    await this.page.evaluate(
      async ([n, s]: [string, string]) => {
        await fetch(`/api/grocery/items/${encodeURIComponent(n)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "X-App-Csrf": "1" },
          body: JSON.stringify({ status: s }),
        });
      },
      [name, status] as [string, string],
    );
  }

  /** Return every in_cart row to active (a clean stale-cart slate for the order specs). */
  async deactivateInCart(): Promise<void> {
    await this.page.evaluate(async () => {
      const res = await fetch("/api/grocery");
      const { items } = (await res.json()) as { items: { name: string; status: string }[] };
      for (const it of items) {
        if (it.status !== "in_cart") continue;
        await fetch(`/api/grocery/items/${encodeURIComponent(it.name)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "X-App-Csrf": "1" },
          body: JSON.stringify({ status: "active" }),
        });
      }
    });
  }

  /** A row's stored status via the API list read (undefined when absent). */
  async rowStatus(name: string): Promise<string | undefined> {
    return this.page.evaluate(async (n: string) => {
      const res = await fetch("/api/grocery");
      const { items } = (await res.json()) as { items: { name: string; status: string }[] };
      return items.find((i) => i.name.toLowerCase() === n.toLowerCase())?.status;
    }, name);
  }

  // --- the to-buy list -----------------------------------------------------------

  /** A to-buy line (category groups only — the in-cart group renders the same name
   *  separately during transitions, so the two locators stay strict-mode disjoint). */
  item(name: string): Locator {
    return this.page.locator(
      `[data-testid^="grocery-group-"] [data-testid="grocery-item"][data-name="${name}"]`,
    );
  }

  /** Any rendering of the name — to-buy or in-cart (absence assertions). */
  anyItem(name: string): Locator {
    return this.page.locator(`[data-testid="grocery-item"][data-name="${name}"]`);
  }

  /** The in-cart group's rendering of a row. */
  inCartItem(name: string): Locator {
    return this.page
      .getByTestId("grocery-in-cart")
      .locator(`[data-testid="grocery-item"][data-name="${name}"]`);
  }

  /** Move an in-cart row back to the list (the explicit set's other direction). */
  async uncart(name: string): Promise<void> {
    await this.inCartItem(name).getByTestId("cart-toggle").click();
  }

  async expectOrigin(name: string, origin: "list" | "plan" | "both"): Promise<void> {
    await expect(this.item(name)).toHaveAttribute("data-origin", origin);
  }

  /** The "from your plan" cue on a virtual row. */
  originCue(name: string): Locator {
    return this.item(name).getByTestId("origin-plan");
  }

  /** Pin (materialize) a virtual row — the D6 edit path. */
  async pin(name: string): Promise<void> {
    await this.item(name).getByTestId("grocery-pin").click();
  }

  async toggleCart(name: string): Promise<void> {
    await this.item(name).getByTestId("cart-toggle").click();
  }

  async expectInCartGroup(name: string): Promise<void> {
    await expect(this.inCartItem(name)).toBeVisible();
  }

  async expectInCategoryGroup(name: string, kind: "grocery" | "household" | "other"): Promise<void> {
    await expect(
      this.page.getByTestId(`grocery-group-${kind}`).locator(`[data-testid="grocery-item"][data-name="${name}"]`),
    ).toBeVisible();
  }

  async addItem(name: string, qty?: string): Promise<void> {
    await this.page.getByLabel("Item name").fill(name);
    if (qty) await this.page.getByLabel("Quantity").fill(qty);
    await this.page.getByLabel("Item name").press("Enter");
  }

  async clearPurchased(): Promise<void> {
    await this.page.getByTestId("clear-purchased").click();
  }

  async markOrderPlaced(): Promise<void> {
    await this.page.getByTestId("mark-order-placed").click();
  }

  underivedNotice(): Locator {
    return this.page.getByTestId("grocery-underived");
  }

  // --- pantry coverage -----------------------------------------------------------

  coveredItem(name: string): Locator {
    return this.page.locator(`[data-testid="pantry-have-item"][data-name="${name}"]`);
  }

  staleFlag(name: string): Locator {
    return this.coveredItem(name).getByTestId("ph-stale-flag");
  }

  async verifyCovered(name: string): Promise<void> {
    await this.coveredItem(name).getByTestId("ph-verify").click();
  }

  async buyFresh(name: string): Promise<void> {
    await this.coveredItem(name).getByTestId("ph-buy").click();
  }

  // --- the order panel -----------------------------------------------------------

  async openOrder(): Promise<void> {
    await this.page.getByTestId("order-open").click();
  }

  orderPanel(): Locator {
    return this.page.getByTestId("order-panel");
  }

  orderLine(name: string): Locator {
    return this.page.locator(`[data-testid="order-line"][data-name="${name}"]`);
  }

  async excludeLine(name: string): Promise<void> {
    await this.orderLine(name).getByTestId("order-exclude").click();
  }

  async setLineQty(name: string, qty: number): Promise<void> {
    await this.orderLine(name).getByTestId("order-qty").locator("input").fill(String(qty));
  }

  checkpointItem(name: string): Locator {
    return this.page.locator(`[data-testid="order-checkpoint-item"][data-name="${name}"]`);
  }

  async pickCandidate(name: string, sku: string): Promise<void> {
    await this.checkpointItem(name).locator(`[data-testid="order-cand"][data-sku="${sku}"]`).check();
  }

  partialRow(name: string): Locator {
    return this.page.locator(`[data-testid="order-partial"][data-name="${name}"]`);
  }

  async confirmPartial(name: string): Promise<void> {
    await this.partialRow(name).getByTestId("order-partial-confirm").check();
  }

  staleWarning(): Locator {
    return this.page.getByTestId("order-stale-warning");
  }

  async ackStaleCart(): Promise<void> {
    await this.page.getByTestId("order-stale-ack").check();
  }

  commitButton(): Locator {
    return this.page.getByTestId("order-commit");
  }

  async commitOrder(): Promise<void> {
    await this.commitButton().click();
  }

  resultCart(): Locator {
    return this.page.getByTestId("order-result-cart");
  }

  resultList(): Locator {
    return this.page.getByTestId("order-result-list");
  }

  relinkButton(): Locator {
    return this.page.getByTestId("order-relink");
  }

  /** The W3 boundary check, through the BROWSER's session-authenticated fetch
   *  (the __Host- session cookie only rides browser requests — Playwright's
   *  request context refuses Secure cookies over http). */
  async attemptOrderedWrite(name: string): Promise<{ status: number; error: string; ordered_at: string | null }> {
    return this.page.evaluate(async (itemName: string) => {
      const res = await fetch(`/api/grocery/items/${encodeURIComponent(itemName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "X-App-Csrf": "1" },
        body: JSON.stringify({ status: "ordered" }),
      });
      const body = (await res.json()) as { error?: string; item?: { ordered_at: string | null } };
      return { status: res.status, error: body.error ?? "", ordered_at: body.item?.ordered_at ?? null };
    }, name);
  }
}
