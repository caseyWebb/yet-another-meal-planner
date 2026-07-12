## ADDED Requirements

### Requirement: Offline adapter rows carry private display and honest map summary

The shared store-adapter projection SHALL enrich each existing grocery-domain Offline registry row and selected walk launcher with `shared_name`, household `nickname`, `display_name = nickname ?? label ?? name`, and aisle-map `{state, aisle_count, as_of}` from the shared map projection. It SHALL NOT expose note bodies, private notes from another household, or derive map status independently. Profile and Grocery consumers SHALL continue to use this one projection; the Grocery snapshot MAY persist only its selected secret-free walk-context subset.

#### Scenario: Card and launcher agree
- **WHEN** a selected Offline store has a household nickname and stale effective map
- **THEN** the Store card and Grocery launcher show the same display name and stale map summary from one projection

#### Scenario: Another household private note is invisible
- **WHEN** another household has only private layout notes for the store
- **THEN** those notes do not affect this caller's aisle count, state, as-of, or payload

### Requirement: Offline selection invalidates placement without mutating list state

A successful household nickname, aisle-map, or standing Offline-store change SHALL invalidate the shared adapter projection and enriched Grocery walk placement. It SHALL leave grocery membership, `checked_at`, online lifecycle rows, and any unrelated local paused session unchanged; a walk whose selected store no longer matches SHALL require an explicit restart/switch rather than silently changing store context.

#### Scenario: Map edit re-routes but does not re-check
- **WHEN** a map contribution moves a section to another aisle
- **THEN** the next enriched Grocery snapshot re-routes matching lines while their membership and checked timestamps remain unchanged

#### Scenario: Standing store changes during a paused walk
- **WHEN** a member changes the standing Offline store while a local walk for the prior store is paused
- **THEN** the prior local record retains its explicit store and is not silently rebound to the new preference
