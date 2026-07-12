## MODIFIED Requirements

### Requirement: Class (b) writes queue offline and replay on reconnect

The app SHALL issue every class (b) write as a registered mutation — a `mutationKey` with client-registered defaults and plain-JSON variables — so that a write made while offline pauses instead of failing, persists across a reload, and replays when connectivity returns (automatically on reconnect, and via resume-after-restore on the next launch). The class (b) set is the two-writer table's idempotent, canonical-id-keyed upserts and deletes: grocery add/set/remove and **check/uncheck** (a narrow canonical-key operation that atomically materializes a virtual plan line before checking it and never changes `status`), grocery Buy-anyway and substitution decision upserts/deletes, send-scoped line relist, pantry ops and verify (including the `location` and `category` fields riding the pantry upsert), **pantry dispose** (keyed on its client-minted waste `event_id`; the app mints a ULID and stamps `occurred_at` at tap time, so replay converges), favorite set, plan ops (keyed by the client-minted plan-row id), log add/delete, note add/edit/remove, vibe create/delete, and proposal confirm. Both pantry disposition and multi-item add use the existing pantry-ops key.

Replays SHALL be serial and reuse registered defaults (optimistic update, error surfacing, settle-time invalidation). A repeated check delivery whose desired state already holds SHALL succeed idempotently. An opposing stale check/uncheck SHALL not overwrite a newer row version; it SHALL surface a structured conflict and replace optimistic state with the returned authoritative snapshot. Offline, class-(b) surfaces SHALL remain interactive with optimistic state where the page renders the written row. MCP-host writes remain online-only.

#### Scenario: Offline check-offs replay to checked_at
- **WHEN** a member checks grocery items while offline and connectivity later returns
- **THEN** each check is rendered optimistically, queues as a paused canonical-key mutation, and replays so the server rows gain `checked_at` while remaining `status:"active"`

#### Scenario: Virtual check materializes exactly once
- **WHEN** the same queued check for a virtual plan line is restored and delivered more than once
- **THEN** one `source:"menu"` row exists under the canonical key and it is checked, with no duplicate or `in_cart` transition

#### Scenario: A queued write survives an offline reload
- **WHEN** a member makes a class-(b) write offline, closes and relaunches offline, and later reconnects
- **THEN** the persisted mutation is restored, rebound to its registered function, and replayed successfully

#### Scenario: Opposing stale replay is surfaced
- **WHEN** a queued uncheck replays after another member made a newer check-state change
- **THEN** the stale write is not retried forever or silently applied; the member sees the conflict and the cache reconciles to server truth

#### Scenario: An offline waste disposition replays without double-counting
- **WHEN** a member records waste offline with a client-minted event id and the mutation is later delivered more than once
- **THEN** exactly one waste event is recorded on the stamped occurrence day

## ADDED Requirements

### Requirement: Grocery purchase assertions and MCP writes remain online-only

The mutation persistence allowlist SHALL exclude mark-send-placed and all MCP-host writes. Offline Mark order placed SHALL be disabled or fail fast with a reconnect hint, and no reconnect SHALL auto-fire an old purchase assertion. MCP hosts SHALL never persist or replay bridge mutations.

#### Scenario: Reconnect cannot place an order automatically
- **WHEN** a member taps Mark order placed without connectivity and reconnects later
- **THEN** no queued assertion exists and the send remains awaiting explicit confirmation
