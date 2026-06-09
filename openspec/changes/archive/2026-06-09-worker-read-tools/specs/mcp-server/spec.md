## ADDED Requirements

### Requirement: MCP server over Streamable HTTP

The system SHALL host an MCP server in a Cloudflare Worker under `worker/`, exposed over the **Streamable HTTP** transport via `createMcpHandler()`, operating statelessly with **no Durable Objects** and no per-session state. The server SHALL be reachable at a `workers.dev` URL and connectable from a standard MCP client (e.g. MCP Inspector).

#### Scenario: Tools listed over the MCP endpoint

- **WHEN** an MCP client connects to the deployed Worker URL and requests the tool list
- **THEN** the server responds over Streamable HTTP with the registered read tools and their input schemas

#### Scenario: No session state retained

- **WHEN** two independent MCP clients invoke tools against the Worker
- **THEN** each request is served purely from repo state with no shared or carried-over session state between requests

### Requirement: Authenticated GitHub data-access client

The system SHALL provide a single GitHub client wrapper used for all repo reads, authenticating with a fine-grained personal access token supplied as a Worker secret. The client SHALL read data at `main` HEAD, apply basic retry with backoff on transient failures and rate-limit responses, and surface failures as structured errors rather than throwing. The client SHALL be the shared data-access path reused by later changes.

#### Scenario: Reads use the authenticated token

- **WHEN** any read tool fetches repo data
- **THEN** the GitHub client issues an authenticated request (benefiting from the 5,000 req/hr limit) rather than an anonymous one

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

### Requirement: Authless deployment with a hard pre-write security gate

For this change the Worker SHALL be deployed **authless** (no client authentication), which is acceptable only because it exposes read-only tools over a public repo. The system SHALL NOT introduce any write, cart, or external-service tool in this change. Securing the client-to-Worker connection (e.g. Cloudflare Access) is out of scope here but SHALL be required before any write or cart tool is exposed.

#### Scenario: Only read-only tools are exposed

- **WHEN** the Worker's tool surface is inspected after this change
- **THEN** it contains only repo-data read tools and no tool that writes the repo, writes a cart, or calls an external service

### Requirement: Continuous deployment of the Worker

The system SHALL provide `.github/workflows/deploy-worker.yml` that deploys the Worker on push to `worker/**`, authenticating to Cloudflare with an API token stored in GitHub Actions secrets. The Worker's own secrets (the GitHub token, and later external-service tokens) SHALL be set via `wrangler secret put` directly to Cloudflare and SHALL NOT be stored in the repository or in GitHub Actions.

#### Scenario: Push to worker source redeploys

- **WHEN** a commit changes a file under `worker/`
- **THEN** the deploy workflow runs and publishes the updated Worker using the Cloudflare API token from Actions secrets

#### Scenario: Worker secrets never live in the repo

- **WHEN** the repository and the deploy workflow are inspected
- **THEN** no GitHub PAT or external-service token appears in tracked files or workflow definitions; such secrets exist only in Cloudflare via `wrangler secret put`
