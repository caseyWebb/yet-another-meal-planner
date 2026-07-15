## MODIFIED Requirements

### Requirement: Class (b) writes queue offline and replay on reconnect

The app SHALL issue every class (b) write as a registered mutation — a `mutationKey` with client-registered defaults and plain-JSON variables — so that a write made while offline pauses instead of failing, persists across a reload, and replays when connectivity returns (automatically on reconnect, and via resume-after-restore on the next launch). The class (b) set is the two-writer table's idempotent, canonical-id-keyed upserts and deletes: grocery add/set/remove and **check/uncheck** (a narrow canonical-key operation that atomically materializes a virtual plan line before checking it and never changes `status`), grocery Buy-anyway and substitution decision upserts/deletes, send-scoped line relist, pantry ops and verify (including the `location` and `category` fields riding the pantry upsert), **pantry dispose** (keyed on its client-minted waste `event_id`; the app mints a ULID and stamps `occurred_at` at tap time, so replay converges), favorite set, plan ops (keyed by the client-minted plan-row id), log add/delete, note add/edit/remove, vibe create/delete, proposal confirm, and **nickname upsert/clear** (keyed by the canonical `(viewer member, target member)` pair; the empty-save clear is the keyed delete — the People page's one class (b) write). Both pantry disposition and multi-item add use the existing pantry-ops key.

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

#### Scenario: A nickname edit made during a connectivity drop replays
- **WHEN** a member with the People page open loses connectivity, edits a nickname, and reconnects
- **THEN** the edit renders optimistically, queues under its `(viewer, target)` canonical key, and replays idempotently — while every other People action (requests, accepts, blocks, invites) stays online-only

### Requirement: Online-only surfaces are unreplayable by construction

The app SHALL make the online-only surfaces inexpressible as queued/replayed work: the order
preview/commit, substitutions, propose, vibe suggest, session login/logout, the social
operations (handle lookup, request send/accept/decline/cancel, block/unblock, unfriend,
invite-link mint/revoke, join redemption, member remove, leave-household, household-accept),
and every class (a) `If-Match` write are never entered into the mutation cache (direct calls
or queries, per their landed classifications), and the mutation-dehydration predicate SHALL
refuse any mutation whose key is not in the class (b) registry — so an unregistered mutation
cannot be persisted even if one is introduced. While offline, these surfaces SHALL render
disabled or fail fast with the existing structured copy; none of them SHALL fire
automatically on reconnect.

#### Scenario: An order commit attempted around a connectivity drop is never replayed

- **WHEN** a member loses connectivity before or during an order commit
- **THEN** no order request is queued, persisted, or auto-fired on reconnect — the member
  re-initiates from a fresh preview (the Kroger cart write is not idempotent)

#### Scenario: The dehydration predicate rejects unregistered mutations

- **WHEN** the client state is dehydrated for persistence while a mutation without a
  registered class (b) key exists
- **THEN** that mutation is not persisted

#### Scenario: Class (a) editors do not queue stale preconditions

- **WHEN** a member is offline on a class (a) editing surface (preferences, taste or dietary
  markdown, vibe edit)
- **THEN** the editor is disabled with an offline hint (or the attempt fails fast); no
  `If-Match` write is queued for later replay

#### Scenario: Social actions fail fast offline and never auto-fire

- **WHEN** a member attempts to accept a request or send an invite while offline and then reconnects
- **THEN** the attempt fails fast with the structured offline hint (or the control is disabled), nothing is queued, and no social write fires on reconnect

### Requirement: Sidebar badges render offline from persisted reads

The sidebar badge derivation SHALL read only the same area reads the pages use, and while
offline it renders from whichever of them are in the persisted cache — the meal plan and
the derived to-buy view — so the plan and grocery badges render offline, consistent with the
pages those reads back. The people aggregate read is deliberately NOT on the persistence
allowlist (social data stays out of the offline store), so after an offline relaunch the
People badge is simply absent until connectivity returns. The derivation SHALL introduce no
new query or network request of its own.

#### Scenario: Badges render from the persisted cache offline

- **WHEN** the app relaunches offline for a member whose plan and to-buy reads are in the
  persisted cache
- **THEN** the sidebar meal-plan and grocery badges render from that persisted data with no
  network request

#### Scenario: The people badge is absent offline, never stale

- **WHEN** the app relaunches offline for a member who had pending inbound requests
- **THEN** no People badge renders (the people read is not persisted), and the badge returns
  with the live count once the aggregate read succeeds online
