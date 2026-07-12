## ADDED Requirements

### Requirement: A send-wide purchase assertion is exact and atomic

The shared `mark_grocery_send_placed` operation SHALL accept a tenant-owned `send_id`, the caller's sorted `expected_line_keys`, and rendered `snapshot_version`. Before writing, it SHALL verify that the expected set exactly equals all current rows with `status:"in_cart"` and `sent_in=send_id`; any missing, added, moved, or differently linked line SHALL return `conflict` with the fresh grocery snapshot and SHALL advance/materialize nothing. On success one atomic operation SHALL advance exactly those rows to `ordered`, stamp `ordered_at`, materialize every linked D16 send line through the one shared writer, and stamp the send `placed_at`.

#### Scenario: Whole send succeeds atomically
- **WHEN** expected keys exactly match five current in-cart rows for the send
- **THEN** all five become ordered, all five linked snapshot lines materialize idempotently, and the send records its placed time

#### Scenario: Membership mismatch writes nothing
- **WHEN** one line was relisted after the caller rendered the five-line send
- **THEN** the assertion returns conflict with the four-line current snapshot and none of the remaining rows advances

#### Scenario: Cross-send key is rejected
- **WHEN** an expected line belongs to another send or tenant
- **THEN** the operation returns a structured error and writes no status or spend change

### Requirement: Send-wide assertion replay is idempotent

Once a send is stamped placed, replay of the same send assertion SHALL return the completed outcome and current snapshot without re-advancing a relisted row or duplicating spend. A never-placed send with zero current in-cart members SHALL not be assertable. Existing per-row `update_grocery_list(in_cart → ordered)` remains a compatible surface, but member whole-send UI and agent choreography with a send id SHALL use the batch operation.

#### Scenario: Completed assertion replay does not resurrect a row
- **WHEN** a completed send assertion is replayed after later state changes
- **THEN** it reports the prior completion without changing current rows or spend events

### Requirement: Back to list is send-scoped and writes no spend

The shared `relist_grocery_send_line` operation SHALL accept `send_id`, canonical `line_key`, and `expected_row_version`, and SHALL conditionally perform only `in_cart → active` for a row currently linked to that send. It SHALL clear `sent_in`, write no spend, and leave the historical send snapshot immutable. A stale row version or mismatched send SHALL return conflict without a write. Ordered-row relist/void behavior remains governed by the existing lifecycle and is not exposed as Back to list in an in-cart group.

#### Scenario: One line returns to active
- **WHEN** Back to list succeeds for one unplaced send line
- **THEN** only that row becomes active with no send linkage, the persisted send quote remains historical, and no spend event exists for it

#### Scenario: Stale relist cannot move a newer row
- **WHEN** the row changed after the caller rendered it
- **THEN** relist returns conflict and leaves the newer state intact
