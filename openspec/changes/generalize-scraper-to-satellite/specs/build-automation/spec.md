## RENAMED Requirements

- FROM: `### Requirement: The scraper is published as a container image on a tagged release`
- TO: `### Requirement: The satellite is published as a container image on a tagged release`

## MODIFIED Requirements

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
