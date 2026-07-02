// Playwright harness for the operator admin panel (admin-ui-testing): the blocking functional
// gate over the browser-level admin surface. Drives the REAL panel in Chromium against a local
// `wrangler dev` (admin/visual/setup.mjs builds, migrates, seeds, serves). Specs live in
// admin/visual/specs and consume the page-object fixtures (admin/visual/fixtures.ts); every
// area captures a full-page review screenshot into admin/visual/.screenshots/ (published as a
// sticky comment on admin-UI PRs — see admin/visual/README.md). No pixel baselines: the gate is
// functional assertions; visual review is human, over the published screenshots.
//
// Local run: `aubr test:admin`. Web-session sandboxes point at the pre-installed browser tree
// with PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (matching the pinned @playwright/test build);
// PW_CHROMIUM_PATH remains the escape hatch for an environment with only a bare Chromium binary.
// CI leaves both unset and installs the pinned browser. PW_PORT picks a non-default port when
// 8787 is taken (setup.mjs serves wherever it says).
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PW_PORT || 8787);
const localChromium = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "admin/visual/specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "admin/visual/.results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1100, height: 900 },
    screenshot: "only-on-failure",
    ...(localChromium ? { launchOptions: { executablePath: localChromium, args: ["--no-sandbox"] } } : {}),
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // Builds the admin bundle, migrates + seeds the local D1/KV, then serves it with the
    // Access dev-bypass. Long-running (wrangler dev is the server).
    command: "node admin/visual/setup.mjs",
    url: `http://127.0.0.1:${PORT}/admin`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
