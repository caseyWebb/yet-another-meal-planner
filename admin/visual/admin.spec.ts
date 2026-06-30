// Admin panel visual + smoke spec (operator-admin, Phase 8). For each area: a functional
// assertion (the area's heading is visible — stable across browser versions) plus a full-page
// screenshot (`toHaveScreenshot` compares against the committed baseline; `screenshot: "on"`
// also captures it as a CI artifact regardless). Plus the Logs detail opening as a native
// <dialog>. The vitest suite is the functional gate; this is the browser-level visual aid.
import { test, expect } from "@playwright/test";

const AREAS: ReadonlyArray<readonly [name: string, path: string, heading: string]> = [
  ["status", "/admin", "Service health"],
  ["members", "/admin/members", "Members"],
  ["data", "/admin/data", "Recipes"],
  ["usage", "/admin/usage", "Usage"],
  ["logs", "/admin/logs/discovery", "Discovery"],
  ["config", "/admin/config", "Discovery calibration"],
];

for (const [name, path, heading] of AREAS) {
  test(`${name} area renders`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

test("logs detail opens as a native dialog", async ({ page }) => {
  await page.goto("/admin/logs/discovery");
  await page.locator(".entry-row.has-detail").first().click();
  // The native <dialog> opened (robust check; its element box can read oddly to visibility heuristics).
  await expect(page.locator("dialog.dialog")).toHaveJSProperty("open", true);
  await expect(page).toHaveScreenshot("logs-dialog.png");
});
