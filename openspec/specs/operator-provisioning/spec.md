# operator-provisioning Specification

## Purpose
TBD - created by archiving change zero-config-deploy. Update Purpose after archive.
## Requirements
### Requirement: Deploy auto-provisions KV namespaces

A new operator's `wrangler.jsonc` SHALL declare its KV namespace bindings **without ids**, and the deploy SHALL rely on `wrangler deploy`'s automatic resource provisioning to create and bind them. The operator SHALL NOT manually create KV namespaces or paste their ids. The deploy SHALL ensure that repeated deploys reuse the same namespaces rather than orphaning prior state (by relying on idempotent provisioning, or by persisting the provisioned ids back to the operator's config).

#### Scenario: First deploy creates and binds KV

- **WHEN** a fresh operator runs the deploy with KV bindings that have no ids
- **THEN** `wrangler deploy` provisions the namespaces, binds them to the Worker, and the operator never created a namespace or copied an id by hand

#### Scenario: Repeat deploys keep the same namespaces

- **WHEN** the operator redeploys after the first deploy
- **THEN** the Worker is bound to the **same** KV namespaces (no duplicate namespace is created and no KV state is orphaned)

### Requirement: Repo coordinates are intuited at deploy, not hand-configured

The deploy SHALL derive `DATA_OWNER` and `DATA_REPO` from the GitHub Actions context (`github.repository`) of the data repo it runs in, and default `DATA_REF` to `main`, injecting them into the deployed Worker's vars. An operator SHALL NOT hand-set these in `wrangler.jsonc`.

#### Scenario: Deploy injects the data-repo coordinates

- **WHEN** the deploy runs in the operator's data repo
- **THEN** the deployed Worker's `DATA_OWNER`/`DATA_REPO` match that repo and `DATA_REF` is `main`, with no operator edit to `wrangler.jsonc`

### Requirement: Per-secret provisioning posture

The GitHub App private key SHALL remain a Cloudflare Worker secret set out-of-band (e.g. the Cloudflare dashboard), and SHALL NOT be stored in any repository or passed through the deploy workflow. The lower-blast-radius Kroger client credentials MAY be set by the deploy from data-repo secrets.

#### Scenario: App key never enters a repo

- **WHEN** the data repo and its Actions secrets are inspected
- **THEN** the GitHub App private key is absent; it exists only as a Cloudflare Worker secret

#### Scenario: Kroger creds set by the deploy

- **WHEN** the operator stores their Kroger client id/secret as data-repo Actions secrets and deploys
- **THEN** the deploy sets them as Worker secrets, with no separate manual dashboard step for them

### Requirement: Deploy merges code-level wrangler config with the operator's

The deploy SHALL assemble the deployed `wrangler.jsonc` by **merging** the code repo's config with the operator's data-repo config, rather than replacing the former with the latter, so that **code-level** configuration propagates to operators automatically. Code-level keys — at least `main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`, and `workers_dev` — SHALL come from the **code** repo's `wrangler.jsonc`. Operator-owned keys — `routes`/custom domain, `name`, and account-specific `vars` — SHALL come from (or be overridden by) the operator's config. The merge SHALL preserve the existing zero-config posture: KV bindings are still declared without ids for auto-provisioning, repo coordinates are still injected via `--var`, and onboard/revoke still resolve bindings from the operator's config.

#### Scenario: A new code-level trigger propagates without operator action

- **WHEN** the code repo's `wrangler.jsonc` declares a `triggers.crons` entry and the operator's data-repo config does not
- **THEN** the deployed config includes that trigger and `wrangler deploy` registers the cron, with no edit to the operator's `wrangler.jsonc`

#### Scenario: Code-level compatibility settings are authoritative

- **WHEN** the operator's config carries stale or absent `compatibility_date` / `compatibility_flags`
- **THEN** the deployed config uses the **code** repo's values for those keys

#### Scenario: Operator-owned keys are honored

- **WHEN** the operator's config sets a custom `name`, `routes`/custom domain, or account-specific `vars`
- **THEN** those operator values appear in the deployed config (operator wins for these keys)

### Requirement: Operator-specific values always originate from the operator

The code repo's `wrangler.jsonc` is the maintainer's real config, so its KV namespace ids and `vars` are the maintainer's. The deploy SHALL ensure neither reaches another operator:

- `kv_namespaces` SHALL be matched **by binding name**: the binding *set* comes from the code repo's config (so a newly-required binding propagates), but each binding's **id SHALL come only from the operator's config**, or be **omitted** (auto-provisioned) when the operator declares no id. The code repo's KV ids SHALL NEVER appear in another operator's deployed config.
- The deployed `vars` SHALL be the **operator's only**; the code repo's `vars` (including `GITHUB_INSTALLATION_ID` and `GITHUB_APP_ID`) SHALL be dropped, with the data-repo coordinates injected via `--var` at deploy.

This prevents a fresh operator's Worker from binding the maintainer's KV namespaces or inheriting the maintainer's GitHub App installation (cross-tenant exposures).

#### Scenario: Operator id wins, code id is discarded

- **WHEN** both the code and operator configs declare the `KROGER_KV` binding, each with a different id
- **THEN** the deployed `KROGER_KV` uses the **operator's** id and the code repo's id does not appear anywhere in the deployed config

#### Scenario: The maintainer's vars never leak

- **WHEN** the code repo's config carries the maintainer's `vars` (e.g. `GITHUB_INSTALLATION_ID`) and the operator's config sets only its own `GITHUB_APP_ID`
- **THEN** the deployed `vars` contain the operator's values and **none** of the maintainer's (the code repo's `vars` are dropped)

#### Scenario: A code-only binding deploys without an id (auto-provisioned)

- **WHEN** the code repo's config declares a KV binding the operator's config does not
- **THEN** the deployed config includes that binding **without an id**, so `wrangler deploy` auto-provisions it for the operator

#### Scenario: Operator-declared id-less binding stays id-less

- **WHEN** the operator declares a binding without an id (the zero-config posture)
- **THEN** the deployed binding has no id and is auto-provisioned, regardless of any id the code repo carries for that binding

### Requirement: The new-operator template declares only operator-owned config

The data-repo template's `wrangler.jsonc` SHALL contain only operator-owned configuration — at minimum `GITHUB_APP_ID`, and optionally `name`, custom domain/`routes`, and id-less KV bindings — and SHALL NOT carry code-level keys (`main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`), which the deploy merge supplies from the code repo. A fresh operator SHALL get a working deployment — including code-level config such as the flyer cron — without copying or maintaining those keys.

#### Scenario: A fresh operator gets code-level config from the merge, not the template

- **WHEN** a new operator copies the template, sets `GITHUB_APP_ID`, and deploys
- **THEN** the deployed Worker has the code repo's `main`, `compatibility_*`, `observability`, and `triggers` (cron registered) even though the template declares none of them

#### Scenario: KV ids are pinned back into a slim operator config

- **WHEN** a fresh operator deploys from the slim template (no `kv_namespaces` ids, or no `kv_namespaces` at all) and later redeploys
- **THEN** the first deploy auto-provisions the namespaces, the provisioned ids are persisted into the operator's config, and the redeploy reuses the same namespaces (no orphaned KV state)

### Requirement: D1 is auto-provisioned and pinned back alongside the KV namespaces

The deploy SHALL provision the operator's D1 database with no manual step, by the same mechanism used for the KV namespaces: the code repo's `wrangler.jsonc` ships an id-less `d1_databases` binding (`DB`); `wrangler deploy` auto-provisions a per-operator database; and the provisioned `database_id` is pinned back into the operator's data-repo config so subsequent deploys reuse it. The config merge (`scripts/merge-wrangler-config.mjs`) SHALL take the D1 binding *set* from the code repo (so a new binding propagates to every operator) and the `database_id` from the operator only (the maintainer's id is stripped, as for KV, to prevent cross-tenant exposure). The pin-back SHALL be a true no-op (no commit) when the D1 id is unchanged.

The operator's `CLOUDFLARE_API_TOKEN` SHALL carry D1 edit permission in addition to Workers + KV. The deploy SHALL apply pending D1 schema migrations (`wrangler d1 migrations apply DB --remote`) after the binding is provisioned, and before projecting the recipe index. There is no separate data-backfill step — the schema apply is the only migration the deploy runs.

#### Scenario: First deploy provisions and pins the D1 database

- **WHEN** a brand-new operator deploys with an id-less `DB` binding
- **THEN** `wrangler deploy` auto-provisions a D1 database, the schema migrations apply, and the provisioned `database_id` is committed back into the operator's `wrangler.jsonc`

#### Scenario: Redeploy reuses the pinned database

- **WHEN** an operator whose `DB` id is already pinned redeploys
- **THEN** the merge binds the existing database, the pin step makes no change (no commit), and no new database is created

#### Scenario: Code-repo D1 id never reaches an operator

- **WHEN** the config merge runs
- **THEN** the maintainer's `database_id` from the code repo's `wrangler.jsonc` is stripped, and only the operator's own id (or none → auto-provision) is used

### Requirement: Deploy optionally stamps the README health badge

When the operator has set the `WORKER_HOST` repo variable, the deploy SHALL render a health-badge markdown snippet pointing at the Worker's open `https://<WORKER_HOST>/health.svg` card (no token — `/health.svg` is open and tenant-clean, so the badge is a plain anonymously-fetchable public URL) and SHALL maintain it in the data-repo README inside an **idempotent marker block**. The deploy SHALL replace the content between existing badge markers when present, and SHALL otherwise insert the marker block immediately after the README's first heading (so a repo created from an older template gains the badge without a manual paste). `WORKER_HOST` SHALL be passed into the reusable deploy workflow by the thin caller (mirroring how the plugin build passes its connector host), not resolved by guessing. When `WORKER_HOST` is absent, the deploy SHALL skip stamping and still succeed (the badge is opt-in).

#### Scenario: Badge is stamped when configured

- **WHEN** `WORKER_HOST` is set and the deploy can write back to the repo
- **THEN** the README contains the marker block with the correct open `/health.svg` URL

#### Scenario: Re-stamp is idempotent

- **WHEN** the badge markers already exist and the deploy runs again with an unchanged URL
- **THEN** only the content between the markers is updated and the README is otherwise unchanged

#### Scenario: Existing repo gains the badge

- **WHEN** the README has no badge markers
- **THEN** the deploy inserts the marker block immediately after the first heading

#### Scenario: Skipped when not opted in

- **WHEN** `WORKER_HOST` is unset
- **THEN** the deploy does not modify the README and still completes successfully

### Requirement: Pin-back is optional with a manual fallback

Persisting deploy-time values back into the operator's data repo — the README health badge **and** the auto-provisioned KV/D1 ids — SHALL be optional and SHALL NOT be required for a successful deploy. When the deploy lacks `contents: write` (or the operator prefers manual setup), it SHALL NOT fail; it SHALL instead surface what the operator needs to apply by hand. In particular, when `WORKER_HOST` is set, the deploy SHALL **always** write the ready-to-paste health-badge snippet to the workflow job summary, regardless of whether it could commit the change. An operator SHALL be able to run the deploy without granting `contents: write` and complete badge setup (and id pinning) manually.

#### Scenario: Deploy without write permission still succeeds

- **WHEN** the deploy cannot push back because the caller did not grant `contents: write`
- **THEN** the deploy completes successfully and warns, rather than failing

#### Scenario: The badge snippet is always surfaced

- **WHEN** the deploy runs with `WORKER_HOST` set
- **THEN** the ready-to-paste badge snippet appears in the job summary whether or not it was committed back

#### Scenario: Manual setup is supported end to end

- **WHEN** an operator declines `contents: write` and pastes the badge snippet from the job summary into their README once
- **THEN** the badge renders and keeps working, because the token and host are stable (no recurring pin-back needed)

