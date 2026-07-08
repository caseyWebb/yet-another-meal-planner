## MODIFIED Requirements

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
