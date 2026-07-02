// The shell's top-level area nav (src/admin/ui/layout.tsx `AREAS`) as a component object: the
// one place the harness knows the nav's labels, hrefs, and active-pill markup. Page objects
// compose it; specs never address `nav.nav` markup directly.
import { expect, type Locator, type Page } from "@playwright/test";

/** Mirrors layout.tsx's AREAS — label and href, in nav order. */
export const NAV_AREAS = [
  { label: "Status", href: "/admin" },
  { label: "Members", href: "/admin/members" },
  { label: "Data", href: "/admin/data" },
  { label: "Insights", href: "/admin/insights" },
  { label: "Usage", href: "/admin/usage" },
  { label: "Discovery", href: "/admin/discovery" },
  { label: "Normalization", href: "/admin/normalize" },
  { label: "Logs", href: "/admin/logs" },
  { label: "Config", href: "/admin/config" },
] as const;

export type NavLabel = (typeof NAV_AREAS)[number]["label"];

export class NavComponent {
  constructor(private readonly page: Page) {}

  private get root(): Locator {
    return this.page.locator("nav.nav");
  }

  link(label: NavLabel): Locator {
    return this.root.getByRole("link", { name: label, exact: true });
  }

  /** All nine area pills are present (the shell rendered whole). */
  async expectRendered(): Promise<void> {
    for (const area of NAV_AREAS) await expect(this.link(area.label)).toBeVisible();
  }

  /** The given area's pill carries the active state. */
  async expectActive(label: NavLabel): Promise<void> {
    await expect(this.link(label)).toHaveClass(/\bactive\b/);
  }

  /** Navigate by clicking the pill (a real cross-document navigation). */
  async goto(label: NavLabel): Promise<void> {
    const href = NAV_AREAS.find((a) => a.label === label)!.href;
    await this.link(label).click();
    await this.page.waitForURL((url) => url.pathname === href);
  }
}
