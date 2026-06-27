## MODIFIED Requirements

### Requirement: MCP server over Streamable HTTP

The system SHALL host an MCP server in a Cloudflare Worker at the **repo root** (`src/`), exposed over the **Streamable HTTP** transport via `createMcpHandler()`, operating statelessly with **no Durable Objects** and no per-session state. The server SHALL be reachable at a `workers.dev` URL and connectable from a standard MCP client (e.g. MCP Inspector). A server instance SHALL be constructed per request for the **resolved tenant**, so tools close over that tenant's **R2/D1 context** and Kroger context and cannot reach another tenant's data.

#### Scenario: Tools listed over the MCP endpoint

- **WHEN** an MCP client connects to the deployed Worker URL and requests the tool list
- **THEN** the server responds over Streamable HTTP with the registered tools and their input schemas

#### Scenario: No cross-tenant state retained

- **WHEN** two different tenants invoke tools against the Worker
- **THEN** each request is served purely from its own tenant's R2/D1 state, with no shared or carried-over state between tenants or requests

### Requirement: Operator-controlled Worker deployment from the data repo

The Worker SHALL be deployed by the operator from their **data repo** (which MAY be public — it carries nothing secret), the single control plane holding the only deployment secret (`CLOUDFLARE_API_TOKEN`, encrypted). The public code repo SHALL host a **reusable** (`workflow_call`) deploy workflow (`data-deploy.yml`) that checks out the Worker source, overlays the operator's own `wrangler.jsonc`, runs typecheck + tests, then `wrangler deploy`s; the data repo SHALL invoke it from a thin caller. The Worker's own runtime secrets — the **Kroger credentials** — SHALL be set via `wrangler secret put` directly to Cloudflare and SHALL NOT be stored in any repository or in GitHub Actions (there is no GitHub App private key). A push to the **code** repo MAY automatically dispatch the data repo's deploy: `ci.yml`'s `trigger-deploy` job, gated on green CI, fires the data repo's workflow via a fine-grained `DATA_REPO_ACTIONS_TOKEN` (`actions: write` on the data repo only). The public code repo SHALL still hold **no Cloudflare deploy secret** and SHALL NOT run `wrangler deploy` itself — the deploy always executes in the data repo with the data repo's token.

#### Scenario: Deploy runs from the data repo

- **WHEN** the operator (or the code repo's `trigger-deploy`) triggers the data repo's deploy workflow
- **THEN** the reusable `data-deploy.yml` overlays the operator's `wrangler.jsonc` onto the Worker source, runs typecheck + tests, and deploys with the data repo's `CLOUDFLARE_API_TOKEN`

#### Scenario: Public code repo holds no Cloudflare deploy secret

- **WHEN** a commit is pushed to the public code repo
- **THEN** `ci.yml` runs typecheck + both test suites with no Cloudflare secret and runs no `wrangler deploy` itself; on Worker/plugin-relevant changes it only **dispatches** the data repo's deploy (which runs there, with the data repo's token)

## REMOVED Requirements

### Requirement: Authenticated GitHub data-access client

**Reason**: The Worker no longer reads or writes a recipe corpus via a GitHub App installation token. The authored corpus lives in a Cloudflare **R2** bucket, read/written through `src/corpus-store.ts`; there is no GitHub App, installation token, or data repo on the data path. The corpus data-access contract is owned by the `r2-corpus-store` capability, and per-tenant data lives in D1 (`src/db.ts`).

**Migration**: See `r2-corpus-store` for the corpus data-access contract (native R2 binding, no per-request token). The structured-error and workers-runtime-safe-parsing requirements that remain in this spec still apply to the R2/D1 data path.
