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

CI SHALL typecheck and test **every** workspace package (the Worker, the shared contract package, and the satellite), not only the Worker. Path filters that gate the Worker deploy trigger SHALL be scoped to the Worker's package paths so a satellite-only or docs-only change does NOT trigger a Worker deploy, and a Worker change does NOT rebuild the satellite image. A change to the **shared contract package** SHALL fan out to both pipelines (it can break either side), so contract changes SHALL run the Worker CI and be treated as affecting the satellite image. The satellite's tests SHALL use fixture pages and SHALL NOT hit live paid sources in CI.

#### Scenario: Every package is typechecked and tested

- **WHEN** CI runs on a push or PR
- **THEN** the Worker, contract, and satellite packages are each typechecked and tested

#### Scenario: A satellite-only change does not deploy the Worker

- **WHEN** a change touches only satellite-package paths
- **THEN** the Worker deploy trigger does not fire

#### Scenario: A contract change fans out to both sides

- **WHEN** a change touches the shared contract package
- **THEN** CI runs the Worker checks and treats the change as affecting the satellite image build

### Requirement: The satellite is published as a container image on a tagged release

A scoped release tag (`satellite-v*`) SHALL build the satellite **container image**, publish it to the GitHub Container Registry (GHCR), and cut a **GitHub Release** for that tag. This publish SHALL run in the code repository using the built-in `GITHUB_TOKEN` (with package-write permission) — it SHALL NOT require a new stored Actions secret, preserving the "no Actions secrets in the public code repo" invariant. The satellite release SHALL be independent of the Worker deploy control plane (a satellite tag SHALL NOT deploy the Worker, and a Worker deploy SHALL NOT publish a satellite image). The image SHALL embed the satellite's build version and the recipe-**contract** version it targets, so a running satellite can report both to the Worker for the admin liveness/skew view.

#### Scenario: A satellite tag publishes an image and a release

- **WHEN** a `satellite-v*` tag is pushed
- **THEN** CI builds the satellite container image, pushes it to GHCR, and creates a GitHub Release for the tag, using `GITHUB_TOKEN`

#### Scenario: Publishing needs no stored secret

- **WHEN** the satellite publish workflow runs
- **THEN** it authenticates to GHCR with the built-in `GITHUB_TOKEN` and requires no new repository secret

#### Scenario: The satellite release does not deploy the Worker

- **WHEN** a `satellite-v*` tag is pushed
- **THEN** the Worker deploy control plane is not triggered

