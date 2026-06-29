# tool-usage-trends Specification

## Purpose

The per-MCP-tool-call **history** tier — the request-path sibling of `usage-trends`. Every tool call emits one tenant-clean Analytics Engine data point (tool name, outcome, duration) at zero KV/D1 cost, captured at a single registration seam so every tool — present and future — is instrumented with no per-call-site wiring. The operator Usage page reads them back as per-tool aggregates (call frequency, error rate, latency percentiles), surfacing *which tools are used, how often, and how they perform* — the request-path attribution neither the account-level usage snapshot nor the per-job trends can show.

## Requirements

### Requirement: Each MCP tool call emits a per-call usage data point

Every registered MCP tool call SHALL emit **one tenant-clean data point** to a Workers Analytics Engine dataset (binding `TOOL_AE`, dataset `grocery_tool`), carrying the **tool name**, the call **outcome** (`"ok"` | `"error"`), and the call **duration** in milliseconds. The emission SHALL be **best-effort** — an unbound binding or a throwing `writeDataPoint` SHALL be a swallowed no-op that does not change the tool's result — and SHALL be **non-blocking**, emitted only after the tool's result is computed so it adds no latency to the response. The data point SHALL be **tenant-data-free** by construction: tool name, outcome, and duration only, never a username, tenant id, or call arguments. The emission SHALL consume neither the KV nor the D1 operation budget. The dataset's blob/double **slot layout is positional and a documented contract** (`docs/SCHEMAS.md`); a later change SHALL NOT reorder existing slots.

#### Scenario: A completed tool call emits a tenant-clean data point

- **WHEN** a registered MCP tool call finishes (success or structured error)
- **THEN** one AE data point is written carrying the tool name, the outcome, and the duration — and no per-tenant identifier or call arguments

#### Scenario: Outcome reflects success and failure

- **WHEN** a tool returns a structured error result (the MCP result is flagged `isError`) or the handler throws
- **THEN** the emitted point's outcome is `"error"`; otherwise it is `"ok"`

#### Scenario: Emission never affects the tool

- **WHEN** the `TOOL_AE` binding is absent or `writeDataPoint` throws
- **THEN** the tool's result is unchanged and the call completes exactly as it would without instrumentation

#### Scenario: Emission consumes no KV or D1 budget and adds no latency

- **WHEN** a tool call emits its usage data point
- **THEN** the write goes only to Analytics Engine, performs no KV or D1 operation, and is emitted after the result is computed

### Requirement: Tool instrumentation is applied at a single registration seam

The instrumentation SHALL be applied by wrapping tool registration **once** so that every registered tool — across all registration modules, and any tool added later — is instrumented without per-tool or per-call-site changes. The wrap SHALL derive the outcome from the tool's own result and SHALL NOT alter that result.

#### Scenario: Every registered tool is instrumented from one wrap

- **WHEN** the server registers its tools (the inline tools and those added by the group-registration functions)
- **THEN** each registered tool emits a data point on every call, with no instrumentation code at the individual tool definitions

#### Scenario: A newly added tool is instrumented automatically

- **WHEN** a new tool is registered through the same server registration path
- **THEN** it emits per-call data points without any additional instrumentation wiring

### Requirement: The tool-usage Analytics Engine binding propagates to every operator

The `TOOL_AE` Analytics Engine dataset is a **second** `analytics_engine_datasets` binding instance the deploy config merge must carry. The merge (`scripts/merge-wrangler-config.mjs`) SHALL propagate **both** the existing `grocery_usage` binding and the new `grocery_tool` binding **verbatim from code** to every operator's deployed config (neither carries an operator-owned id). A regression test SHALL assert that both dataset bindings survive the merge, guarding the silent-drop trap for a second instance of the type.

#### Scenario: Both AE bindings survive the config merge

- **WHEN** the deploy merges the code config with an operator's config
- **THEN** the merged config retains both the `grocery_usage` and the `grocery_tool` Analytics Engine bindings from code

#### Scenario: A dropped second binding is caught by a test

- **WHEN** the merge would drop the second `analytics_engine_datasets` instance
- **THEN** the merge-config test fails (the binding would otherwise be silently absent from operators' deploys)

### Requirement: Operator tool-usage view

The Worker SHALL serve a per-tool **usage** view on the Usage page (`/admin/usage`), backed by `GET /admin/api/usage/tools`, reporting each tool's **call count**, **latency** (including a high percentile such as p95), and **error rate** over a recent window of days. The endpoint SHALL source the series from the **Analytics Engine SQL API** (`/accounts/<id>/analytics_engine/sql`, reusing `CF_ACCOUNT_ID` and the analytics token) via an outbound request that performs **no KV or D1 operation**. It SHALL be **aggregate-only and tenant-data-free** (per-tool aggregates, never per-tenant or per-call rows) and inherit the `/admin*` Cloudflare Access gate.

#### Scenario: Configured tool view reports per-tool metrics

- **WHEN** the operator opens the Usage page's tool panel with `CF_ACCOUNT_ID` and the analytics token configured
- **THEN** it shows each tool's recent-window call count, latency (incl. a high percentile), and error rate, sourced from the AE SQL API, with no per-tenant data

#### Scenario: Serving the tool view performs no KV or D1 operation

- **WHEN** `GET /admin/api/usage/tools` handles a request
- **THEN** it reaches only the Analytics Engine SQL API and performs no KV or D1 operation

### Requirement: Tool-usage view degrades gracefully when unconfigured

The tool-usage view SHALL be **opt-in**, reusing the usage-observability config (`CF_ACCOUNT_ID` + the read-only analytics token). When either is unset, `GET /admin/api/usage/tools` SHALL report an explicit not-configured result without making a request, and the panel SHALL render an explicit "not available" state rather than an error. A SQL/transport failure SHALL surface as `upstream_unavailable`.

#### Scenario: Unconfigured analytics renders a not-available state

- **WHEN** the operator opens the tool panel with the analytics token (or account id) unset
- **THEN** `GET /admin/api/usage/tools` reports a not-configured result and the panel renders an explicit "not available" state, making no request

#### Scenario: A query failure is a structured upstream error

- **WHEN** the AE SQL request fails or returns an error
- **THEN** `GET /admin/api/usage/tools` responds with an `upstream_unavailable` error rather than throwing
