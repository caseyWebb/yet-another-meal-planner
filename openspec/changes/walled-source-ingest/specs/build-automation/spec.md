## ADDED Requirements

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

A scoped release tag (`scraper-v*`) SHALL build the scraper **container image**, publish it to the GitHub Container Registry (GHCR), and cut a **GitHub Release** for that tag. This publish SHALL run in the code repository using the built-in `GITHUB_TOKEN` (with package-write permission) — it SHALL NOT require a new stored Actions secret, preserving the "no Actions secrets in the public code repo" invariant. The scraper release SHALL be independent of the Worker deploy control plane (a scraper tag SHALL NOT deploy the Worker, and a Worker deploy SHALL NOT publish a scraper image). The image SHALL embed the scraper's build version and the recipe-**contract** version it targets, so a running scraper can report both to the Worker for the admin liveness/skew view.

#### Scenario: A scraper tag publishes an image and a release

- **WHEN** a `scraper-v*` tag is pushed
- **THEN** CI builds the scraper container image, pushes it to GHCR, and creates a GitHub Release for the tag, using `GITHUB_TOKEN`

#### Scenario: Publishing needs no stored secret

- **WHEN** the scraper publish workflow runs
- **THEN** it authenticates to GHCR with the built-in `GITHUB_TOKEN` and requires no new repository secret

#### Scenario: The scraper release does not deploy the Worker

- **WHEN** a `scraper-v*` tag is pushed
- **THEN** the Worker deploy control plane is not triggered
