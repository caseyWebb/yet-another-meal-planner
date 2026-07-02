## MODIFIED Requirements

### Requirement: The scraper is published as a container image on a tagged release

A scoped release tag (`scraper-v*`) SHALL build the scraper **container image**, publish it to the GitHub Container Registry (GHCR), and cut a **GitHub Release** for that tag. The published image SHALL be a **multi-architecture manifest list covering `linux/amd64` and `linux/arm64`**, so it runs natively on both x86 home servers and Apple-Silicon/arm64 home hosts (the browser tier's headless Chromium included) with no CPU emulation. This publish SHALL run in the code repository using the built-in `GITHUB_TOKEN` (with package-write permission) — it SHALL NOT require a new stored Actions secret, preserving the "no Actions secrets in the public code repo" invariant. The scraper release SHALL be independent of the Worker deploy control plane (a scraper tag SHALL NOT deploy the Worker, and a Worker deploy SHALL NOT publish a scraper image). The image SHALL embed the scraper's build version and the recipe-**contract** version it targets, so a running scraper can report both to the Worker for the admin liveness/skew view.

#### Scenario: A scraper tag publishes an image and a release

- **WHEN** a `scraper-v*` tag is pushed
- **THEN** CI builds the scraper container image, pushes it to GHCR, and creates a GitHub Release for the tag, using `GITHUB_TOKEN`

#### Scenario: The published image is multi-arch

- **WHEN** a `scraper-v*` tag is pushed
- **THEN** the pushed image is a manifest list carrying both `linux/amd64` and `linux/arm64`, so an Apple-Silicon home host runs it natively without emulation

#### Scenario: Publishing needs no stored secret

- **WHEN** the scraper publish workflow runs
- **THEN** it authenticates to GHCR with the built-in `GITHUB_TOKEN` and requires no new repository secret

#### Scenario: The scraper release does not deploy the Worker

- **WHEN** a `scraper-v*` tag is pushed
- **THEN** the Worker deploy control plane is not triggered
