# Tasks — admin-playwright-first-class

## 1. Harness restructure — page objects, components, fixtures, registry

- [x] 1.1 Create `packages/worker/admin/visual/components/`: `nav.component.ts` (9 top-nav pills, exact labels/hrefs from `ui/layout.tsx`, active-pill assertion), `health-dock.component.ts` (SSR `.health-pill` with `Healthy`/`Degraded` + popover `role="dialog"` — the time-free cross-page landmark), `stat-tiles.component.ts`, `job-card.component.ts` (Status job rows: glyph, sparkline, since-label), `dialog.component.ts` (native `<dialog>`: open-trigger, `toHaveJSProperty("open", true)`, title, close), `table.component.ts` (tables/lenses + pager)
- [x] 1.2 Create `pages/base.page.ts`: `AdminPage` with `goto(path)`, shell `<h1>grocery-agent admin</h1>` assertion, composed `nav` + `healthDock` components, and `captureForReview(name)` writing `page.screenshot({ fullPage: true })` to `admin/visual/.screenshots/<name>.png` (ASCII names only)
- [x] 1.3 Create the 9 area page objects in `pages/` (status, members, data, insights, usage, discovery, normalize, logs, config), each owning its route, a time-free SSR landmark (`Background jobs` group label; `Roster` group label + `Invite member` button; `h2 Recipes`; Insights group labels; `h2 Usage`; `h2 Discovery`; `h2 Normalization`; `h2 Logs`; `h3 Calibration` section title), sub-nav/tab helpers, and a fixtures doc-comment importing its expected literals from `seed.mjs`
- [x] 1.4 Add sub-page objects returned by their parents: `members.page.ts → memberDetail(id)` (incl. the pending-member empty state), `discovery.page.ts → scrapers()`, `normalize.page.ts → reconcile()` (the tab), `data.page.ts` sub-nav (recipes/stores/guidance), `config.page.ts` sub-nav (discovery/ingest-keys/flyer/ranking)
- [x] 1.5 Create `fixtures.ts` (`base.extend<AdminFixtures>` exposing one fixture per page object; re-export `{ test, expect }`) and `registry.ts` (the ordered `AREAS` list of page-object entries the smoke spec iterates)
- [x] 1.6 Replace `admin.spec.ts` with `specs/`: `smoke.spec.ts` (iterate the registry: goto → shell + landmark → `captureForReview(<area>)`, plus the sub-surface captures `member-detail`, `discovery-scrapers`, `normalize-reconcile`), `members.spec.ts` (invite dialog opens as native `<dialog>` + `members-dialog` capture), `normalize.spec.ts` (`#nz-override` and `#nz-add` dialogs open), `navigation.spec.ts` (nav pills route; health dock present on every area)
- [x] 1.7 Delete `admin.spec.ts-snapshots/` (8 baseline PNGs) and every `toHaveScreenshot` usage; gitignore `admin/visual/.screenshots/`

## 2. Deterministic seed

- [x] 2.1 Extract the seed from `setup.mjs` into `seed.mjs`: per-area SQL blocks with fixed ids, timestamps computed relative to the run clock at mid-bucket offsets (`now − 5min`, `now − 2h`, `now − 3d`), exporting the literal values (titles, ids, counts) page objects assert on
- [x] 2.2 Seed D1 per area: `job_health` + `job_runs` (fixed ok/fail pattern per registered job + `grocery-reconcile` → Status sparklines/since-labels, Logs rows, the Reconcile card), `discovery_log` (retryable error + gated skip + import), a `recipes` row (Data list, Insights joins), `cooking_log` + favorite `overlay` rows (Insights), normalization identity/edge/alias/decision/queue rows (Normalize tabs), a `feeds` row (Status stat tile) — shapes read from `migrations/d1/` and the pages' readers. No Usage rows: the three Usage readers need Cloudflare Analytics creds, so locally they deterministically render their not-configured states and the spec asserts the unconditional section labels only
- [x] 2.3 Seed KV in `setup.mjs` via `wrangler kv key put --local`: a **pending** member (TENANT_KV allowlist entry only) and an **active-shaped** member (allowlist + OAuth-grant + Kroger-refresh KV entries, plus `tenant_activity` / pantry / meal-plan / cooking-log D1 rows; the grocery-list section renders its designed empty state) — key shapes from `src/tenant.ts` / the members reader
- [x] 2.4 Update `setup.mjs` to apply `seed.mjs` (D1 + KV) after migrations, before `wrangler dev`; verify `aubr test:admin` passes twice in a row with stable relative-age labels and no unseeded empty states in the captured screenshots
- [x] 2.5 Update `playwright.config.ts`: drop the `expect.toHaveScreenshot` block, set `use.screenshot: "only-on-failure"`, point `testDir` at `admin/visual/specs`, keep `workers: 1` + the `PW_CHROMIUM_PATH` escape hatch

