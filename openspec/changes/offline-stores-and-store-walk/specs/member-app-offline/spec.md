## ADDED Requirements

### Requirement: Shop completion queues as an ordered class-(b) receipt write

The member app SHALL register shop commit under one stable mutation key with plain-JSON variables. The client-minted `session_id`, exact checked keys, snapshot version, and occurred-at SHALL be captured once, persisted across reload, and delivered serially after all earlier checked-state mutations for that walk. Reconnect/restore MAY replay the identical payload, relying on the durable receipt for exactly-once effects. The mutation and local walk record SHALL be tenant-stamped and removed by the existing logout/identity-change purge.

#### Scenario: Offline checks replay before finish
- **WHEN** a member checks several rows and confirms Finish offline
- **THEN** restored serial replay delivers those check operations before the exact shop commit for that session

#### Scenario: Reload preserves pending finish
- **WHEN** the app closes after queueing Finish offline and later launches online as the same member
- **THEN** the identical payload resumes and resolves to one receipt without minting a new session id or event time

#### Scenario: Identity purge drops another member's walk
- **WHEN** a different household signs in on a device with a pending walk
- **THEN** the queued commit and local walk shell are purged before they can replay

### Requirement: Offline persistence contains only secret-free walk context

The Grocery persisted snapshot allowlist SHALL include the selected Offline store's secret-free slug/display/domain/map summary/route context required to start or resume a walk. It SHALL NOT persist the credential-bearing adapter projection, Kroger connection truth, Satellite state/secrets, or full profile. With no cached map, the member SHALL still be able to start a Not mapped walk over persisted Grocery rows.

The aisle-map whole-document `If-Match` write and household nickname preferences write SHALL be class (a), disabled offline, and never queued. MCP App shop completion SHALL remain online-only; the PWA queue is the D15 zero-connectivity implementation.

#### Scenario: Persisted walk context leaks no adapter credential state
- **WHEN** IndexedDB is inspected after loading an Offline walk
- **THEN** it contains the secret-free selected store/route context but no Kroger link/token state, Satellite freshness/secret, or full profile

#### Scenario: Map and nickname edits never replay later
- **WHEN** a member opens either editor offline
- **THEN** save is disabled with an offline hint and reconnect does not automatically issue a write
