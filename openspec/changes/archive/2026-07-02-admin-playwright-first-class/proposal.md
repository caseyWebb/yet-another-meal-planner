# admin-playwright-first-class

## Why

The admin panel's browser-level test harness is a second-class aid: one flat spec covering 7 of the panel's 9 top-nav areas (and none of its routed sub-surfaces), a `continue-on-error` CI job that is red on stale pixel baselines (captured with a sandbox Chromium that no longer matches CI's), and no reviewable output — screenshots land in an artifact zip nobody opens, least of all from the GitHub mobile app where the operator actually reviews PRs. Meanwhile the panel has grown areas (Insights, Normalize, Reconcile, Scrapers, member detail) the harness never covers, and nothing — CI, the PR template, or the agent docs — obliges a UI change to come with tests or reviewable screenshots.

## What Changes

- **Restructure the Playwright harness around Page Object Model / Component Object Model best practices** under `packages/worker/admin/visual/`: one page object per top-nav area (status, members, data, insights, usage, discovery, normalize, logs, config) with sub-page objects for the routed sub-surfaces (member detail under Members, Scrapers under Discovery, the Reconcile tab under Normalize, the Data/Config sub-navs), component objects for the shared shell pieces (area nav, health dock, stat tiles, job cards, dialogs, tables/lenses), Playwright fixtures wiring page objects into specs, and a seed module that extends `setup.mjs`'s deterministic-fixture pattern to every area that needs data. Page objects encode the fixtures they expect; specs read as area-level scenarios.
- **Functional assertions become a blocking CI gate.** The `admin-visual` job is replaced by a blocking `admin-ui` job (no `continue-on-error`): every area renders its landmark, interactive surfaces work (e.g. the Members invite `<dialog>`). The vitest suite stays the functional gate for Worker logic; Playwright gates the admin UI surface only.
- **Pixel-snapshot gating is dropped.** The committed baselines (`admin.spec.ts-snapshots/`) and `toHaveScreenshot` assertions are deleted. Decisive constraints: a `GITHUB_TOKEN`-pushed baseline commit does not retrigger CI (so an `/approve-visuals` flow cannot turn the check green without a PAT — a new secret, disallowed), fork branches cannot be pushed with `GITHUB_TOKEN` at all, and cross-environment font/antialiasing drift is what made the current baselines rot. Visual regression review becomes human: per-area screenshots on every PR that touches the admin UI.
- **Screenshots become reviewable from the GitHub mobile app.** When a same-repo PR touches admin-UI paths, CI pushes the per-area PNGs to a dedicated `admin-screenshots` branch and upserts ONE sticky PR comment embedding them as commit-SHA-pinned `raw.githubusercontent.com` markdown images — which render inline on github.com and in the mobile app. Fork PRs (read-only token) degrade gracefully to the artifact upload, which is kept as the secondary surface for everyone.
- **A new PR-template consideration** (same sentinel, same "not-applicable case is in the wording" convention) attests that an admin-UI change extended the page objects + specs and that the screenshot comment was reviewed.
- **Agent docs updated in the same change:** root `CLAUDE.md` gains the one-breath rule (admin UI change ⇒ update page objects + specs, run `aubr test:admin`, surface screenshots); the POM/COM contribution guide and the web-session browser quirk (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `npx playwright install chromium` fallback) live in `packages/worker/src/admin/CLAUDE.md`; `admin/visual/README.md` is rewritten as the current-state harness doc.
- **A new `.claude/skills/admin-ui/SKILL.md` skill** encodes the run-and-review loop (run the suite, read the per-area screenshots, extend page objects for new surfaces) so the repo's own agent follows the same discipline the PR checkbox attests to.

## Capabilities

### New Capabilities

- `admin-ui-testing`: the browser-level quality gate for the operator admin panel — the blocking functional Playwright suite (page objects per area, deterministic seeded fixtures, pinned Chromium), the per-area screenshot publication that renders inline on the PR (including the mobile app) for same-repo PRs touching admin-UI paths, and the fork/absent-permission degradation to artifacts. Explicitly excludes pixel-snapshot gating.

### Modified Capabilities

- `pr-checklist-gate`: the considerations checklist gains the admin-UI testing consideration (page objects + specs extended, suite run, screenshots reviewed — or no admin UI change).

## Impact

- **Affected code:** `packages/worker/admin/visual/**` (restructured: `pages/`, `components/`, `fixtures.ts`, `seed.mjs`, specs; baselines deleted), `packages/worker/playwright.config.ts`, `.github/workflows/ci.yml` (`admin-visual` → blocking `admin-ui` + screenshot-publish step), `.github/pull_request_template.md`, `CLAUDE.md`, `packages/worker/src/admin/CLAUDE.md`, `packages/worker/admin/visual/README.md`, `CONTRIBUTING.md`, `.claude/skills/admin-ui/`.
- **Not affected:** the Worker runtime and the panel itself (no `packages/worker/src/**` behavior change), the vitest suite, the deploy pipeline (`trigger-deploy` path filters don't include `admin/visual/**` or `.github/**`, so this change correctly skips deploys).
- **Operator one-time action (not in-tree):** add the `admin-ui` job to `main`'s branch protection required status checks (same standing caveat as `pr-checklist`).
- **CI runtime:** the blocking job stays within the <4-minute budget (one `wrangler dev` boot, one Chromium project, ~12 page visits + a few interactions; Playwright browser cached by version).
