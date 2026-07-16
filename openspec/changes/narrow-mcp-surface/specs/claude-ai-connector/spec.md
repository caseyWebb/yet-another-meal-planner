# claude-ai-connector — delta

## MODIFIED Requirements

### Requirement: Authorized write commits end-to-end from a connected Claude.ai client

A connected Claude.ai client SHALL be able to perform an authorized write that lands a real persisted change through the Access OAuth path. A read-only verification MUST NOT be treated as sufficient.

#### Scenario: Pantry update commits through the gate

- **WHEN** the owner says "I ran out of olive oil" and confirms the update
- **THEN** the agent invokes `update_pantry` through the connector, the write succeeds through Cloudflare Access, and the pantry row is updated in D1

#### Scenario: Recipe disposition commits through the gate

- **WHEN** the owner says "mark the salmon thing as a favorite"
- **THEN** the agent invokes `set_recipe_disposition` through the connector and the change is persisted in D1
