## ADDED Requirements

### Requirement: Connector grants are member-bound

A connector authorization SHALL record WHICH member approved it: the OAuth grant issued for a Claude.ai (or other MCP client) connection carries the approving member's `(tenantId, memberId)` pair in its props, bound at cross-device approval time from the approving web-app session (see `passkey-auth`), with the grant's `userId` remaining the tenant id. Every MCP request through the connector SHALL resolve this `(tenantId, memberId)` pair before any tool runs (see `multi-tenancy`); the tenant remains the isolation boundary and the member is the attribution the band's member-scoped features consume. A grant issued before the member-identity split, whose props carry only `{ tenantId }`, SHALL resolve to the tenant's founding member and SHALL keep working with no re-authorization — the connector's externally-observable behavior for existing connections is unchanged.

#### Scenario: A new connection is attributed to the approving member

- **WHEN** a member approves a pending connector authorization from their passkey-authenticated web-app session
- **THEN** the issued grant's props carry that member's tenant id and member id, and subsequent tool calls through the connection resolve that member as the acting member

#### Scenario: An existing connection keeps working as the founding member

- **WHEN** a Claude.ai connection authorized before the member-identity split makes an MCP request
- **THEN** the request resolves to the tenant's founding member and completes exactly as before the split, with no re-connect or re-authorization required

#### Scenario: Two members of one household hold distinct grants

- **WHEN** two members of the same household each approve their own Claude.ai connection
- **THEN** two grants exist with the same tenant id and distinct member ids, tool calls through each are attributed to the approving member, and both operate on the same household's tenant-scoped data
