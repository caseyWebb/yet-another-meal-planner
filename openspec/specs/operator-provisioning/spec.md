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
