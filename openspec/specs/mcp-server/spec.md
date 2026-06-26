# mcp-server Specification

## Purpose

Defines the Cloudflare Worker MCP runtime: the Streamable-HTTP transport via `createMcpHandler` (stateless, no Durable Objects), the authenticated GitHub data-access client, the workerd-safe parsing approach, the structured-error convention shared by all tools, the authless-now / secure-by-write-time deployment posture, and the Worker's continuous deployment.
## Requirements
### Requirement: MCP server over Streamable HTTP

The system SHALL host an MCP server in a Cloudflare Worker at the **repo root** (`src/`), exposed over the **Streamable HTTP** transport via `createMcpHandler()`, operating statelessly with **no Durable Objects** and no per-session state. The server SHALL be reachable at a `workers.dev` URL and connectable from a standard MCP client (e.g. MCP Inspector). A server instance SHALL be constructed per request for the **resolved tenant**, so tools close over that tenant's repo coordinates and Kroger context and cannot reach another tenant's data.

#### Scenario: Tools listed over the MCP endpoint

- **WHEN** an MCP client connects to the deployed Worker URL and requests the tool list
- **THEN** the server responds over Streamable HTTP with the registered tools and their input schemas

#### Scenario: No cross-tenant state retained

- **WHEN** two different tenants invoke tools against the Worker
- **THEN** each request is served purely from its own tenant's repo state, with no shared or carried-over state between tenants or requests

### Requirement: Authenticated GitHub data-access client

The system SHALL provide a GitHub client wrapper used for all repo reads and writes, authenticating per request with a short-lived **GitHub App installation token** scoped to the single data repository, minted on demand from the App's id + private key. The client SHALL read data at the configured ref's HEAD, apply basic retry with backoff on transient failures and rate-limit responses, and surface failures as structured errors rather than throwing. The client SHALL NOT use a personal access token. Personal files SHALL be addressed by prefixing repo-relative paths with the resolved tenant's `users/<username>/`, so no tool can reach another tenant's subtree.

#### Scenario: Reads use the installation token, scoped to the tenant's subtree

- **WHEN** any read or write tool fetches or persists a tenant's personal data
- **THEN** the GitHub client authenticates with the App installation token (benefiting from the per-installation 5,000 req/hr limit, not a PAT or anonymous request) and addresses the file under that tenant's `users/<username>/` prefix

#### Scenario: Upstream failure surfaces structured

- **WHEN** GitHub is unreachable or returns a rate-limit response after retries are exhausted
- **THEN** the client returns a structured `upstream_unavailable` error and does not throw an unhandled exception

### Requirement: Workers-runtime-safe parsing

The system SHALL parse recipe frontmatter by splitting on the leading `---` fence and parsing the YAML block with a pure-JavaScript parser (`js-yaml`), and SHALL parse TOML with `smol-toml`. The system SHALL NOT use `gray-matter` in the Worker. All parsing SHALL run on the `workerd` runtime without Node-only APIs.

#### Scenario: Recipe frontmatter parsed on workerd

- **WHEN** the Worker reads a recipe markdown file
- **THEN** it separates frontmatter from body via the `---` fence and parses the frontmatter with `js-yaml`, producing a structured object without relying on Node `Buffer`/`fs`

#### Scenario: Malformed data is reported, not crashed

- **WHEN** a TOML or frontmatter document fails to parse
- **THEN** the tool returns a structured `malformed_data` error and the Worker stays responsive

### Requirement: Structured error convention

Every tool SHALL return a structured result on failure of the form `{ error: <code>, message: <human-readable>, ... }` and SHALL NOT surface raw exceptions or unstructured 5xx bodies to the client. The convention SHALL define at least these codes: `not_found`, `index_unavailable`, `upstream_unavailable`, `malformed_data`, and `unsupported`.

#### Scenario: Failure returns a reasoned error object

- **WHEN** a tool cannot complete (missing resource, bad upstream, unparseable data, or unsupported request)
- **THEN** it returns an object carrying an enumerated `error` code and a human-readable `message` the agent can act on

### Requirement: Write tools permitted behind the gate

With per-tenant identity in place, the Worker's tool surface MAY include repo-data write tools (per the `data-write-tools` and `grocery-list` capabilities) **and the cart-write / external-service tools of the `order-placement` and `kroger-user-auth` capabilities** (`place_order` and the Kroger OAuth flow). Every such tool SHALL operate only in the resolved tenant's context. The Kroger cart write reaches an external service from behind the gate, and `place_order` SHALL remain the **only** tool that writes a Kroger cart.

#### Scenario: Cart and write tools exposed behind the per-tenant gate

- **WHEN** the Worker's tool surface is inspected after this change
- **THEN** it includes the repo-data write tools and `place_order`, all reachable only after the request resolves to an allowlisted tenant, and all acting on that tenant's data only

### Requirement: Operator-controlled Worker deployment from the data repo

The Worker SHALL be deployed by the operator from their **private data repo**, which is the single control plane holding the only deployment secret (`CLOUDFLARE_API_TOKEN`). The public code repo SHALL host a **reusable** (`workflow_call`) deploy workflow (`data-deploy.yml`) that checks out the Worker source, overlays the operator's own `wrangler.jsonc`, runs typecheck + tests, then `wrangler deploy`s; the data repo SHALL invoke it from a thin caller. The public code repo SHALL hold **no Actions secrets** — pushes there run only typecheck + both test suites (`ci.yml`), never a deploy. The Worker's own runtime secrets (GitHub App private key, Kroger credentials) SHALL be set via `wrangler secret put` directly to Cloudflare and SHALL NOT be stored in any repository or in GitHub Actions. There SHALL be no automatic deploy triggered by a push to the public code repo — a push trigger would require a data-repo-writable credential stored in a public repo; deployment is operator-triggered (e.g. `gh workflow run deploy.yml` against the data repo).

#### Scenario: Deploy runs from the private data repo

- **WHEN** the operator triggers the data repo's deploy workflow
- **THEN** the reusable `data-deploy.yml` overlays the operator's `wrangler.jsonc` onto the Worker source, runs typecheck + tests, and deploys with the data repo's `CLOUDFLARE_API_TOKEN`

#### Scenario: Public code repo holds no deploy secret

- **WHEN** a commit is pushed to the public code repo
- **THEN** only `ci.yml` runs (typecheck + both test suites) with no secrets, and no deploy occurs from the public repo

