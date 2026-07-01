## MODIFIED Requirements

### Requirement: Config area hosts the calibration console and the shared-corpus editors

The admin panel SHALL provide a top-level **Config** area (routed at `/admin/config`) organized into **four routed groups** reached by a sub-navigation — **Discovery** (the default, bare `/admin/config`), **Kroger Flyer** (`/admin/config/flyer`), **Ranking** (`/admin/config/ranking`), and **Aliases** (`/admin/config/aliases`) — each group's page rendering its knob console(s) and any corpus editor(s) together on one screen. Each group SHALL have its own sub-route so it deep-links, and selecting a group from the sub-navigation SHALL update the browser URL.

Every knob console in the Config area (Discovery's calibration knobs, Kroger Flyer's flyer-behavior knobs, Ranking's weight knobs) SHALL present each knob as a label, a numeric input, and a slider, and SHALL track its edits with the same **Clean | Dirty | NeedsConfirm** state: Save SHALL be disabled until the console is dirty (at least one knob differs from the last-saved value); a value at or below its safe floor (or at/above its safe ceiling) SHALL, on Save, surface a destructive-styled confirmation step in place of a plain Save, requiring an explicit "Confirm & save" before the write is sent with the write's confirm flag set — mirroring the server-side guard for that config (the discovery-calibration capability's guard for Discovery's knobs; the equivalent operator-config guard for Ranking/Flyer's floored knobs). Editing a knob (or running Discovery's Analyze/Dry-run) SHALL NOT persist anything; only an explicit Save (or Confirm & save) writes the config. A knob with no safe floor for its config (a knob whose full valid range is safe) SHALL render without a floor warning and SHALL never enter the NeedsConfirm state on its account.

The Discovery group's calibration console SHALL additionally host an **Analyze** action and a **Dry-run** action with a results panel, laid out so the projected effect of the current (unsaved) knob values is visible on the same screen before Save — unchanged from the existing calibration console's behavior.

The surfaces SHALL be modeled per `admin/CLAUDE.md`: the loaded config(s) and any Analyze/Dry-run results as `RemoteData`/`Loadable`, and the dirty-vs-saved-vs-needs-confirm form state as the one Clean/Dirty/NeedsConfirm union (never a `Bool` dirty flag beside a separate `Bool`/`Maybe` confirm flag).

#### Scenario: Operator previews then saves a Discovery knob change

- **WHEN** the operator opens `/admin/config` (Discovery, the default group), changes τ, and runs Analyze
- **THEN** the projected per-member match counts render without persisting anything, and the new τ is stored only when the operator explicitly Saves

#### Scenario: A floor-breaching Discovery value requires confirmation in the UI

- **WHEN** the operator drags τ below its safe floor and tries to Save
- **THEN** the console shows a destructive confirmation naming the floor and requires "Confirm & save" before the write is sent

#### Scenario: A floor-breaching Ranking or Flyer value requires confirmation in the UI

- **WHEN** the operator sets the Kroger Flyer group's flyer-refresh-hours knob below its safe floor and tries to Save
- **THEN** the console shows the same destructive confirmation-step behavior as the Discovery console, and the write is only sent once the operator confirms

#### Scenario: A knob with no safe floor never asks to confirm

- **WHEN** the operator sets a Ranking weight knob that has no safe floor to any value within its valid range and clicks Save
- **THEN** the console saves directly with no confirmation step, regardless of how low the value is

#### Scenario: Config area deep-links to the calibration console

- **WHEN** the operator opens `/admin/config` directly (or refreshes there)
- **THEN** the Worker serves the Discovery group as the default, with its calibration console rendered

#### Scenario: Config groups are reachable by sub-navigation

- **WHEN** the operator opens the Config area and selects the Kroger Flyer, Ranking, or Aliases group from the sub-navigation
- **THEN** the browser URL changes to that group's sub-route and the group's knob console(s) and/or corpus editor(s) render

### Requirement: Operator edits shared-corpus tables under Config

The Config area SHALL provide an operator editor for each of the shared-corpus lookup tables, grouped under the relevant Config group rather than as independent top-level sub-nav destinations: ingredient **aliases** (`variant → canonical`) under the Aliases group; discovery **feeds** (RSS/Atom sources) under the Discovery group; **flyer terms** under the Kroger Flyer group; and the discovery allowlist's newsletter **senders** and member **addresses** under the Discovery group, presented as a single consolidated **Email Sources** editor that lists both tables' rows together (each row tagged member vs. automated-forward) while adding or removing a row still writes to the correct underlying table (`senders` or `members`) based on which kind the operator selects — a presentation-layer grouping of the two existing tables, not a schema merge. Each editor lists the table's current rows, adds a row, and removes a row by its primary key. These remain group-wide (tenant-free) shared config, and the editor SHALL present and write the group-wide table(s) (the same cross-tenant operator reach the rest of `/admin` has).

Removal SHALL be **operator-only**: it SHALL NOT be exposed as an MCP tool, so the agent can add (via the existing add tools) but only the operator prunes. Adding through the editor SHALL match the existing write semantics — `aliases` is an upsert keyed by `variant` (re-adding a variant overwrites its canonical), and `flyer_terms`, `feeds`, `senders`, and `members` are insert-or-ignore (add-only dedup) — so the operator's add path and the agent's add path converge on the same row. A removal SHALL be idempotent: removing an absent key SHALL succeed (reporting that nothing was removed) rather than erroring.

The editor surfaces SHALL be modeled per `admin/CLAUDE.md`: the loaded rows SHALL be `RemoteData` (the four-state load), and the in-flight add/remove mutation together with its failure SHALL be a single custom type carrying which operation is in flight (so "an add is running", "a remove of row X is running", and "the last mutation failed, with its error" cannot contradict, and one mutation at a time is structural) — never a `Bool` busy flag beside a `Maybe String` error. After a successful add or remove the editor SHALL refetch the affected table rather than locally patching it, so the displayed rows are always the authoritative server state.

#### Scenario: Operator lists, adds, and removes a feed

- **WHEN** the operator opens the Discovery group's Feeds editor, adds a feed URL, then removes an existing feed
- **THEN** the editor lists the current feeds, the added feed appears after the write, and the removed feed is gone — each change reflected by refetching the group-wide `feeds` table

#### Scenario: Adding an existing alias overwrites its canonical

- **WHEN** the operator adds an alias whose `variant` already exists with a different `canonical`
- **THEN** the row's canonical is updated to the new value (upsert), not duplicated

#### Scenario: Removing an address is operator-only and normalized

- **WHEN** the operator removes a discovery sender or member address that was stored normalized (trimmed, lowercased)
- **THEN** the matching row is removed regardless of the key's surrounding whitespace or letter case, and no MCP tool exposes this removal to the agent

#### Scenario: Removing an absent row is idempotent

- **WHEN** the operator removes a key that is not present
- **THEN** the operation succeeds and reports that no row was removed, rather than returning an error

#### Scenario: Email Sources lists both underlying tables and routes writes correctly

- **WHEN** the operator opens the Discovery group's Email Sources editor, adds an address tagged "member", and adds a second address tagged "automated forward"
- **THEN** both addresses appear in the one combined list with their respective kind badges, the "member" address is written to the `members` table, and the "automated forward" address is written to the `senders` table

#### Scenario: Removing from Email Sources targets the row's own table

- **WHEN** the operator removes an address tagged "automated forward" from the Email Sources editor
- **THEN** the row is removed from the `senders` table (not `members`), and the `members` table is unaffected
