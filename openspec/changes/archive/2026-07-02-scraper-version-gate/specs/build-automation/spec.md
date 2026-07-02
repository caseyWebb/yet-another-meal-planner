## ADDED Requirements

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
