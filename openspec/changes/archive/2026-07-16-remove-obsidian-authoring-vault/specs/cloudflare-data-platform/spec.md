## MODIFIED Requirements

### Requirement: D1 is the system of record for domain data

The Worker SHALL bind a Cloudflare D1 database as `DB` (`env.DB`). D1 is the storage tier for domain and operational data — data that is queried, related, admin-editable, or requires read-after-write consistency. The three-tier boundary is:

- **R2** holds authored recipe + guidance markdown (`recipes/*.md`, `guidance/**/*.md`) — the source of truth for human-authored corpus content, hand-edited via any S3-compatible file tool (e.g. `rclone`). The Worker SHALL bind the R2 bucket and read/list/write the corpus through it; there is no GitHub App or installation token on the data path. (Git history for the corpus is not retained; this is a deliberate trade.)
- **D1** holds all domain/operational data and derived projections (recipe index, profile, session state, cooking log, shared corpus, attributed notes, registries, config, caches).
- **KV** holds ephemeral infrastructure only (`KROGER_KV`: tokens, PKCE verifiers, TTL flyer cache, background-job health; `OAUTH_KV`: provider state; `TENANT_KV`: directory/invites). No domain data lives in KV; the Worker binds only `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV`.

Authored markdown SHALL NOT be stored in D1 — D1 is the relational/derived tier, and a file-based editor has no interface to a D1 row; the corpus is files, in R2.

#### Scenario: Worker binds D1 and R2

- **WHEN** the Worker starts with a provisioned D1 database and R2 corpus bucket
- **THEN** `env.DB` and the R2 binding are available, `/health` reports the database reachable (`SELECT 1` succeeds), and recipe/guidance reads resolve from R2

#### Scenario: Health surfaces a misprovisioned database

- **WHEN** D1 is unreachable or unprovisioned
- **THEN** `/health` reports the D1 probe as failing, rather than the failure first appearing at a tool call

#### Scenario: No domain data remains in KV

- **WHEN** the recipe index, profile, session state, cooking log, shared corpus, and attributed notes have all moved to D1
- **THEN** the Worker binds only `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV` (ephemeral infrastructure), and no domain-data KV key remains

#### Scenario: Authored corpus is files in R2, not rows in D1

- **WHEN** a recipe or guidance document is created or edited
- **THEN** it is persisted as a markdown object in R2 (editable by a file-based tool), and only its derived projection (the index) is written to D1
