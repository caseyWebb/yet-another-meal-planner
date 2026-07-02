# Admin UI harness (`admin-ui-testing`)

Playwright drives the real admin panel in Chromium against a seeded local `wrangler dev`. It is
the **blocking browser-level gate** for the panel (CI's `admin-ui` job): every top-nav area
asserts its landmark alongside the shared shell + health dock, the native dialogs (Members
invite, Normalize override/add-alias) open for real, and every area captures a full-page review
screenshot. The vitest suite (`aubr test`) remains the functional gate for Worker logic; this
harness gates the browser-level admin surface.

There is **no pixel-snapshot gating**: no baselines are committed and nothing fails on image
drift. Visual regression review is human — over the screenshots this harness produces, which CI
publishes inline on the PR (see below).

## Layout

```
fixtures.ts       # the extended `test` specs import — one fixture per page object
registry.ts       # ordered all-areas list the smoke spec iterates
seed.mjs          # deterministic D1/KV fixtures + the literals page objects assert on
seed.d.mts        # hand-maintained types for the seed literals (keep in lockstep)
setup.mjs         # webServer entrypoint: build → migrate → seed → wrangler dev
pages/            # one page object per area (base.page.ts is the shell contract)
components/       # shared shell pieces: nav, health dock, stat tiles, dialogs, tables
specs/            # smoke (all areas), members, normalize, navigation
.screenshots/     # per-area review PNGs (gitignored; stable ASCII names)
.results/         # Playwright output (gitignored)
```

How to add coverage for a new admin surface — and the landmark/determinism rules — live in the
"Testing" section of [`../../src/admin/CLAUDE.md`](../../src/admin/CLAUDE.md).

## Run it

```bash
aubr test:admin                                        # from packages/worker; boots everything itself
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers aubr test:admin   # web-session sandboxes (pre-installed Chromium)
PW_PORT=8788 aubr test:admin                           # when 8787 is taken
```

`playwright.config.ts`'s `webServer` runs `setup.mjs`: builds the admin bundle, applies the D1
migrations to the **local** SQLite, applies `seed.mjs` (D1 rows + the tenant/OAuth/Kroger KV
entries; timestamps relative to the run's clock so relative-age labels render stable text), and
serves with `ADMIN_DEV_BYPASS`. All local + offline. If the pinned `@playwright/test` has
outpaced the sandbox's pre-installed browsers, `npx playwright install chromium` fetches the
matching build; `PW_CHROMIUM_PATH` points at a bare Chromium binary as the last resort.

## CI

The `admin-ui` job in `.github/workflows/ci.yml` runs the suite as a blocking check on every
PR/push (browser cached by lockfile hash). On a **same-repo PR touching admin-UI paths**
(`src/admin/`, this harness, `scripts/build-admin.mjs`, `playwright.config.ts`), the job pushes
`.screenshots/*.png` to the `admin-screenshots` orphan branch under `pr-<n>/` and upserts **one**
sticky PR comment (`<!-- admin-ui-screenshots -->`) of commit-SHA-pinned raw images — they render
inline on github.com and in the GitHub mobile app. Fork PRs (read-only token) skip the publish;
the artifact upload (report + results + screenshots) covers every run. A closed PR's directory
is pruned from the branch by `admin-screenshots-prune.yml`. Merge-blocking once `admin-ui` is a
required status check on `main` (a one-time repo setting, like `pr-checklist`).
