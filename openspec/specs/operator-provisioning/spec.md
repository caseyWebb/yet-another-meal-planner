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

### Requirement: KV-writing workflows address namespaces by binding, not id

The onboard and revoke workflows SHALL address `TENANT_KV` by its **binding name** (resolved from the operator's `wrangler.jsonc`), not by a separately-configured namespace id. The operator SHALL NOT set a `TENANT_KV_ID` variable.

#### Scenario: Onboard writes KV by binding

- **WHEN** the operator runs onboard with no `TENANT_KV_ID` configured
- **THEN** the workflow resolves the `TENANT_KV` binding from `wrangler.jsonc` and writes the allowlist + invite keys to the correct namespace

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

### Requirement: DATA_KV is auto-provisioned alongside the existing KV namespaces

The code repo's `wrangler.jsonc` SHALL declare a `DATA_KV` binding without an id. The deploy SHALL auto-provision the namespace and pin its id back to the operator's `wrangler.jsonc` via the existing pin-back mechanism, identical to how `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV` are handled. The data-repo template SHALL include an id-less `DATA_KV` binding so new operators get it automatically. An operator MAY alternatively create the namespace manually in the Cloudflare dashboard and insert the id directly into their `wrangler.jsonc` — the deploy pin-back will treat a pre-existing id as a no-op.

#### Scenario: First deploy provisions DATA_KV alongside existing namespaces

- **WHEN** a fresh operator deploys with the updated template (which carries an id-less `DATA_KV` binding)
- **THEN** `wrangler deploy` provisions `DATA_KV` and the pin-back step writes its id into the operator's `wrangler.jsonc`, with no manual dashboard step required

#### Scenario: Manually pre-populated id is preserved

- **WHEN** an operator creates a KV namespace in the Cloudflare dashboard and sets its id in `wrangler.jsonc` before deploying
- **THEN** the deploy uses that namespace and the pin-back step leaves the id unchanged

