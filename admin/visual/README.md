# Admin visual + smoke harness (`operator-admin`)

Playwright drives the real admin panel in a browser against a local `wrangler dev`, for two things:

1. **Smoke / E2E** — each area's heading renders, the Logs detail opens as a native `<dialog>`.
   These assertions are stable across browser versions.
2. **Visual regression** — a full-page `toHaveScreenshot` per area (+ the open dialog), compared
   to the committed baselines under `admin.spec.ts-snapshots/`. Every run also captures a
   screenshot per test (uploaded as a CI artifact).

The functional gate for the panel is the **vitest** suite (`aubr test`), which drives the same
Hono app in-process. This harness is the browser-level visual aid on top.

## Run it

```bash
aubr test:admin                      # run against wrangler dev (Playwright starts/seeds it)
aubr test:admin -- --update-snapshots   # regenerate baselines
```

`playwright.config.ts`'s `webServer` runs `admin/visual/setup.mjs`, which builds the bundle,
applies the D1 migrations to the **local** SQLite, seeds a deterministic discovery-log fixture
(so the Logs dialog has stable content), and serves with `ADMIN_DEV_BYPASS`. All local + offline.

In a sandbox whose only browser is the pre-installed one, point Playwright at it:
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome aubr test:admin`.

## Baselines & CI

Screenshot baselines are **browser-version-specific**. `@playwright/test` pins a Chromium
version that this repo's coding sandbox can't install, so the committed baselines are a **dev
bootstrap** generated with the sandbox's Chromium. CI runs the version Playwright installs (a
different build), so its pixels won't byte-match the bootstrap — the **CI job is therefore
`continue-on-error`** and uploads the screenshots + diffs as PR artifacts (a review aid), while
vitest stays the hard gate.

To make the visual job a true gate: regenerate the baselines in CI's environment
(`aubr test:admin -- --update-snapshots` in the `admin-visual` job, commit the result), then drop
`continue-on-error` from the job in `.github/workflows/ci.yml`.
