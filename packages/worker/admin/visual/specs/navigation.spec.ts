// Shell navigation: all nine area pills render and each routes to its area with the active
// state (real cross-document navigations — the panel has no client router).
import { test, expect } from "../fixtures";
import { NAV_AREAS } from "../components/nav.component";

test("nav pills route across every area", async ({ statusPage }) => {
  await statusPage.goto();
  await statusPage.nav.expectRendered();
  for (const { label } of NAV_AREAS.slice(1)) {
    await statusPage.nav.goto(label);
    await statusPage.nav.expectActive(label);
    await statusPage.expectShell();
  }
});

test("a missing admin static asset 404s instead of falling back to the SPA shell", async ({ page }) => {
  // The merged assets root's `not_found_handling: "single-page-application"` answers a genuine
  // miss with the member SPA's index.html at 200 unless app.notFound guards against it (src/admin/app.tsx).
  const res = await page.request.get("/admin/islands/does-not-exist.js");
  expect(res.status()).toBe(404);
});
