## ADDED Requirements

### Requirement: DATA_KV is auto-provisioned alongside the existing KV namespaces

The code repo's `wrangler.jsonc` SHALL declare a `DATA_KV` binding without an id. The deploy SHALL auto-provision the namespace and pin its id back to the operator's `wrangler.jsonc` via the existing pin-back mechanism, identical to how `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV` are handled. The data-repo template SHALL include an id-less `DATA_KV` binding so new operators get it automatically. An operator MAY alternatively create the namespace manually in the Cloudflare dashboard and insert the id directly into their `wrangler.jsonc` — the deploy pin-back will treat a pre-existing id as a no-op.

#### Scenario: First deploy provisions DATA_KV alongside existing namespaces

- **WHEN** a fresh operator deploys with the updated template (which carries an id-less `DATA_KV` binding)
- **THEN** `wrangler deploy` provisions `DATA_KV` and the pin-back step writes its id into the operator's `wrangler.jsonc`, with no manual dashboard step required

#### Scenario: Manually pre-populated id is preserved

- **WHEN** an operator creates a KV namespace in the Cloudflare dashboard and sets its id in `wrangler.jsonc` before deploying
- **THEN** the deploy uses that namespace and the pin-back step leaves the id unchanged
