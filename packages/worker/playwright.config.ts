// Playwright harness for the operator admin panel (operator-admin, design-system Phase 8).
// Drives the REAL panel in a browser against a local `wrangler dev`: each area gets a
// functional smoke assertion (the stable check) plus a full-page screenshot, and
// `toHaveScreenshot` adds pixel-regression where committed baselines exist.
//
// Baselines are browser-version-specific. This repo's sandbox can only run the pre-installed
// Chromium, which differs from the version `@playwright/test` pins (and from CI's), so the
// committed baselines are a dev bootstrap and the CI job (which runs CI's pinned Chromium) is
// continue-on-error + uploads diffs as artifacts. Promote it to a gate by regenerating
// baselines in CI: `aubr test:admin -- --update-snapshots` (see admin/visual/README.md).
//
// Local run: `aubr test:admin`. A sandbox with a pre-installed browser points at it via
// PW_CHROMIUM_PATH; CI leaves it unset and uses the version Playwright installs.
import { defineConfig } from "@playwright/test";

const PORT = 8787;
const localChromium = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "admin/visual",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "admin/visual/.results",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1100, height: 900 },
    screenshot: "on",
    ...(localChromium ? { launchOptions: { executablePath: localChromium, args: ["--no-sandbox"] } } : {}),
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // Builds the admin bundle, migrates + seeds the local D1, then serves it with the
    // Access dev-bypass. Long-running (wrangler dev is the server).
    command: "node admin/visual/setup.mjs",
    url: `http://127.0.0.1:${PORT}/admin`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
