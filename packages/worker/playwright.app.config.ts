// Playwright harness for the MEMBER APP (app-ui-testing): the blocking functional gate
// over the browser-level member surface, sibling and mirror of playwright.config.ts (the
// admin suite). Drives the REAL SPA — built into assets/ and served by a local
// `wrangler dev` (app/visual/setup.mjs builds app + admin, migrates, seeds, serves) — in
// Chromium. Specs live in app/visual/specs and consume the page-object fixtures
// (app/visual/fixtures.ts); areas capture full-page review screenshots into
// app/visual/.screenshots/ (published as the PR's app-ui sticky comment). No pixel
// baselines: the gate is functional assertions; visual review is human.
//
// Member sessions are established DETERMINISTICALLY, never by per-test UI login: setup.mjs
// seeds a server-side session and writes it as a Playwright storageState, so the `authed`
// project's specs start pre-authenticated and issue zero login HTTP (app-ui-suite-
// deterministic-auth). The `noauth` project keeps the real login/enrollment/signup UI on its
// dedicated login/signup/passkey specs — with no storageState, they genuinely start logged
// out. A globalSetup warmup blocks workers until an AUTHENTICATED request succeeds, so a cold
// Worker never lets the first spec race a still-warming KV/D1 binding.
//
// Local run: `aubr test:app`. Web-session sandboxes set
// PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; PW_CHROMIUM_PATH remains the bare-binary
// escape hatch. PW_APP_PORT (default 8788) keeps this suite off the admin suite's 8787
// so the two can coexist.
import { defineConfig } from "@playwright/test";
import { SEED } from "./admin/visual/seed.mjs";

const PORT = Number(process.env.PW_APP_PORT || 8788);
const localChromium = process.env.PW_CHROMIUM_PATH;

// The dedicated real-auth-UI specs run in the logged-out `noauth` project; every other spec
// runs pre-authenticated in `authed`. Kept in one place so the two projects stay complements.
const REAL_AUTH_UI_SPECS = ["**/login.spec.ts", "**/signup.spec.ts", "**/passkey.spec.ts"];
// The storageState the `authed` project loads, written by setup.mjs. Resolved relative to
// this config's directory (packages/worker), the same cwd setup.mjs writes it from.
const AUTHED_STORAGE_STATE = `app/visual/.auth/${SEED.members.active}.json`;

export default defineConfig({
  testDir: "app/visual/specs",
  fullyParallel: false,
  workers: 1,
  // One CI retry as a safety net for residual environmental flakes — the suite drives one
  // long-lived `wrangler dev`, and Playwright tearing down per-test contexts with in-flight
  // /api requests logs benign workerd "Broken pipe" noise. This absorbs a genuine flake but
  // NEVER masks a real regression (a deterministic failure fails both attempts); `trace`
  // below retains the failing attempt so any recurrence is diagnosable, not silently retried.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "app/visual/.results",
  // The authenticated warmup gate: no worker starts a test until `GET /api/session` answers
  // 200 for the seeded member session (proves the KV-session read + tenant allowlist + D1 are
  // warm on a cold Worker, so first requests don't flake).
  globalSetup: "./app/visual/global-setup.mjs",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1100, height: 900 },
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    ...(localChromium ? { launchOptions: { executablePath: localChromium, args: ["--no-sandbox"] } } : {}),
  },
  projects: [
    // The real login/enrollment/signup UI, genuinely logged out (no storageState) — the ONLY
    // specs that exercise `POST /api/session` and the 10/min limiter path.
    {
      name: "noauth",
      testMatch: REAL_AUTH_UI_SPECS,
      use: { browserName: "chromium", storageState: undefined },
    },
    // Every other spec, pre-authenticated as the seeded member via storageState — no login HTTP.
    {
      name: "authed",
      testIgnore: REAL_AUTH_UI_SPECS,
      use: { browserName: "chromium", storageState: AUTHED_STORAGE_STATE },
    },
  ],
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