## 3. CI — blocking gate + screenshot publish

- [x] 3.1 Rename `admin-visual` → `admin-ui` in `.github/workflows/ci.yml`; remove `continue-on-error`; add `permissions: { contents: write, pull-requests: write }` on the job; rewrite the job comment to describe the blocking gate (current-state, no history)
- [x] 3.2 Add a Playwright browser cache step (`~/.cache/ms-playwright`, keyed on the `@playwright/test` version from `aube-lock.yaml`) before `npx playwright install --with-deps chromium`
- [x] 3.3 Add the screenshot-publish step, guarded to `pull_request` events from the same repo (`head.repo.full_name == github.repository`) whose diff against the PR base touches `packages/worker/src/admin/`, `packages/worker/admin/visual/`, `packages/worker/scripts/build-admin.mjs`, or `packages/worker/playwright.config.ts` (plain `git diff --name-only`, like `trigger-deploy`'s filter): commit `.screenshots/*.png` to the `admin-screenshots` orphan branch under `pr-<number>/` (create the branch if missing; normal commit, never force-push), then upsert the single sticky comment (marker `<!-- admin-ui-screenshots -->`) via `gh api`, embedding commit-SHA-pinned `raw.githubusercontent.com` image URLs in per-area `<details>` blocks
- [x] 3.4 Add the `screenshots-prune` flow as its own `pull_request: types [closed]` workflow (`.github/workflows/admin-screenshots-prune.yml`; same-repo guard, `contents: write`) deleting `pr-<n>/` from `admin-screenshots` — its own file because ci.yml doesn't subscribe to `closed` (adding it would re-run every test job on close)
- [x] 3.5 Keep the artifact upload (`.results/`, `playwright-report/`, `.screenshots/`) `if: always()`; SHA-pin `actions/upload-artifact` while in the file
- [x] 3.6 Add `admin-ui` to `trigger-deploy`'s `needs:` (path filter untouched — docs/test-only pushes still skip deploys); verify fork-PR behavior degrades to artifacts without failing the job

## 4. PR template + checklist gate

- [x] 4.1 Add the consideration to `.github/pull_request_template.md`, preserving the `<!-- pr-checklist:v1 -->` sentinel and the honestly-checkable wording: `- [ ] **Admin UI tests.** An admin-panel change (src/admin/**, its styles/islands, or the harness) extended the Playwright page objects + specs, aubr test:admin passes, and the PR's screenshot comment was reviewed (or no admin-UI change).`
- [x] 4.2 Confirm the `pr-checklist` workflow needs no change (it counts unchecked `- [ ]` boxes generically) — no edit expected, just verify

## 5. Docs + skill

- [x] 5.1 Root `CLAUDE.md`: add `aubr test:admin` to the command block and the one admin-UI-testing rule to "Rules a coding agent must not miss", pointing at `src/admin/CLAUDE.md` for the guide
- [x] 5.2 `packages/worker/src/admin/CLAUDE.md`: add the "Testing — the Playwright harness" section (POM/COM structure, the one-seam add-an-area path: page object → registry → fixtures → seed, landmark discipline, determinism rules, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` + `npx playwright install chromium` fallback)
- [x] 5.3 Rewrite `packages/worker/admin/visual/README.md` as the current-state harness doc (structure, seed, commands, CI jobs, the screenshot comment; no "no longer"/"used to" narration)
- [x] 5.4 `CONTRIBUTING.md`: mention the new consideration in "Opening a pull request" and add `admin-ui` beside `pr-checklist` in the required-status-check note
- [x] 5.5 Add `.claude/skills/admin-ui/SKILL.md` (thin, `code-review`-shaped): run `aubr test:admin` (web-session env quirk inline), Read the `.screenshots/*.png` images and report visual changes, extend page object/registry/seed first when a surface changed

## 6. Validation + handoff

- [ ] 6.1 `aubr test:admin` green twice consecutively (determinism check); `aubr typecheck` (page objects/fixtures are TS), `aubr test`, `aubr test:tooling` green — local worktree runs are green (see the change report); checked off by the PR's own CI run
- [ ] 6.2 On the PR itself: `admin-ui` check green, exactly one sticky screenshot comment rendering inline (spot-check from the GitHub mobile app), artifact upload present — verifiable only once the PR exists
- [ ] 6.3 Operator (out-of-tree, one-time): add `admin-ui` to `main`'s branch-protection required status checks — not a repo file; stays with the operator
- [ ] 6.4 Archive the change (`/opsx:archive`): sync `admin-ui-testing` + modified `pr-checklist-gate` into `openspec/specs/` — after PR review, at merge time
