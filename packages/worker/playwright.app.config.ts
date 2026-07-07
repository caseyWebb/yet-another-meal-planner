// Playwright harness for the MEMBER APP (app-ui-testing): the blocking functional gate
// over the browser-level member surface, sibling and mirror of playwright.config.ts (the
// admin suite). Drives the REAL SPA — built into assets/ and served by a local
// `wrangler dev` (app/visual/setup.mjs builds app + admin, migrates, seeds, serves) — in
// Chromium. Specs live in app/visual/specs and consume the page-object fixtures
// (app/visual/fixtures.ts); areas capture full-page review screenshots into
// app/visual/.screenshots/ (published as the PR's app-ui sticky comment). No pixel
// baselines: the gate is functional assertions; visual review is human.
//
// Local run: `aubr test:app`. Web-session sandboxes set
// PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; PW_CHROMIUM_PATH remains the bare-binary
// escape hatch. PW_APP_PORT (default 8788) keeps this suite off the admin suite's 8787
// so the two can coexist.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PW_APP_PORT || 8788);
const localChromium = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "app/visual/specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "app/visual/.results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1100, height: 900 },
    screenshot: "only-on-failure",
    ...(localChromium ? { launchOptions: { executablePath: localChromium, args: ["--no-sandbox"] } } : {}),
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // Builds the SPA + admin bundle into assets/, migrates + seeds the local D1/KV, then
    // serves via wrangler dev. Readiness is /health — a Worker route, so it proves the
    // Worker (not just the asset layer) is up. Long-running (wrangler dev is the server).
    command: "node app/visual/setup.mjs",
    url: `http://127.0.0.1:${PORT}/health`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
});
