## ADDED Requirements

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
