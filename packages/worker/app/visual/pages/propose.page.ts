// Plan your week (member-app-propose): the propose flow's page object — the intro /
// empty-palette states, the controls row (nights, nudges, freeform), the weather
// strip / no-location chip, slot-card interactions (lock, swap, exclude, facet pins,
// pick list), and commit. Also owns the API-level palette provisioning the specs use:
// the SHARED seed keeps the palette deliberately empty (production's first render),
// so the propose specs create their own vibes through the real member API — against
// vibe ids whose cron-shaped derived vectors the seed pre-planted (D12).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";
import { SEED } from "../../../admin/visual/seed.mjs";

const VIBES = SEED.app.propose.vibes;

export class ProposePage extends AppPage {
  readonly path = "/propose";
  readonly area = "propose";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("propose-page")).toBeVisible();
  }

  // --- palette provisioning (through the browser's session fetch) --------------

  /** Remove EVERY palette vibe (the empty-palette state, regardless of prior specs). */
  async wipePalette(): Promise<void> {
    await this.page.evaluate(async () => {
      const res = await fetch("/api/vibes");
      const { vibes } = (await res.json()) as { vibes: { id: string }[] };
      for (const v of vibes) {
        await fetch(`/api/vibes/${encodeURIComponent(v.id)}`, {
          method: "DELETE",
          headers: { "X-App-Csrf": "1" },
        });
      }
    });
  }

  /** Converge the palette to EXACTLY the two seeded-vector vibes (idempotent). */
  async provisionPalette(): Promise<void> {
    await this.page.evaluate(
      async (want: { id: string; vibe: string }[]) => {
        const res = await fetch("/api/vibes");
        const { vibes } = (await res.json()) as { vibes: { id: string }[] };
        const wantIds = new Set(want.map((w) => w.id));
        for (const v of vibes) {
          if (!wantIds.has(v.id)) {
            await fetch(`/api/vibes/${encodeURIComponent(v.id)}`, { method: "DELETE", headers: { "X-App-Csrf": "1" } });
          }
        }
        const have = new Set(vibes.map((v) => v.id));
        for (const w of want) {
          if (have.has(w.id)) continue;
          const created = await fetch("/api/vibes", {
            method: "POST",
            headers: { "content-type": "application/json", "X-App-Csrf": "1" },
            body: JSON.stringify({ id: w.id, vibe: w.vibe }),
          });
          if (!created.ok && created.status !== 409) throw new Error(`vibe create failed (${created.status})`);
        }
      },
      [VIBES.seafood, VIBES.comfort],
    );
  }

  /** The plan rows as the API serves them — the commit spec's `from_vibe` assertion. */
  async readPlan(): Promise<{ recipe: string; planned_for?: string | null; sides?: string[]; from_vibe?: string | null }[]> {
    return this.page.evaluate(async () => {
      const res = await fetch("/api/plan");
      const { planned } = (await res.json()) as { planned: never[] };
      return planned;
    });
  }

  /** Drop every plan row (so the commit spec owns its before/after). */
  async wipePlan(): Promise<void> {
    await this.page.evaluate(async () => {
      const res = await fetch("/api/plan");
      const { planned } = (await res.json()) as { planned: { recipe: string }[] };
      if (!planned.length) return;
      await fetch("/api/plan/ops", {
        method: "POST",
        headers: { "content-type": "application/json", "X-App-Csrf": "1" },
        body: JSON.stringify({ ops: planned.map((p) => ({ op: "remove", recipe: p.recipe })) }),
      });
    });
  }

  // --- states -------------------------------------------------------------------

  async expectEmptyPalette(): Promise<void> {
    await expect(this.page.getByTestId("propose-empty-palette")).toBeVisible();
  }

  async expectIntro(): Promise<void> {
    await expect(this.page.getByTestId("propose-intro")).toBeVisible();
  }

  async expectNoLocationChip(): Promise<void> {
    await expect(this.page.getByTestId("wx-nolocation")).toBeVisible();
  }

  // --- controls -------------------------------------------------------------------

  async start(): Promise<void> {
    await this.page.getByTestId("propose-start").click();
  }

  async reroll(): Promise<void> {
    await this.page.getByTestId("propose-reroll").click();
  }

  async setNights(n: number): Promise<void> {
    const current = Number(await this.page.getByTestId("nights-n").innerText());
    const btn = n > current ? "nights-inc" : "nights-dec";
    for (let i = 0; i < Math.abs(n - current); i++) await this.page.getByTestId(btn).click();
  }

  async typeFreeform(text: string): Promise<void> {
    await this.page.getByTestId("nudge-freeform").fill(text);
  }

  // --- slots ----------------------------------------------------------------------

  slotCards(): Locator {
    return this.page.getByTestId("slot-card");
  }

  slot(vibeId: string): Locator {
    return this.page.locator(`[data-testid="slot-card"][data-vibe="${vibeId}"]`);
  }

  /** The filled slots' recipe slugs, in render order. */
  async mains(): Promise<string[]> {
    await expect(this.slotCards().first()).toBeVisible();
    await this.settled();
    const slugs = await this.slotCards().evaluateAll((cards) =>
      cards.map((c) => c.getAttribute("data-recipe")).filter((s): s is string => !!s),
    );
    return slugs;
  }

  /** Wait for the live re-query to land (the dimmed placeholder state clears). */
  async settled(): Promise<void> {
    await expect(this.page.getByTestId("slot-list")).not.toHaveAttribute("data-stale", "true");
  }

  /** Run an interaction that re-queries and wait for THAT propose response to land —
   *  deterministic ordering for reads that follow (mains(), why chips, …). */
  async awaitPropose(action: () => Promise<void>): Promise<void> {
    const settled = this.page.waitForResponse(
      (r) => r.url().includes("/api/propose") && !r.url().includes("/weather") && r.request().method() === "POST",
    );
    await action();
    await settled;
  }

  async lock(vibeId: string): Promise<void> {
    await this.slot(vibeId).getByTestId("slot-lock").click();
  }

  async exclude(vibeId: string): Promise<void> {
    await this.slot(vibeId).getByTestId("slot-exclude").click();
  }

  async openSwapMenu(vibeId: string): Promise<void> {
    await this.slot(vibeId).getByTestId("slot-swap").click();
  }

  /** The swap menu's "Something similar" offer (the endpoint's alt_similar title). */
  async swapSimilarOffer(vibeId: string): Promise<string> {
    const item = this.slot(vibeId).getByTestId("slot-swap-similar");
    await expect(item).toBeEnabled();
    return (await item.locator(".menu-sub").innerText()).trim();
  }

  async swapSimilar(vibeId: string): Promise<void> {
    await this.slot(vibeId).getByTestId("slot-swap-similar").click();
  }

  async pinFacet(vibeId: string, kind: "protein" | "cuisine", value: string): Promise<void> {
    await this.slot(vibeId).getByTestId(`facet-${kind}`).click();
    await this.slot(vibeId).getByTestId(`facet-opt-${value}`).click();
  }

  async clearFacet(vibeId: string, kind: "protein" | "cuisine"): Promise<void> {
    await this.slot(vibeId).getByTestId(`facet-clear-${kind}`).click();
  }

  async expectPinned(vibeId: string, kind: "protein" | "cuisine", value: string): Promise<void> {
    const chip = this.slot(vibeId).getByTestId(`facet-${kind}`);
    await expect(chip).toHaveClass(/pinned/);
    await expect(chip).toContainText(value);
  }

  async expectEmptySlot(vibeId: string): Promise<void> {
    await expect(this.slot(vibeId)).toHaveAttribute("data-empty", "true");
    await expect(this.slot(vibeId).getByTestId("slot-empty-reason")).toBeVisible();
  }

  async expectWhy(vibeId: string, text: string | RegExp): Promise<void> {
    await expect(this.slot(vibeId).getByTestId("slot-why")).toContainText(text);
  }

  varietyBar(): Locator {
    return this.page.getByTestId("variety-bar");
  }

  async commit(): Promise<void> {
    await this.page.getByTestId("propose-commit").click();
  }

  async expectToast(text: string | RegExp): Promise<void> {
    await expect(this.page.locator(".toast-content", { hasText: text })).toBeVisible();
  }
}
