# mcp-server — delta

## ADDED Requirements

### Requirement: Initialize instructions carry a minimal routing preamble

The MCP server's initialize result SHALL carry an `instructions` field containing a minimal tool-routing preamble — that a member's show-me ask is answered by rendering the matching display tool, that the read tools are agent-internal and never pasted as the answer to a show-me ask, and that member-facing prose stays in plain language. The preamble SHALL NOT carry the persona (voice, learning posture, flow choreography) and SHALL stay within a few lines, so hosts that inject server instructions (claude.ai) get routing redundancy while the tool descriptions remain the load-bearing mechanism on every host.

#### Scenario: The handshake serves the preamble

- **WHEN** a client completes the MCP initialize handshake
- **THEN** the result's `instructions` field states the show-me-renders-the-display-tool rule in a few lines, with no persona content

#### Scenario: Descriptions remain sufficient without the preamble

- **WHEN** a host ignores the `instructions` field entirely
- **THEN** the display/read tool descriptions alone still carry the routing guarantee
