## ADDED Requirements

### Requirement: Shared propose controller and host adapters

The system SHALL provide ONE shared propose controller (a hook) that owns the dual-use propose
state machine — the client session, the per-slot refinement reducers (per-meal counts, swap, facet
pins, per-slot vibe override, sides editing), the slot→view derivation, the commit week assembly,
and the iterate/sync/commit channel discipline — so that neither the member app propose page nor
the MCP propose widget carries a duplicated reducer set. Each host SHALL supply a
`ProposeHostAdapter` providing the transport-specific primitives: `iterate` (a PURE query — run one
proposal for a request and return the result, with no model-context push inside it), a `syncContext`
(the single model-context push channel — surface a full-state snapshot), and `commit`. The
controller SHALL own the model-context channel: after a request-changing edit's `iterate` result
lands AND passes the iteration seq guard, the controller SHALL push the snapshot through
`syncContext` with the edited sides applied — so the D18 "request-change fires callServerTool AND
update-model-context" pairing holds while a superseded (out-of-order) iteration pushes nothing, and
the pushed snapshot matches render and commit rather than the op's default sides. A sides-only edit
SHALL route through `syncContext` only (no re-query). The system SHALL also provide a shared bridge
adapter that realises the MCP host's channels over a host-supplied bridge (`callServerTool` on
iterate; `ui/update-model-context` on `syncContext`; the read → write → read → context → message
sequence on commit, staying committed once the durable write lands), and a shared capability
resolver that computes the read-only/iterate/commit posture from host-supplied capability inputs
plus the payload's contract version.

#### Scenario: One controller drives both hosts

- **WHEN** the member app propose page and the MCP propose widget refine or commit a proposed week
- **THEN** both drive the same shared controller through a host adapter, and neither host reimplements the per-slot reducers, the commit week assembly, or the channel discipline

#### Scenario: A sides edit is routed to the context channel, not a re-query

- **WHEN** either host edits a slot's sides through the controller
- **THEN** the controller invokes the adapter's `syncContext` (a full-state snapshot) and never its `iterate`, so no re-query is issued

#### Scenario: A superseded iteration never leaves the host model on a stale week

- **WHEN** two iterations overlap and the earlier one resolves last
- **THEN** the controller's seq guard drops the stale result and pushes NO model-context update for it, so the host model reflects the latest week — never an older one the UI has already replaced

## MODIFIED Requirements

### Requirement: Shared propose slot view projection
The system SHALL provide one shared implementation for projecting propose result slots
and session edits into the slot view shape consumed by shared propose UI primitives.

#### Scenario: Equivalent slot projects identically in both hosts
- **WHEN** the member app host and MCP widget host render the same propose slot with the same session state
- **THEN** both hosts use the shared projector to produce the same slot view labels, flags, pins, sides, alternates, and lock state

#### Scenario: Capability inputs stay host-owned; the ladder is shared
- **WHEN** the MCP widget determines whether a proposal can be iterated or committed
- **THEN** the host supplies the raw capability inputs (its host-capability flags, palette presence, round-trip check, and the payload's contract version) and the App bridge, while the shared capability resolver computes the read-only / iterate / commit-mode posture from them
