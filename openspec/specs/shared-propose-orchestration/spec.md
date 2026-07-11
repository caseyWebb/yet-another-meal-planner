# shared-propose-orchestration Specification

## Purpose
Shared propose orchestration keeps the member app propose page and the MCP Meal Planning
widget on one behavior-preserving implementation for session serialization and slot view
projection while each host owns its own transport, persistence, and degradation behavior.

## Requirements
### Requirement: Shared propose request serialization
The system SHALL provide one shared implementation for serializing the dual-use propose
session into the request body used by the member app propose endpoint and the MCP
propose widget's stateless tool replay.

#### Scenario: Equivalent session serializes identically in both hosts
- **WHEN** the member app host and MCP widget host hold the same propose session state
- **THEN** both hosts use the shared serializer to produce the same canonical request body

#### Scenario: Host plumbing remains outside the shared serializer
- **WHEN** the shared serializer is used by either host
- **THEN** it does not perform localStorage access, TanStack Query calls, MCP bridge calls, or plan commit writes

### Requirement: Shared propose slot view projection
The system SHALL provide one shared implementation for projecting propose result slots
and session edits into the slot view shape consumed by shared propose UI primitives.

#### Scenario: Equivalent slot projects identically in both hosts
- **WHEN** the member app host and MCP widget host render the same propose slot with the same session state
- **THEN** both hosts use the shared projector to produce the same slot view labels, flags, pins, sides, alternates, and lock state

#### Scenario: Widget-specific degradation remains host-owned
- **WHEN** the MCP widget determines whether a proposal can be iterated
- **THEN** host capability checks, palette round-trip checks, race handling, and read-only degradation stay in the widget host rather than the shared projector
