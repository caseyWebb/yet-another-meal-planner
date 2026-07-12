## ADDED Requirements

### Requirement: The Offline Store card edits nickname and owned aisle contribution

The existing Preferences Store card's Offline tab SHALL continue to list shared grocery-store registry rows from the adapter projection. For a selected row it SHALL expose the shared identity distinctly from an optional household nickname and SHALL write nickname only through the existing conditional preferences merge flow. It SHALL expose effective map status/age and a whole-document aisle editor whose editable data is labeled **Your map contribution**, separate from the read-only effective community preview.

The editor SHALL save through the session-gated aisle-map endpoint with `If-Match`, default new entries to shared visibility, preserve an explicit private choice, and offer a separate explicit "Use current map as a starting point" action rather than silently copying another author's facts into the caller's contribution. It SHALL render stale/unknown/mapped states, structured conflicts, offline-disabled save, and keyboard/focus behavior with existing shared UI primitives. It SHALL NOT add member shared-store identity CRUD.

#### Scenario: Editing map changes only own contribution
- **WHEN** a member edits and saves their full contribution from the Offline tab
- **THEN** the UI refreshes the effective map/projection while shared identity and other authors' notes remain unchanged

#### Scenario: Community map is not silently claimed
- **WHEN** a member with no contribution opens a store whose effective map comes from others
- **THEN** the map is visible as community context but the editable contribution stays empty until the member explicitly adopts or adds entries

#### Scenario: Offline editor is read-only
- **WHEN** the Store card is offline with cached secret-free map context
- **THEN** it may show that context but nickname/map saves are disabled and never queued

### Requirement: Store-walk member surfaces ship with browser-level visual coverage

The app Playwright harness SHALL extend page objects before implementation assertions and SHALL cover Offline registry reuse, shared/private nickname boundary, mapped/stale/unknown summaries, effective-versus-owned map editing and ETag conflict, mid-walk progression, pause/resume, completion sheet, offline queued/reload/replay success, replay conflict, and unchanged unchecked items. The suite SHALL capture and review desktop and tall/mobile screenshots for the changed Store card, active walk, and completion states without production-only fakes.

#### Scenario: Zero-connectivity walk is browser-proven
- **WHEN** the browser suite loads persisted Grocery context, disconnects, checks rows, queues Finish, reloads, and reconnects
- **THEN** the visual/behavior assertions prove one receipt, no per-tap spinner, pending copy before replay, and authoritative post-replay state
