# instacart-adapter — delta

## MODIFIED Requirements

### Requirement: One operation serves MCP and member API with structured failures

The MCP tool `create_instacart_handoff` and session-gated `POST /api/grocery/instacart` SHALL call one shared operation and return the same discriminated result contract. The MCP tool SHALL register only when the Instacart configuration resolves (`mcp-tool-gating`); the shared operation SHALL retain its structured `unavailable`/`not_configured` result for the member API and for any race where configuration disappears between registration and call. The member mutation SHALL be online-only and SHALL NOT enter offline replay. The operation SHALL map validation, 401, 403, 429, network/5xx, and invalid-response failures to stable closed error codes with an honest retryability flag; it SHALL not reflect the API key or unsafe upstream response content in output or logs and SHALL not automatically retry page creation.

#### Scenario: Tool and endpoint share behavior

- **WHEN** the same tenant and to-buy state invoke the MCP tool and member endpoint on a configured deployment
- **THEN** both use the same mapping/cache/external-call operation and return the same result shape

#### Scenario: An unconfigured deployment advertises no handoff tool

- **WHEN** the deployment has no Instacart API key
- **THEN** `create_instacart_handoff` is absent from the tool list, while the member endpoint still returns the structured `not_configured` result

#### Scenario: Production permission failure is distinguishable

- **WHEN** Instacart returns 401 or 403 for a configured key
- **THEN** the operation returns `unauthorized` or `forbidden` without leaking the key or raw upstream body and without writing a cache row

#### Scenario: Rate limit and upstream outage are retryable

- **WHEN** Instacart returns 429, a 5xx response, a timeout, or a network failure
- **THEN** the operation returns the corresponding structured retryable error and does not claim that a handoff page exists

#### Scenario: Handoff is not queued offline

- **WHEN** the member app is offline or a handoff request is interrupted
- **THEN** it is not persisted for replay and the member must explicitly retry online
