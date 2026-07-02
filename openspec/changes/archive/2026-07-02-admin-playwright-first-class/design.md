# Design — admin-playwright-first-class

## Context

The admin panel has 9 top-nav areas (Status, Members, Data, Insights, Usage, Discovery, Normalization, Logs, Config) plus routed sub-surfaces (Members → member detail, Discovery → Scrapers, Normalize → the Reconcile tab, Data/Config sub-navs). The Playwright harness (`packages/worker/admin/visual/`) covers 7 areas with one flat spec, gates nothing (`continue-on-error` in CI, red on stale pixel baselines), and its screenshots are buried in artifact zips — invisible from the GitHub mobile app, where the operator reviews PRs. The operator wants the browser-level suite to be a first-class, mandatory surface: blocking functional assertions, page-object structure, and screenshots reviewable inline on the PR from mobile.

Verified environment facts this design rests on:

- `@playwright/test` 1.61.1 pins Chromium rev 1228; the web-session sandbox pre-installs that exact build under `/opt/pw-browsers/chromium-1228`, so `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` runs the suite locally with the same browser CI installs.
- GitHub job summaries do **not** render in the GitHub mobile app (confirmed via launch-thread and changelog research); Actions artifacts are zip-downloads, effectively unusable on mobile. **Markdown images in a PR comment do render inline on mobile** — for a public repo, camo-proxied `raw.githubusercontent.com` URLs work, provided filenames are plain ASCII and URLs are commit-SHA-pinned (branch-name URLs go stale in camo's cache).
- On fork PRs the `pull_request`-event `GITHUB_TOKEN` is read-only regardless of the `permissions:` block — no comment, no branch push.
- Commits pushed with `GITHUB_TOKEN` do **not** trigger new workflow runs (deliberate recursion guard). An `issue_comment`-triggered `/approve-visuals` flow could commit regenerated baselines to a same-repo PR branch (and the CLA bot's `*[bot]` allowlist would accept the authorship), but CI would not re-run on that commit — turning the check green needs a GitHub App token, deploy key, or PAT, i.e. a new secret, which this repo disallows.
- The CLA bot allowlists `*[bot]` authors; `main` is ruleset-protected; the deploy trigger's path filter does not include `admin/visual/**` or `.github/**`.

## Goals / Non-Goals

**Goals:**

- Blocking `admin-ui` CI job: functional assertions (landmarks + interactions) over every routed admin area, within a <4-minute budget.
- Page Object Model / Component Object Model harness: one page object per area, component objects for shared shell pieces, Playwright-fixture wiring, a documented one-seam path for adding a new area.
- Per-area screenshots rendered inline on admin-UI PRs, reviewable from the GitHub mobile app; one sticky comment, path-filtered; graceful fork degradation to artifacts.
- Deterministic rendering: seeded fixtures for every data-hungry area, now-relative timestamps so relative-age labels are stable, pinned browser.
- Docs + skill: root `CLAUDE.md` rule, POM/COM contribution guide in `src/admin/CLAUDE.md`, harness README rewritten, `/admin-ui` skill for the repo's own agent, PR-template consideration.
- CI green at the end of the change (stale baselines removed with pixel gating).

**Non-Goals:**

- Pixel-snapshot (visual-regression) gating — dropped, see D5.
- Cross-browser coverage (Chromium only, as today), mobile-viewport projects, accessibility audits — future work, the POM structure accommodates them.
- Testing the Worker's non-admin surface in the browser (vitest remains the functional gate for Worker logic).
- Fork-PR screenshot comments via `workflow_run` two-stage publishing — not worth the security surface for a repo whose contributors are effectively the operator; forks keep artifacts.

## Decisions

### D1 — Harness layout: page objects, component objects, fixtures, area registry

```
packages/worker/admin/visual/
  README.md                 # current-state harness doc (rewritten)
  setup.mjs                 # webServer entrypoint: build → migrate → seed → wrangler dev (unchanged role)
  seed.mjs                  # deterministic fixture set, grouped per area; exports the literals page objects assert on
  fixtures.ts               # base.extend<AdminFixtures>() wiring every page object; exports { test, expect }
  registry.ts               # AREAS: the ordered list of [areaName, PageObject class] the smoke spec iterates
  components/
    nav.component.ts        # top-nav pills (9 areas), active-pill assertion, navigate-by-label
    health-dock.component.ts# global health pill + popover (time-free; the universal cross-page landmark)
    stat-tiles.component.ts # stat-card grid (Status, Members, Discovery, Normalize headers)
    job-card.component.ts   # Status job rows: state glyph, sparkline, since-label
    dialog.component.ts     # native <dialog> wrapper: open-trigger, hasJSProperty("open"), title, close
    table.component.ts      # tables/lenses + pager (Data lists, Logs runs, rosters)
  pages/
    base.page.ts            # AdminPage: goto(path), shell <h1> assertion, nav + health-dock components,
                            #   captureForReview(name) → .screenshots/<name>.png (fullPage)
    status.page.ts          # /admin
    members.page.ts         # /admin/members (+ invite dialog); memberDetail(id) sub-page object
    data.page.ts            # /admin/data (+ recipes/stores/guidance sub-nav)
    insights.page.ts        # /admin/insights
    usage.page.ts           # /admin/usage
    discovery.page.ts       # /admin/discovery; scrapers() sub-page object
    normalize.page.ts       # /admin/normalize (+ tabs incl. reconcile(), override/add-alias dialogs)
    logs.page.ts            # /admin/logs
    config.page.ts          # /admin/config (+ ingest-keys/flyer/ranking sub-nav)
  specs/
    smoke.spec.ts           # for each registry area: goto → shell + landmark → captureForReview
    members.spec.ts         # invite dialog opens as native <dialog> (+ dialog screenshot)
    normalize.spec.ts       # override + add-alias dialogs open as native <dialog>s
    navigation.spec.ts      # nav pills route correctly; health dock present on every area
  .screenshots/             # per-area review PNGs (gitignored; consumed by the CI publish step)
  .results/                 # Playwright output (gitignored, as today)
```

- **Page object contract.** Each page object owns: its `path`, a `landmark()` assertion (an area-unique, time-free, SSR-rendered locator — e.g. Data's `h2 "Recipes"`, Normalize's `h2 "Normalization"`, Members' "Roster" group label, Status's "Background jobs" group label, Config's `h3 "Calibration"` section title), navigation helpers for its sub-nav/tabs, and a `fixtures` doc-comment naming the seeded rows it expects (with the literals imported from `seed.mjs` so seed and assertion cannot drift). Sub-surfaces (member detail, scrapers, reconcile tab) are sub-page objects returned by their parent, not top-level registry entries.
- **Component objects** cover the shell pieces shared across areas so selector churn lands in one file: nav, health dock (deliberately the cross-page landmark — it renders on every HTML response and contains no relative-time text), stat tiles, job cards, dialogs, tables. Dialog handling asserts `toHaveJSProperty("open", true)` on the native `<dialog>` (the existing robust check).
- **Fixtures wiring.** `fixtures.ts` extends Playwright's `test` with one fixture per page object (constructed lazily from `page`); specs `import { test, expect } from "../fixtures"` and never instantiate page objects or hard-code routes/selectors. The smoke spec iterates `registry.ts`, so a new area is one page object + one registry line + one fixture + (if data-hungry) a seed block — nothing else.
- **Assert SSR, not hydration.** Read-only pages are pure SSR; landmarks are server-rendered headings/labels, so no island-load waits. Island surfaces (Members, Discovery, Insights, Normalize, Config) are asserted on their SSR-rendered section titles for smoke, with explicit island interactions only in the dedicated interaction specs.

### D2 — Determinism: seeding, timestamps, screenshots

- **`seed.mjs` extends the existing pattern** (fixed-id `DELETE`+`INSERT` statements applied by `setup.mjs` via `wrangler d1 execute --local` before `wrangler dev`) from the current 2-row discovery fixture to every data-hungry area: `job_runs` (a fixed ok/fail pattern per registered job → Status sparklines, since-labels, Logs content, Usage trends), `discovery_log` (retryable + gated rows, as today), `recipes` + a store row (Data lists, Insights joins), `cooking_log` + favorite `overlay` rows (Insights boards/heatmap), tool-usage rows (Usage), normalization decision/queue/alias/node rows (Normalize tabs incl. Reconcile). Members needs KV, not just D1: seed the `TENANT_KV` allowlist via `wrangler kv key put --local` with two members — one **pending** (allowlist entry only; also exercises the pending member-detail page) and one **active-shaped** (allowlist + minimal OAuth-grant KV row + `tenant_activity` + a few pantry/meal-plan/grocery/cooking rows so member-detail sections render populated). Exact key shapes are read from `src/tenants.ts`/`src/admin` at implementation time.
- **Timestamps are seeded relative to the run's clock**, not fixed instants: `seed.mjs` computes `now − 5min`, `now − 2h`, `now − 3d` offsets when generating SQL. The panel's duplicated `relAge` helpers then render stable text ("5m ago", "2h ago") on every run, and request-time labels ("Refresh · checked just now") are stable by construction. Offsets are chosen mid-bucket (5 min, not 59 s) so rounding cannot flip the label between runs. **No product-code change for testability** — no injected clock, no `TEST_NOW` var; the fixture strategy alone keeps rendering stable. Page objects never assert on relative-age text.
- **Review screenshots** are captured explicitly by `captureForReview(name)` (`page.screenshot({ fullPage: true })` into `.screenshots/<area>.png`, ASCII names — the mobile app breaks on non-ASCII image filenames) rather than relying on Playwright's per-test artifacts; `use.screenshot` drops to `"only-on-failure"` (failure artifacts keep their debugging role). Stable filenames give the publish step and human reviewers a consistent per-area set: the 9 areas + `members-dialog`, `member-detail`, `discovery-scrapers`, `normalize-reconcile`.
- **Browser pinning policy:** CI installs the Chromium pinned by the repo's `@playwright/test` (as today, now cached — see D3); web-session sandboxes use the pre-installed matching build via `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. `@playwright/test` stays a caret range: with pixel gating gone, byte-level identity across environments no longer matters — screenshots only need to be self-consistent within a CI run. When a Dependabot bump outpaces the sandbox image, the documented fallback is `npx playwright install chromium` (downloads through the proxy). This is deliberately documentation, not an exact version pin: an exact pin wouldn't stop Dependabot proposing bumps, and would couple the repo to the sandbox image's refresh cadence.

### D3 — CI: the blocking `admin-ui` job

`ci.yml`'s `admin-visual` job is renamed `admin-ui` and loses `continue-on-error`. Steps:

1. Checkout, mise, aube cache, `aube ci` (as today).
2. **Cache Playwright browsers** (`~/.cache/ms-playwright`, keyed on the lockfile's `@playwright/test` version) before `npx playwright install --with-deps chromium` — keeps the job inside the <4-minute budget on warm runs.
3. `aubr test:admin` — the blocking functional gate. One `wrangler dev` boot, one Chromium project, ~13 page visits + 3 dialog interactions; the current 7-area suite runs in well under 2 minutes locally, so the expanded suite fits the budget.
4. **Screenshot publish** (see D4) — a step, not a separate job, so it reuses the checkout; guarded to `pull_request` events from the same repo with admin-UI paths touched.
5. Artifact upload (`.results/` + `playwright-report/` + `.screenshots/`) stays, `if: always()` — the secondary surface and the fork/failure fallback. The action gets SHA-pinned while we're in the file (the existing `v4` tag carries a TODO).

The job runs on **every** PR/push (no workflow-level path filter): a `src/` Worker change can break the panel's SSR, and a required check must actually report. `trigger-deploy` gains `needs: admin-ui` so a deploy never fires with a broken panel — its *path filter* is untouched, so docs/test-only pushes still skip deploys. **Out-of-tree operator action:** add `admin-ui` to `main`'s required status checks (same standing caveat as `pr-checklist`, documented in CONTRIBUTING).

### D4 — Screenshot surfacing: orphan branch + one sticky PR comment

The only verified mobile-renderable surface is markdown images in a PR comment (research summary in Context). Mechanism, all plain `git`/`gh api` — no third-party action, matching the repo's minimal-`uses:` posture:

- **Path filter:** the publish step runs only when `git diff --name-only` against the PR base touches `packages/worker/src/admin/`, `packages/worker/admin/visual/`, `packages/worker/scripts/build-admin.mjs`, or `packages/worker/playwright.config.ts` — the surfaces that can change what the panel looks like or what the suite covers. Computed with a plain git diff (like `trigger-deploy`'s filter), not a filter action.
- **Publish:** push the run's `.screenshots/*.png` to the dedicated **`admin-screenshots`** orphan branch under `pr-<number>/` (creating the branch on first use; plain ASCII filenames). A normal commit per update — **no force-push**, so the SHA-pinned URLs in the current comment never dangle (force-pushed-away commits eventually GC and 404 old images).
- **Comment:** upsert **one** sticky comment found by the hidden marker `<!-- admin-ui-screenshots -->`, embedding each area as `https://raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/pr-<n>/<area>.png` (SHA-pinned: immune to camo's branch-URL cache staleness), grouped in `<details>` blocks per area with the touched-area(s) expanded. Repeated pushes edit this comment in place — never a second comment.
- **Permissions:** the `admin-ui` job gets `permissions: { contents: write, pull-requests: write }`. Risk note: on same-repo PRs this token could push to unprotected branches — acceptable because same-repo PR authors already have write access, `main` is ruleset-protected, and fork PRs get a read-only token regardless. **Fork PRs and non-PR events skip the publish step gracefully** (`head.repo.full_name != github.repository`, or event != `pull_request`); artifacts remain their surface. `pull_request_target` is explicitly not used — the job runs PR code.
- **Hygiene:** a tiny `pull_request: closed` workflow (`admin-screenshots-prune.yml`, its own file — ci.yml deliberately doesn't subscribe to the `closed` type, which would re-run every test job on close; guarded to same-repo) deletes `pr-<n>/` from the branch. Growth is bounded in practice (~1–2 MB per admin-UI push, occasional PRs); the branch is orphaned (never merged, invisible to `--single-branch` clones) and the operator can delete/recreate it at any time — only historical comment revisions lose their images.

### D5 — Pixel gating: dropped

The approval story cannot be nailed under the repo's constraints, so per the operator's own criterion pixel gating goes:

1. **A `GITHUB_TOKEN`-pushed baseline commit does not retrigger CI**, so an `/approve-visuals` comment flow can regenerate and commit baselines but cannot turn the red check green; the escape hatches (GitHub App token, deploy key, PAT) are all new secrets — disallowed. (A `workflow_dispatch` re-dispatch of ci.yml onto the branch could paper over it, but check-run/SHA matching against required checks is exactly the kind of shakiness the operator said should kill the feature.)
2. **Fork branches cannot be pushed with `GITHUB_TOKEN` at all** — the flow would be same-repo-only from day one.
3. **Cross-environment pixel drift is the proven failure mode** — the current baselines rotted precisely because sandbox and CI Chromium builds diverged; fonts/antialiasing keep that risk alive even with matched revisions.
4. The **sticky screenshot comment is a better review surface anyway**: the operator sees the actual rendered panel on every admin-UI PR, on mobile, without maintaining a baseline corpus.

Consequences: `admin.spec.ts-snapshots/` (8 PNGs) is deleted, `toHaveScreenshot` assertions and the `expect.toHaveScreenshot` config block go, and CI is green at the end of the change with no baseline refresh needed. Human review of the published screenshots — attested by the new PR checkbox — is the visual-regression mechanism. If automated pixel diffing is ever wanted again, it can return as a **non-blocking, same-run diff report** inside the sticky comment (compare against the base branch's screenshots regenerated in the same CI environment — no committed baselines, no approval flow); explicitly out of scope now.

### D6 — Documentation homes

- **Root `CLAUDE.md`** gets the minimum: `aubr test:admin` in the command block, and one rule in "Rules a coding agent must not miss" — *an admin-panel change updates/extends the page objects + specs, runs `aubr test:admin`, and surfaces the screenshots for review; the contribution guide lives in `src/admin/CLAUDE.md`*. Root stays an index, not a manual.
- **`packages/worker/src/admin/CLAUDE.md`** gains a "Testing — the Playwright harness" section: the POM/COM structure, how to add a page object for a new surface (page object → registry → fixtures → seed), the landmark discipline (SSR-rendered, time-free, area-unique), the determinism rules (now-relative seeds; never assert relative-age text), and the local-run quirks (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in web sessions; `npx playwright install chromium` fallback when the pinned Playwright outpaces the sandbox image). This is the right home: it's where the panel's other modeling/styling disciplines already live, and the audience (someone changing the panel) is already reading it.
- **`admin/visual/README.md`** is rewritten as the current-state harness doc (structure, seed, commands, the CI jobs, the screenshot comment) — no history, per the docs convention.
- **`CONTRIBUTING.md`**: the PR-checklist paragraph mentions the new consideration; the branch-protection note adds `admin-ui` beside `pr-checklist`.

### D7 — Skill: `.claude/skills/admin-ui/SKILL.md` — recommended, thin

Following the `code-review` skill's shape (thin orchestrator, repo knowledge stays put): run `aubr test:admin` (with the web-session env quirk), then **Read the per-area PNGs in `.screenshots/`** (the agent can view images) and report what changed visually; when a surface was added/changed, extend the page object/registry/seed first. This is worth shipping: it encodes the exact behavior the new PR checkbox attests to, the sandbox quirks live in one invocable place, and it matches how the repo already packages agent workflows. Named `admin-ui` to match the CI job and checkbox.

### D8 — What is OpenSpec vs plain repo change

Spec deltas where a contract changes: **`admin-ui-testing`** (new capability: the blocking gate, POM organization, determinism, screenshot publication, no-pixel-gating guarantee — same dev-infra-capability precedent as `pr-checklist-gate`/`build-automation`/`repo-structure`) and **`pr-checklist-gate`** (the checklist's SHALL-cover list gains the admin-UI consideration). The concrete `ci.yml` steps, PR-template wording, docs edits, and the skill are **plain repo changes inside the same PR** — they're the implementation of those contracts, and OpenSpec doesn't need to duplicate workflow YAML. The branch-protection update is an out-of-tree operator action, called out in tasks.

## Risks / Trade-offs

- **Screenshot branch growth** → bounded by per-PR prune-on-close + operator-recreatable branch; append-only commits are the price of never breaking the live comment's images.
- **Same-repo-only comments** → forks fall back to artifacts; acceptable for this repo's contributor base, and the blocking functional gate still runs for forks.
- **Landmark brittleness under redesigns** → landmarks are owned by page objects (one-file churn) and chosen from SSR output; the Claude-Design-driven redesign flow means heading texts are deliberate, not incidental.
- **Hydration timing on island pages** → smoke asserts SSR landmarks only; interaction specs use explicit expectations (Playwright auto-waits), and `workers: 1` keeps the single dev server unconfused.
- **Seed drift as the panel grows** → the page-object fixture doc-comments import literals from `seed.mjs`, and the contribution guide makes "extend the seed" part of the one-seam checklist.
- **Runtime creep** → one boot + linear page visits; if the suite outgrows the budget, split interaction specs into a second shard before touching the gate's scope.

## Migration

1. Land the restructured harness + seed + specs (delete `admin.spec.ts-snapshots/`, drop `toHaveScreenshot`); `aubr test:admin` green locally.
2. Land ci.yml (`admin-visual` → `admin-ui`, blocking, publish + prune steps), PR template, docs, skill in the same PR — CI must be green on the PR itself.
3. Operator adds `admin-ui` to `main`'s required checks (out-of-tree, one-time).
4. Archive the change; `openspec/specs/` gains `admin-ui-testing` and the modified `pr-checklist-gate`.
