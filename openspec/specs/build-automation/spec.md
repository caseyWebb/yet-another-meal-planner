# build-automation Specification

## Purpose

Defines how the agent plugin bundle is built and published in CI: the operator's deploy (the reusable `data-deploy.yml`) builds the bundle with their own connector URL baked in and commits it to their public data repo, which serves as their plugin marketplace. Recipe validation and the recipe index are owned by the Worker reconcile (see the `recipe-index` and `r2-corpus-store` capabilities).
## Requirements
### Requirement: Deploy builds and publishes the plugin bundle to the data-repo marketplace

The reusable **deploy** workflow SHALL, after the Worker deploy step succeeds, build the plugin bundle from the persona source with the operator's connector URL baked into `.mcp.json`, and publish it by committing `.claude-plugin/marketplace.json` and the generated `plugin/` bundle into the operator's data repository (reusing the deploy's existing `contents: write`). The build SHALL run **only after** the Worker deploy, so published skills never reference tools the deployed Worker does not yet serve. The published plugin version SHALL be derived from the data repository's own commit count, so each publish is strictly newer than the last. The build step SHALL require no secrets of its own — it uses the deploy's credentials to deploy the Worker, not to build the bundle.

#### Scenario: Deploy publishes the bundle after the Worker is live

- **WHEN** an operator runs the deploy
- **THEN** the Worker is deployed first, then the plugin bundle is built with the operator's connector URL and committed to the data repository's `.claude-plugin/marketplace.json` + `plugin/`

#### Scenario: Connector URL is baked per operator

- **WHEN** the deploy builds the bundle
- **THEN** `.mcp.json` carries that operator's `grocery-mcp` connector URL, identical to other operators' bundles except for the URL and the version

#### Scenario: Published version is monotonic

- **WHEN** the deploy republishes after a change
- **THEN** the bundle's version (the data repository's commit count) is strictly greater than the previously published version

### Requirement: CI is workspace-aware across the monorepo packages

CI SHALL typecheck and test **every** workspace package (the Worker, the shared contract package, and the scraper), not only the Worker. Path filters that gate the Worker deploy trigger SHALL be scoped to the Worker's package paths so a scraper-only or docs-only change does NOT trigger a Worker deploy, and a Worker change does NOT rebuild the scraper image. A change to the **shared contract package** SHALL fan out to both pipelines (it can break either side), so contract changes SHALL run the Worker CI and be treated as affecting the scraper image. The scraper's tests SHALL use fixture pages and SHALL NOT hit live paid sources in CI.

#### Scenario: Every package is typechecked and tested

- **WHEN** CI runs on a push or PR
- **THEN** the Worker, contract, and scraper packages are each typechecked and tested

#### Scenario: A scraper-only change does not deploy the Worker

- **WHEN** a change touches only scraper-package paths
- **THEN** the Worker deploy trigger does not fire

#### Scenario: A contract change fans out to both sides

- **WHEN** a change touches the shared contract package
- **THEN** CI runs the Worker checks and treats the change as affecting the scraper image build

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

### Requirement: Scraper version is single-sourced and bump-gated on pull requests

`packages/scraper/package.json` `version` (semver) SHALL be the single source of truth for the scraper's version — the value the running scraper reports to the Worker as `scraper_version` on every ingest batch. A pull request that changes any file under `packages/scraper/**` or under the shared contract package `packages/contract/**` SHALL bump that `version` to a value strictly greater (by semver) than the value on the pull request's base branch. A merge-blocking CI gate SHALL enforce this: it SHALL run only on `pull_request` events, determine the changed paths by diffing against the pull request's base ref, and FAIL the pull request when the scraper or the shared contract is touched without a strictly-greater bump. The gate SHALL pass as a no-op when the pull request touches neither the scraper nor the shared contract. The gate SHALL use only the built-in `GITHUB_TOKEN` and SHALL NOT require any stored Actions secret, and SHALL NOT itself commit a version bump — the version is bumped by the pull request's author. The gate SHALL exempt bot-authored pull requests (author login ending in `[bot]`) with a neutral pass, so that automated dependency pull requests are not permanently blocked.

#### Scenario: A scraper change without a bump fails

- **WHEN** a pull request changes a file under `packages/scraper/**` and does not raise `packages/scraper/package.json` `version` above the base branch's value
- **THEN** the version-bump gate fails the pull request

#### Scenario: A contract change without a bump fails

- **WHEN** a pull request changes a file under `packages/contract/**` and does not raise `packages/scraper/package.json` `version` above the base branch's value
- **THEN** the version-bump gate fails the pull request

#### Scenario: A strictly-greater bump passes

- **WHEN** a pull request changes the scraper or the shared contract and raises `packages/scraper/package.json` `version` to a strictly-greater semver
- **THEN** the version-bump gate passes

#### Scenario: A change touching neither is a no-op

- **WHEN** a pull request touches neither `packages/scraper/**` nor `packages/contract/**`
- **THEN** the version-bump gate passes without requiring any version change

#### Scenario: The gate runs only on pull requests

- **WHEN** CI runs on a push to `main` or a `workflow_dispatch`
- **THEN** the version-bump gate does not run, because there is no base revision to compare against

#### Scenario: Bot-authored pull requests are exempt

- **WHEN** a bot (author login ending in `[bot]`) opens a pull request that touches the scraper or the shared contract without a version bump
- **THEN** the version-bump gate passes with a neutral result

