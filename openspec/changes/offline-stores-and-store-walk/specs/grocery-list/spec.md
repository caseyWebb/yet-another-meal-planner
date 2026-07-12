## ADDED Requirements

### Requirement: Shop completion consumes one exact eligible checked set

The system SHALL expose one household-scoped shop-commit operation accepting a client-minted `session_id`, `mode`, resolved-store reference, sorted unique `expected_checked_keys`, rendered Grocery `snapshot_version`, and client-captured `occurred_at`. A store walk's eligible set SHALL be exactly rows for that tenant with `status='active'`, non-null `checked_at`, and `domain` equal to the existing resolved store's domain; a manual shop SHALL use the grocery domain without creating a store adapter. Unchecked, `in_cart`, `ordered`, missing, already-consumed, and wrong-domain rows SHALL NOT be committed. Grocery and household kinds SHALL be consumed, but only grocery-kind grocery-domain rows SHALL restock pantry.

The operation SHALL compare the requested keys with the complete eligible set and the rendered snapshot before effects. A difference SHALL return `checked_set_changed` with fresh authoritative state and SHALL perform no partial deletion, restock, or spend write. Checked virtual plan needs SHALL already exist as canonical `source:'menu'` rows through the checked operation; shop commit SHALL NOT materialize virtual lines.

#### Scenario: Exact checked rows commit
- **WHEN** a grocery-store walk confirms the complete current set of active checked grocery-domain rows
- **THEN** exactly those rows are consumed, including checked household rows, while unchecked, in-cart, ordered, and other-domain rows remain unchanged

#### Scenario: Stale completion is atomic conflict
- **WHEN** a requested row was unchecked or advanced after the completion sheet rendered, or another eligible row was checked
- **THEN** the operation returns `checked_set_changed` with the fresh set/snapshot and performs none of the shop effects

#### Scenario: Checked virtual line is already durable
- **WHEN** a checked plan-derived need is included in shop completion
- **THEN** the operation consumes its existing canonical materialized row and creates no second grocery row

### Requirement: Destructive completion has an immutable idempotent receipt

The system SHALL persist a tenant/session-scoped shop receipt and immutable receipt lines in the same atomic database unit as pantry, spend, and grocery-row consumption. The receipt SHALL include the canonical request hash, resolved mode/store/domain, event and commit times, every consumed row, pantry outcome, pricing provenance, and aggregate result. It SHALL exist before or atomically with destructive deletion so a retry never depends on deleted grocery rows.

A repeat of the same household `session_id` and canonical request SHALL return the stored receipt with replay outcome and SHALL repeat no effect. Reuse of that id with a different request SHALL return `idempotency_conflict`. Two different session ids racing overlapping checked sets SHALL allow at most one commit; the loser SHALL receive a checked-set conflict and fresh state.

#### Scenario: Lost response replays the receipt
- **WHEN** a commit succeeds but its response is lost and the identical request is delivered again
- **THEN** the stored receipt is returned and grocery deletion, pantry quantity, and spend remain exactly once

#### Scenario: Session id cannot change meaning
- **WHEN** a caller reuses a completed session id with a different key set, store, mode, or occurred-at value
- **THEN** the operation returns `idempotency_conflict` and preserves the original receipt/effects

#### Scenario: Concurrent sessions cannot consume twice
- **WHEN** two different sessions race to commit overlapping eligible rows
- **THEN** exactly one durable receipt owns the rows and the other request writes nothing

### Requirement: Shop completion restocks pantry as verified

For each consumed `kind='grocery' AND domain='grocery'` row, shop commit SHALL reuse the shared pantry add/merge semantics with its canonical/display identity and loose buy quantity, preserve unrelated existing pantry metadata, and stamp `last_verified_at` from the commit's retained `occurred_at`. It SHALL perform that restock in the same atomic unit as receipt and consumption. Household, other-kind, and non-grocery-domain rows SHALL never create pantry entries.

#### Scenario: Grocery purchase is immediately verified
- **WHEN** a checked grocery-kind food row commits
- **THEN** its pantry row is added/merged and carries `last_verified_at` equal to the retained shop occurrence time

#### Scenario: Household purchase skips pantry
- **WHEN** checked paper towels commit in a grocery-store walk
- **THEN** the grocery-list row is consumed and appears in the receipt but no pantry row is written
