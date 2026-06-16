## MODIFIED Requirements

### Requirement: Per-tenant subtree and GitHub App installation tokens

The Worker SHALL resolve each tenant to its `users/<username>/` path prefix within the single shared data repository and SHALL authenticate all repo reads and writes with a short-lived **GitHub App installation token** minted on demand from the App's credentials, scoped to the installation covering the data repository. The Worker SHALL resolve **which installation covers the data repository at runtime** from the App's installations (`GET /app/installations`, authenticated with the App JWT), caching the resolved installation id; it SHALL NOT require a hand-configured installation id. The Worker SHALL address a tenant's personal files by prefixing repo-relative paths with that tenant's `users/<username>/`, so a tool for one tenant cannot read or write another tenant's subtree. The Worker SHALL NOT use a personal access token for repo access, and no per-tenant long-lived user PAT SHALL be stored. Installation tokens SHALL be treated as ephemeral (re-minted on expiry).

#### Scenario: Writes use a scoped installation token under the tenant's subtree

- **WHEN** a tool for tenant A persists a change to A's personal state
- **THEN** the Worker mints a GitHub App installation token covering the data repo, and writes the file under `users/A/`, never another tenant's subtree, and never with a PAT

#### Scenario: No PAT

- **WHEN** the Worker configuration and secrets are inspected
- **THEN** repo access is via the GitHub App (id + private key), with no repo-wide PAT and no stored per-user PAT

#### Scenario: Installation id is resolved from the App, not hand-configured

- **WHEN** the Worker needs an installation token and no installation id is configured
- **THEN** it lists the App's installations with the App JWT, selects the one covering the data repo, caches the id, and mints the token — requiring no `GITHUB_INSTALLATION_ID` var
