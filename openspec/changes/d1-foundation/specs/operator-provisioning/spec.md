## ADDED Requirements

### Requirement: D1 is auto-provisioned and pinned back alongside the KV namespaces

The deploy SHALL provision the operator's D1 database with no manual step, by the same mechanism used for the KV namespaces: the code repo's `wrangler.jsonc` ships an id-less `d1_databases` binding (`DB`); `wrangler deploy` auto-provisions a per-operator database; and the provisioned `database_id` is pinned back into the operator's data-repo config so subsequent deploys reuse it. The config merge (`scripts/merge-wrangler-config.mjs`) SHALL take the D1 binding *set* from the code repo (so a new binding propagates to every operator) and the `database_id` from the operator only (the maintainer's id is stripped, as for KV, to prevent cross-tenant exposure). The pin-back SHALL be a true no-op (no commit) when the D1 id is unchanged.

The operator's `CLOUDFLARE_API_TOKEN` SHALL carry D1 edit permission in addition to Workers + KV. The deploy SHALL apply pending D1 schema migrations (`wrangler d1 migrations apply DB --remote`) after the binding is provisioned and before any data backfill runs.

#### Scenario: First deploy provisions and pins the D1 database

- **WHEN** a brand-new operator deploys with an id-less `DB` binding
- **THEN** `wrangler deploy` auto-provisions a D1 database, the schema migrations apply, and the provisioned `database_id` is committed back into the operator's `wrangler.jsonc`

#### Scenario: Redeploy reuses the pinned database

- **WHEN** an operator whose `DB` id is already pinned redeploys
- **THEN** the merge binds the existing database, the pin step makes no change (no commit), and no new database is created

#### Scenario: Code-repo D1 id never reaches an operator

- **WHEN** the config merge runs
- **THEN** the maintainer's `database_id` from the code repo's `wrangler.jsonc` is stripped, and only the operator's own id (or none → auto-provision) is used
