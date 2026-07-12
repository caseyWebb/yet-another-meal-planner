## ADDED Requirements

### Requirement: The Grocery page hosts a local active store walk

The Grocery route SHALL start a walk without a server round trip by minting a ULID and storing tenant-stamped local navigation `{session_id, store_slug, started_at, current_group, state}` while placing `mode=walk`, `walk`, and `store` in URL search. The local record SHALL NOT store an independent checked set; rendered/optimistic Grocery `checked_at` SHALL be the only item-progress truth. Pause SHALL exit walk mode while preserving row checks and the local record; the same device SHALL offer Resume, while another device MAY start a new shell over converged checked rows.

#### Scenario: Start offline creates no server session
- **WHEN** a member starts a walk from a persisted Grocery snapshot with zero connectivity
- **THEN** the URL/local shell starts immediately, no server walk-session write occurs, and item progress reads existing cached checked state

#### Scenario: Pause keeps progress
- **WHEN** a member pauses mid-walk and later resumes on the same device
- **THEN** local aisle navigation resumes and all picked state still comes from Grocery row checks

### Requirement: Active-walk presentation follows the approved local brief

Walk mode SHALL replace the normal page header with store display name, `N of M` progress, and an overall progress bar. It SHALL render route groups in resolved order, visually activate the first incomplete group, collapse completed groups to checked summaries while allowing reopen, preserve the existing checkbox/strikethrough row interaction, and trail Grab last plus Anywhere / Not mapped groups. It SHALL hide add/recipe grouping, order launcher/in-cart, underived, pantry coverage, and substitution panels. Check taps SHALL have no spinner; disconnection SHALL show a quiet "Offline — changes will sync" note.

#### Scenario: Mid-walk focuses the current aisle
- **WHEN** two aisle groups are complete and the next contains unchecked lines
- **THEN** the completed groups collapse, the next group is active, and global progress reflects the authoritative/optimistic row checks

#### Scenario: Walk hides decision panels
- **WHEN** walk mode is active
- **THEN** pantry coverage, substitutions, ordering, add-row, recipe grouping, and underived panels are absent without changing their underlying state

### Requirement: Finish has review, queued, receipt, and conflict states

Finish SHALL open a confirmation sheet showing checked/total counts, that unchecked items stay listed, verified pantry-restock semantics, and estimated-spend caveat. It SHALL freeze the exact checked keys, Grocery snapshot version, session id, and occurred-at in one commit payload. Online success SHALL render/adopt the durable receipt and authoritative snapshot, clear the local session, and exit walk mode.

Offline confirmation SHALL queue that immutable payload, set local state `pending_commit`, prevent edits to its captured lines, and show "Finishing when online" while retaining visibly pending checked rows rather than pretending they were consumed. Replay success SHALL adopt its receipt/snapshot and clear the session. A checked-set or idempotency conflict SHALL restore review/walk with fresh state and an actionable message; the app SHALL NOT broaden/retry the set automatically.

#### Scenario: Unchecked items remain after finish
- **WHEN** a member confirms 14 checked of 23 and commit succeeds
- **THEN** the receipt covers exactly 14 consumed rows and the nine unchecked rows remain on the list

#### Scenario: Offline finish remains visibly pending
- **WHEN** Finish is confirmed offline
- **THEN** one immutable queued mutation exists, the UI says it will finish online, and rows are not presented as authoritatively received before a receipt returns

#### Scenario: Reconnect conflict requires review
- **WHEN** the queued exact set no longer matches at replay
- **THEN** no partial effects occur and the page restores fresh checked state for explicit member review
