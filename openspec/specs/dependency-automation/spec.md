# dependency-automation Specification

## Purpose

Defines how the repo keeps its dependencies current and secure: Dependabot configuration for both npm and GitHub Actions ecosystems, and the SHA-pinning convention for Actions references that ensures immutable, auditable workflow steps.
## Requirements
### Requirement: Dependabot monitors npm dependencies
The repo SHALL have a `.github/dependabot.yml` that configures Dependabot to open automated PRs for npm ecosystem updates on a weekly schedule, targeting the root `package.json`.

#### Scenario: npm dependency has a new version available
- **WHEN** a new version of any npm dependency (production or dev) is published
- **THEN** Dependabot SHALL open a PR against `main` within one weekly interval

#### Scenario: Related Cloudflare packages update together
- **WHEN** one or more of `@cloudflare/workers-types`, `@cloudflare/workers-oauth-provider`, or `wrangler` have available updates
- **THEN** Dependabot SHALL group them into a single PR rather than separate PRs

#### Scenario: Related MCP runtime packages update together
- **WHEN** one or more of `@modelcontextprotocol/sdk` or `agents` have available updates
- **THEN** Dependabot SHALL group them into a single PR rather than separate PRs

### Requirement: Dependabot monitors GitHub Actions
The `.github/dependabot.yml` SHALL configure Dependabot to open automated PRs for GitHub Actions version updates on a weekly schedule.

#### Scenario: GitHub Action has a new version available
- **WHEN** a new version of any Action used in `.github/workflows/` is released
- **THEN** Dependabot SHALL open a PR updating the pinned SHA and version comment

### Requirement: GitHub Actions are SHA-pinned
All `uses:` references to external GitHub Actions in `.github/workflows/*.yml` SHALL use immutable commit SHAs rather than mutable version tags, with the human-readable tag annotated in a trailing comment.

#### Scenario: Workflow file references an external Action
- **WHEN** a workflow file contains a `uses: <owner>/<action>@<ref>` step
- **THEN** `<ref>` SHALL be a full 40-character commit SHA
- **THEN** the line SHALL include a trailing comment of the form `# vN.M.P` identifying the pinned version

#### Scenario: Dependabot updates an Action
- **WHEN** Dependabot opens a PR updating an Action
- **THEN** the PR SHALL contain an updated SHA and an updated version comment
- **THEN** CI SHALL pass on the PR (no workflow syntax errors introduced)

### Requirement: Dependabot npm updates observe a cooldown aligned with aube
The `.github/dependabot.yml` npm update entry SHALL configure a `cooldown` of `default-days: 7`, kept numerically aligned with the committed aube `minimum-release-age` (10080 minutes). Because both tools select the newest version that is old enough rather than blocking outright, the shared 7-day threshold ensures Dependabot only proposes npm versions that aube will install.

#### Scenario: A day-zero npm release is not proposed
- **WHEN** a new version of an npm dependency was published less than 7 days ago
- **THEN** Dependabot SHALL NOT open a PR for that version, instead proposing the newest version at least 7 days old (if any)

#### Scenario: Cooldown stays aligned with aube
- **WHEN** the supply-chain cooldown threshold is changed
- **THEN** the Dependabot `cooldown.default-days` and the aube `minimum-release-age` SHALL be updated together to remain numerically equal

#### Scenario: Security updates are exempt from cooldown
- **WHEN** Dependabot raises a security update
- **THEN** the `cooldown` SHALL NOT delay it (security updates are exempt by Dependabot's design)

