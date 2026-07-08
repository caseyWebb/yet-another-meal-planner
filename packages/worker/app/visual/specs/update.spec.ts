// The prompt-to-reload / version-skew UX (member-app-offline D7, D11). Service workers
// are BLOCKED here so `page.route` interception is classical — the harness stamps both
// sides `pw-harness`, and this spec fabricates a DIFFERING `X-App-Build` to drive the
// skew tap.
//
// HONEST SPLIT (recorded per D11): the reload banner is driven by `needRefresh` — a
// genuinely WAITING second service-worker build — which is library-provided
// (vite-plugin-pwa's registerSW contract) and NOT fabricated here (it would need two
// full builds swapped mid-test; the SW-side offline reality is asserted for real by
// offline.spec.ts). What this spec owns is the deterministic negative: a bare
// `X-App-Build` mismatch must NEVER prompt on its own — it only nudges a bounded SW
// update check — so the member never sees a "new version" banner the app can't deliver.
import { test, expect } from "../fixtures";

test.use({ serviceWorkers: "block" });

test("a build skew never prompts on its own — the header only nudges an update check", async ({
  page,
  asMember,
  shellPage,
}) => {
  // Advertise a DIFFERING stamped build on EVERY /api response, so the skew tap fires
  // repeatedly — the exact condition under which a header-driven banner would (wrongly)
  // appear and, on reload, loop. With no waiting worker there is no `needRefresh`, so
  // the banner must stay absent no matter how many responses skew.
  await page.route("**/api/**", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), "x-app-build": "pw-other-build" } });
  });

  await asMember();
  await shellPage.landmark();
  await expect(shellPage.reloadBanner()).toHaveCount(0);

  // Navigating fires fresh /api queries through the same tap — still no false prompt.
  await shellPage.navTo("Meal plan");
  await expect(shellPage.reloadBanner()).toHaveCount(0);
  await shellPage.navTo("Grocery list");
  await expect(shellPage.reloadBanner()).toHaveCount(0);
});

test("equal stamped ids stay inert — no banner at the harness baseline", async ({ loginPage, shellPage }) => {
  // Both sides carry the one pw-harness id (setup.mjs): the login screen's version
  // check and every later tap must signal nothing.
  await loginPage.goto();
  await loginPage.landmark();
  await expect(shellPage.reloadBanner()).toHaveCount(0);
});
