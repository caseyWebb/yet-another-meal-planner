// The all-areas smoke: every registered app area renders its landmark and captures its
// full-page review screenshot (published on app-UI PRs). Session-gated areas are reached
// through the seeded invite login first — one seam per area (registry + page object).
import { test } from "../fixtures";
import { AREAS } from "../registry";
import { LoginPage } from "../pages/login.page";
import { SEED } from "../../../admin/visual/seed.mjs";

for (const { area, authed, make } of AREAS) {
  test(`${area} area renders`, async ({ page }) => {
    if (authed) {
      const login = new LoginPage(page);
      await login.goto();
      await login.login(SEED.invite);
    }
    const po = make(page);
    await po.goto();
    await po.landmark();
    await po.captureForReview();
  });
}
