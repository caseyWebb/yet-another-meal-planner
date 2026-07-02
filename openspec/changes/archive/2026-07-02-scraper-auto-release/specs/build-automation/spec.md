## MODIFIED Requirements

### Requirement: The scraper is published as a container image on a tagged release

The scraper SHALL be published as a **multi-architecture container image** — a manifest list covering `linux/amd64` and `linux/arm64`, so it runs natively on both x86 home servers and Apple-Silicon/arm64 home hosts (the browser tier's headless Chromium included) with no CPU emulation — to the GitHub Container Registry (GHCR), together with a **GitHub Release** for a `scraper-v<version>` tag.

The published `<version>` SHALL be the `version` field of `packages/scraper/package.json` — the same single source of truth the running scraper reports as `scraper_version`. The `scraper-v<version>` tag SHALL be **derived** from it, and the release workflow SHALL read and verify the version from `packages/scraper/package.json` rather than from a hand-typed tag or a dispatch input, so the tag, the published image label, and the version the running scraper reports can never drift.

The publish SHALL run **automatically on merge to `main`**: when a push to `main` changes the scraper `version` relative to the previous commit, CI SHALL publish that version's image and Release, with **no human tag push** and **no commit-back** to the repository (the `scraper-v<version>` tag is created only as part of cutting the Release, in the same workflow run). When a push to `main` does NOT change the scraper `version`, nothing SHALL be published. The publish SHALL be **idempotent**: when a `scraper-v<version>` release/tag already exists, a re-run or an unrelated push SHALL NOT publish that version again. A manual `workflow_dispatch` fallback SHALL publish the version `packages/scraper/package.json` currently declares, subject to the same idempotence guard.

This publish SHALL run in the code repository using the built-in `GITHUB_TOKEN` (with package-write permission) — it SHALL NOT require a new stored Actions secret, preserving the "no Actions secrets in the public code repo" invariant. The scraper release SHALL be independent of the Worker deploy control plane (a scraper version change SHALL NOT deploy the Worker, and a Worker deploy SHALL NOT publish a scraper image). The image SHALL embed the scraper's build version (from `packages/scraper/package.json`) and the recipe-**contract** version it targets, so a running scraper can report both to the Worker for the admin liveness/skew view.

#### Scenario: A version bump on merge publishes the image and release

- **WHEN** a push to `main` changes `packages/scraper/package.json` `version` relative to the previous commit
- **THEN** CI builds the multi-architecture scraper image (`linux/amd64` + `linux/arm64`), pushes it to GHCR, and creates a GitHub Release for `scraper-v<version>` using the built-in `GITHUB_TOKEN`, without deploying the Worker

#### Scenario: An unchanged version publishes nothing

- **WHEN** a push to `main` leaves `packages/scraper/package.json` `version` unchanged
- **THEN** no image is pushed and no Release is cut

#### Scenario: An already-published version is not double-published

- **WHEN** the publish runs for a version whose `scraper-v<version>` release/tag already exists
- **THEN** it detects the existing release and publishes nothing

#### Scenario: The published image is multi-arch

- **WHEN** a scraper version change publishes a release
- **THEN** the pushed image is a manifest list carrying both `linux/amd64` and `linux/arm64`, so an Apple-Silicon home host runs it natively without emulation

#### Scenario: Publishing needs no stored secret

- **WHEN** the scraper publish workflow runs
- **THEN** it authenticates to GHCR with the built-in `GITHUB_TOKEN` and requires no new repository secret

#### Scenario: The scraper release does not deploy the Worker

- **WHEN** a scraper version change publishes a release
- **THEN** the Worker deploy control plane is not triggered
