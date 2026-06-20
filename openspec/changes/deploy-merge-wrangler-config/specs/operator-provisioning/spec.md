## ADDED Requirements

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

### Requirement: KV namespace ids always originate from the operator

When merging `kv_namespaces`, the deploy SHALL match entries **by binding name**: the binding *set* SHALL come from the code repo's config (so a newly-required binding propagates), but each binding's **id SHALL come only from the operator's config** for that binding, or be **omitted** (triggering auto-provisioning) when the operator declares no id. The code repo's KV namespace ids SHALL NEVER appear in the deployed config of another operator. This prevents a fresh operator's Worker from binding the maintainer's KV namespaces (a cross-tenant exposure).

#### Scenario: Operator id wins, code id is discarded

- **WHEN** both the code and operator configs declare the `KROGER_KV` binding, each with a different id
- **THEN** the deployed `KROGER_KV` uses the **operator's** id and the code repo's id does not appear anywhere in the deployed config

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
