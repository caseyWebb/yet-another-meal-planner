# recipe-dedup — delta

## ADDED Requirements

### Requirement: Merge resolution defers to the operator admin surface

Accepting a `merge_recipes` proposal SHALL remain gated on operator review and SHALL never auto-merge. With `update_recipe` removed from the MCP surface, the fold/re-point/tombstone resolution has no chat writer: until the operator admin merge screen ships, pending `merge_recipes` proposals SHALL remain in the durable queue with no corpus write, and the operator MAY reject a pair via `confirm_proposal(accept: false)` — permanent suppression, both recipes kept. The `duplicate_of` tombstone semantics are unchanged and SHALL be honored by the future resolution surface: reversible exclusion from the projected index, with the R2 file, member notes, and cooking-log history intact, and the derived-row orphan prune preventing re-detection.

#### Scenario: An accepted merge has no resolution surface yet

- **WHEN** the operator wants to merge a proposed pair before the admin merge screen exists
- **THEN** the proposal stays pending in the queue, no corpus write occurs, and nothing is auto-merged

#### Scenario: Rejection stays available from the queue

- **WHEN** the operator rejects a `merge_recipes` proposal via `confirm_proposal(accept: false)`
- **THEN** both recipes are kept, and the pair is permanently suppressed from re-proposal

## REMOVED Requirements

### Requirement: A confirmed merge is agent-guided and non-destructive

**Reason**: `update_recipe` left the MCP surface in this change, so the conversational fold / `pairs_with` re-point / `duplicate_of` tombstone path is no longer executable from chat.

**Migration**: merge resolution moves to the fast-follow operator admin merge screen over the retained server-side objective-update operation; pending proposals remain queued (the screen's ready-made backlog) and rejection stays available via `confirm_proposal`. The non-destructive tombstone semantics carry forward in the ADDED requirement above.
