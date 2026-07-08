# admin-ui-testing Specification

## Purpose
The admin panel's Playwright testing surface: the page/component-object harness, the blocking admin-ui CI gate, and the screenshot review flow.
## Requirements
### Requirement: Blocking browser-level functional gate for the admin panel

The repository SHALL provide a Playwright test suite that drives the real operator admin panel — the built admin SPA served by the Worker — in a pinned Chromium against a local `wrangler dev` (the harness under `packages/worker/admin/visual/`, run by `aubr test:admin`), and a CI job (`admin-ui` in `.github/workflows/ci.yml`) that runs it as a **blocking** check — not `continue-on-error`. The suite SHALL assert, for every routed admin area, that the area renders its area-specific landmark (a stable heading or control unique to the area, rendered from the area's seeded data) alongside the shared shell, and SHALL exercise the panel's interactive surfaces browser-level (at minimum, each modal dialog opening). The gate SHALL be functional-assertion-based: a failure means a broken surface, never a pixel drift. The vitest suite remains the functional gate for Worker logic; this gate covers only the browser-level admin UI surface. The job SHALL keep a bounded runtime (a single dev-server boot, a single browser project).

#### Scenario: A broken admin area fails CI

- **WHEN** a change breaks a routed admin area (its landmark no longer renders, or its dialog no longer opens)
- **THEN** the `admin-ui` CI job fails as a blocking check, not a soft warning

#### Scenario: The gate does not fail on pixel drift

- **WHEN** the panel renders with different pixels (fonts, antialiasing, a browser bump) but every landmark and interaction still passes
- **THEN** the `admin-ui` job passes — no committed screenshot baseline is compared

#### Scenario: The suite drives the panel as served

- **WHEN** the suite runs
- **THEN** it exercises the built admin bundle served by the Worker behind the loopback dev gate (the same serving path a deployed operator hits), not a mocked or dev-server rendering

### Requirement: Harness is organized as page objects and component objects

The Playwright harness SHALL be organized on the Page Object Model: one page object per routed admin area, each encoding the area's route, its landmark assertion, and the seeded fixtures it expects — plus component objects for the shared shell pieces (the area nav, the global health indicator, stat tiles, dialogs, tables) that page objects compose. Page objects SHALL be wired into specs through Playwright fixtures (specs import the harness's extended `test`, receiving constructed page objects), and specs SHALL NOT hard-code routes or selectors that a page or component object owns. Adding a new admin area SHALL require adding its page object, registering it in the fixtures and the all-areas registry, and (when the area needs data) extending the seed — after which the all-areas smoke coverage picks it up.

#### Scenario: A new admin area gets coverage through one seam

- **WHEN** a contributor adds a routed admin area and its page object (route, landmark, expected fixtures), registering it in the fixtures and area registry
- **THEN** the smoke suite covers the new area (landmark + screenshot) without edits to other specs

#### Scenario: Selector churn is absorbed by the owning object

- **WHEN** an area's markup changes (a heading renamed, a control moved)
- **THEN** only that area's page object (or the shared component object) changes; specs consuming it are untouched

### Requirement: Deterministic rendering for stable runs and comparable screenshots

The harness SHALL render deterministically: the dev server is seeded with a fixed fixture set (the D1 seed applied by the harness's setup before serving), the browser is the Chromium build pinned by the repo's `@playwright/test` version, and the suite runs offline (local bindings only, no external API). Time-relative renderings (relative ages, "since" labels) SHALL be kept stable across runs — by seeding timestamps relative to the run's own clock so relative labels render the same text, and/or by masking irreducibly time-dependent regions in captured screenshots — so that two runs on the same code produce functionally identical assertions and visually comparable screenshots.

#### Scenario: Two runs on the same code agree

- **WHEN** the suite runs twice on the same commit
- **THEN** both runs pass the same assertions and produce visually comparable per-area screenshots (no drift from wall-clock time or unseeded data)

#### Scenario: Seeded fixtures cover data-hungry areas

- **WHEN** an area renders meaningfully only with data (job runs, discovery entries, usage events, queue rows)
- **THEN** the harness's seed provides deterministic rows for it, and the area's page object documents that expectation

### Requirement: Per-area screenshots are published inline on admin-UI PRs

For a same-repo pull request whose diff touches admin-UI paths (the admin app package, the shared UI package, the Worker's admin routes, or the harness itself), CI SHALL publish the suite's per-area screenshots so they render **inline on the pull request — including in the GitHub mobile app**: the PNGs are pushed to a dedicated screenshots branch (ASCII-only filenames, one directory per PR) and embedded as commit-SHA-pinned `raw.githubusercontent.com` markdown images in a bot comment. The comment SHALL be a **single sticky comment** (identified by a hidden marker and updated in place on each push), never one comment per run. A PR not touching admin-UI paths SHALL get no comment. On a fork pull request (where `GITHUB_TOKEN` cannot write), the publish step SHALL skip gracefully; the screenshot artifact upload remains available as the secondary surface for every run.

#### Scenario: An admin-UI PR gets one inline screenshot comment

- **WHEN** a same-repo PR touches the admin panel and pushes twice
- **THEN** the PR carries exactly one bot screenshot comment, updated in place, whose per-area images render inline on github.com and in the GitHub mobile app

#### Scenario: A non-admin PR gets no screenshot comment

- **WHEN** a PR touches no admin-UI path (e.g. a Worker tool or docs change)
- **THEN** CI posts no screenshot comment on it

#### Scenario: A fork PR degrades to artifacts

- **WHEN** a pull request comes from a fork (read-only `GITHUB_TOKEN`)
- **THEN** the publish step skips without failing the job, and the screenshots remain downloadable as the run's artifact

### Requirement: Visual regression review is human, not pixel-gated

The repository SHALL NOT gate merges on pixel-snapshot comparison of the admin panel: no screenshot baselines are committed and no `toHaveScreenshot` assertion participates in CI. Visual regression review is performed by a human over the published per-area screenshots (the sticky PR comment), attested by the PR checklist's admin-UI consideration.

#### Scenario: No baseline exists to go stale

- **WHEN** browsers, fonts, or rendering environments change over time
- **THEN** no committed pixel baseline exists to rot and no CI job fails on byte-level image drift; the reviewable surface is the current screenshots on each admin-UI PR

