---
name: admin-ui
description: Run the admin panel's Playwright suite and review its per-area screenshots. Use after any change to the admin panel (src/admin/**, its styles/islands, or the harness), and before checking the "Admin UI tests" box in the PR template. Extends page objects/specs first when a surface was added or changed.
license: MIT
metadata:
  author: groceries-agent
  version: "1.0"
---

Run the browser-level admin-UI gate locally and review what the panel actually renders. This is the loop the PR template's **Admin UI tests** consideration attests to: page objects + specs extended, suite green, screenshots reviewed.

## Steps

1. **Extend the harness first if a surface changed.** A new or changed admin area/sub-surface means updating `packages/worker/admin/visual/` BEFORE running: its page object under `pages/` (route, SSR landmark, expected fixtures), a `registry.ts` entry for a new top-nav area, the fixture in `fixtures.ts`, and a `seed.mjs` block when the surface needs data. The contribution guide is the "Testing — the Playwright harness" section of `packages/worker/src/admin/CLAUDE.md`.

2. **Run the suite** from `packages/worker`:

   ```bash
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers aubr test:admin
   ```

   Web-session sandboxes pre-install the Chromium build the pinned `@playwright/test` expects under `/opt/pw-browsers`; if the pinned Playwright has outpaced the sandbox image (browser-not-found error), fall back to `npx playwright install chromium` in `packages/worker`. If port 8787 is taken, set `PW_PORT=<port>`. The suite boots `wrangler dev` itself (build + migrate + seed) — don't pre-start one.

3. **Review the screenshots.** The run writes one full-page PNG per area (plus the dialog/sub-surface captures) to `packages/worker/admin/visual/.screenshots/`. Read the PNGs for every area the change could touch and report what changed visually — layout shifts, empty states where the seed should have rendered data, styling regressions. This is the visual-regression review (there is no pixel gate); on the PR, CI republishes the same screenshots as the sticky comment the operator reviews from mobile.

4. **Surface the result.** State suite pass/fail and summarize the visual differences (or "no visible change") so the reviewer knows what the screenshot comment will show before it lands.

## Notes

- The suite is the **blocking** `admin-ui` CI job — a red local run means a red PR.
- Never assert on relative-age text in specs; the seed keeps those labels stable by construction (see `seed.mjs`'s header comment).
- Screenshot names are stable and ASCII (`<area>.png`) — the CI publish step and mobile rendering depend on them.
