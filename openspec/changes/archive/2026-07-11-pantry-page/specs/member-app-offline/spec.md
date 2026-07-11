# member-app-offline

## MODIFIED Requirements

### Requirement: Class (b) writes queue offline and replay on reconnect

The app SHALL issue every class (b) write as a registered mutation — a `mutationKey` with
client-registered defaults and plain-JSON variables — so that a write made while offline
pauses instead of failing, persists across a reload, and replays when connectivity returns
(automatically on reconnect, and via resume-after-restore on the next launch). The class (b)
set is the two-writer table's idempotent, canonical-id-keyed upserts and deletes: grocery
add/set/remove, pantry ops and verify (including the `location` and `category` fields riding
the pantry upsert), **pantry dispose** (keyed on its client-minted waste `event_id`; the app
mints a ULID and stamps `occurred_at` at tap time, so a replayed waste disposition converges to
exactly one waste event recorded on the day it happened, and a replayed `used` disposition
converges as an idempotent delete), favorite set, plan ops (keyed by the client-minted
plan-row id), log add and delete, note add/edit/remove, vibe create/delete, proposal confirm.
Both the disposition write and the multi-item add batch ride the already-registered
`["pantry","ops"]` key — no new mutation key is introduced. Replays SHALL be serial and SHALL
reuse the registered defaults (optimistic update, error surfacing, settle-time invalidation). A
replay the server rejects SHALL surface to the member (structured-error toast) and reconcile the
cache by refetch — never retry forever, never silently drop. Offline, class (b) surfaces SHALL
remain fully interactive with optimistic state where the page renders the written row.

#### Scenario: Offline check-offs replay on reconnect

- **WHEN** a member checks off grocery items while offline and connectivity later returns
- **THEN** each check-off was rendered optimistically at tap time, was queued as a paused
  mutation, and replays on reconnect so the server's rows reach `in_cart` — converging even
  if a check-off is delivered more than once

#### Scenario: A queued write survives an offline reload

- **WHEN** a member makes a class (b) write offline, the app is closed and relaunched still
  offline, and connectivity then returns
- **THEN** the persisted paused mutation is restored with its variables, re-bound to its
  registered default function, and replayed successfully on reconnect

#### Scenario: A rejected replay is surfaced, not looped

- **WHEN** a queued mutation replays and the server answers with a structured error (e.g. a
  proposal already resolved)
- **THEN** the member sees the structured-error message, the affected queries are refetched
  to the server's truth, and the mutation is not retried indefinitely

#### Scenario: An offline waste disposition replays without double-counting

- **WHEN** a member marks an item as waste while offline (the app minting the event id and
  stamping the occurrence date at tap time) and the queued mutation is later delivered more
  than once
- **THEN** the server records exactly one waste event under the minted id, dated to the tap
  day, and every delivery reports success to the replayer
