// Shell navigation + serving dispatch: all nine area pills render and each routes to its area
// with the active state (client-side router navigations — the URL still updates), plus the
// Worker-side dispatch guarantees: a missing admin asset 404s, /admin/api stays JSON-or-404
// (never the shell), and a deep link is served the shell and resolves.
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

test("the shell footer shows the deployed build on every area", async ({ statusPage }) => {
  // The footer lives in the root layout (reads the shared ["status"] query), so it persists
  // across every client-side area navigation — assert that, don't just infer it. The harness
  // Worker has no APP_BUILD → "dev"; assert the stable labels, never the value.
  await statusPage.goto();
  await expect(statusPage.footer).toContainText("build");
  await expect(statusPage.footer).toContainText("contract");
  for (const { label } of NAV_AREAS.slice(1)) {
    await statusPage.nav.goto(label);
    await expect(statusPage.footer).toContainText("build");
  }
});

test("a missing admin static asset 404s instead of falling back to a SPA shell", async ({ page }) => {
  // The merged assets root's `not_found_handling: "single-page-application"` answers a genuine
  // miss with the member SPA's index.html at 200 unless the admin app's asset namespace guards
  // against it (src/admin/app.ts) — a renamed chunk must 404 for real.
  const res = await page.request.get("/admin/assets/does-not-exist.js");
  expect(res.status()).toBe(404);
});

test("an /admin/api read passes through as JSON, never the shell (dispatch order)", async ({ page }) => {
  // Guards D2's dispatch: API routes match BEFORE the catch-all shell serving.
  const res = await page.request.get("/admin/api/status");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
});

test("an unknown /admin/api route is a plain 404, never the shell's HTML", async ({ page }) => {
  // A typo'd or newer-client API path must not read as an expired Access session (D7 keys
  // "HTML on the API surface" to the reload overlay) — the catch-all excludes /admin/api/*.
  const res = await page.request.get("/admin/api/does-not-exist");
  expect(res.status()).toBe(404);
  expect(res.headers()["content-type"] ?? "").not.toContain("text/html");
});

test("a deep link is served the shell and the router resolves it", async ({ page, normalizePage }) => {
  // A hard GET to a client-route URL (not an asset, not an API route) gets the admin shell,
  // whose router renders that surface directly — no redirect loop, no member shell.
  await page.goto("/admin/normalize?tab=audits");
  await normalizePage.expectShell();
  await expect(page).toHaveURL(/\/admin\/normalize\?tab=audits/);
});
