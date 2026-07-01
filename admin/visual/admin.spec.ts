// Admin panel visual + smoke spec (operator-admin, redesigned 8-area panel). For each top-level
// area: a functional assertion (the shared `<h1>grocery-agent admin</h1>` shell heading plus an
// area-specific landmark is visible — stable across browser versions) plus a full-page screenshot
// (`toHaveScreenshot` compares against the committed baseline; `screenshot: "on"` also captures
// it as a CI artifact regardless). Plus the Members invite dialog opening as a native <dialog>
// (the panel's remaining native-dialog surface — the old Logs detail dialog was retired when
// Logs became an all-jobs run log using inline <details>/<summary> disclosure, zero client JS).
// The vitest suite is the functional gate; this is the browser-level visual aid.
import { test, expect, type Page } from "@playwright/test";

// Most areas render their own `<h2>`/`<h3>` heading (Members doesn't — its page has only the
// shared shell `<h1>` plus stat tiles and a roster, so it's asserted via the "Invite member"
// button instead, a control unique to that area). Status likewise has no page-owned heading —
// the fidelity pass moved the "Service health" rollup into the shell's global health dock — so
// it's asserted via the "Background jobs" section label instead, a landmark unique to the area.
const AREAS: ReadonlyArray<readonly [name: string, path: string, assert: (page: Page) => Promise<unknown>]> = [
  ["status", "/admin", (page) => expect(page.getByText("Background jobs")).toBeVisible()],
  ["members", "/admin/members", (page) => expect(page.getByRole("button", { name: "Invite member" })).toBeVisible()],
  ["data", "/admin/data", (page) => expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible()],
  ["usage", "/admin/usage", (page) => expect(page.getByRole("heading", { name: "Usage" })).toBeVisible()],
  ["discovery", "/admin/discovery", (page) => expect(page.getByRole("heading", { name: "Discovery" })).toBeVisible()],
  ["logs", "/admin/logs", (page) => expect(page.getByRole("heading", { name: "Logs" })).toBeVisible()],
  ["config", "/admin/config", (page) => expect(page.getByRole("heading", { name: "Calibration" })).toBeVisible()],
];

for (const [name, path, assertArea] of AREAS) {
  test(`${name} area renders`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "grocery-agent admin" })).toBeVisible();
    await assertArea(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

test("members invite opens as a native dialog", async ({ page }) => {
  await page.goto("/admin/members");
  await page.getByRole("button", { name: "Invite member" }).click();
  // The native <dialog> opened (robust check; its element box can read oddly to visibility heuristics).
  await expect(page.locator("dialog.dialog")).toHaveJSProperty("open", true);
  await expect(page).toHaveScreenshot("members-dialog.png");
});
