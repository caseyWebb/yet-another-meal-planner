## MODIFIED Requirements

### Requirement: Admin panel is organized into top-level areas with client-side routing

The admin SPA SHALL organize its surfaces into top-level areas — a **Status** area (the operator-facing background-job health view), a **Members** area (member management), a **Dev** area (the tool console and future developer surfaces), a **Logs** area (operator-auditable activity logs, organized by a left submenu of log sources; see "Logs area with a left submenu and a detail dialog"), a **Config** area (operator-editable configuration, organized into routed sub-views — the discovery calibration console and the shared-corpus editors; see "Config area hosts the calibration console and the shared-corpus editors"), and a **Data** area (the read-only data explorer over D1 and the R2 corpus — see the operator-data-explorer capability) — navigable by client-side routing so each surface has its own URL and a new surface is added as its own routed module rather than another card on a single page. The panel's **home** route (`/admin`) SHALL be the Status view; member management SHALL be reached at its own route (`/admin/members`), the tool console under `/admin/dev`, the logs under `/admin/logs` (with the selected log source as a sub-route, e.g. `/admin/logs/discovery`), configuration under `/admin/config` (with the selected config sub-view as a sub-route, e.g. `/admin/config/feeds`), and the data explorer under `/admin/data/*`, not at the panel root. Navigating between surfaces SHALL update the browser URL, and a deep link or refresh to a surface's URL SHALL load that surface directly.

#### Scenario: Navigation updates the URL

- **WHEN** the operator switches from one area to another (e.g. from Status to member management, to the tool console, to the logs, or to config)
- **THEN** the browser URL changes to that surface's route and the surface renders, without a full-page server reload

#### Scenario: Home route shows the Status view

- **WHEN** the operator opens `/admin` (or `/`)
- **THEN** the Status (background-job health) view renders as the home surface, not member management

#### Scenario: Member management has its own route

- **WHEN** the operator opens `/admin/members` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the member-management surface

#### Scenario: Deep link to a tool

- **WHEN** the operator opens `/admin/dev/tools/<tool>` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to that tool's view

#### Scenario: Deep link to a log

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Logs area with the Discovery log selected

#### Scenario: Deep link to config

- **WHEN** the operator opens `/admin/config` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Config area with the calibration console selected

#### Scenario: Deep link to a config sub-view

- **WHEN** the operator opens a config editor route such as `/admin/config/feeds` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Config area with that shared-corpus editor selected

#### Scenario: Deep link to a data view

- **WHEN** the operator opens a data-explorer route such as `/admin/data/recipes/<slug>` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to that data view

### Requirement: Config area hosts the calibration console and the shared-corpus editors

The admin SPA SHALL provide a top-level **Config** area (routed at `/admin/config`) organized into routed sub-views reached by a sub-navigation, whose **default** sub-view (the bare `/admin/config`) is the discovery calibration console and whose other sub-views are the shared-corpus editors (see "Operator edits shared-corpus tables under Config"). Each sub-view SHALL have its own sub-route so it deep-links (e.g. `/admin/config`, `/admin/config/feeds`), and selecting a sub-view SHALL update the browser URL without a full-page reload.

The discovery calibration console SHALL host the sweep's tunable knobs (τ, triage threshold, δ, classify cap, rate cap) as a form, an **Analyze** action and a **Dry-run** action, and a results panel — laid out so the projected effect of the current knob values is visible on the **same screen** before the operator saves. Editing a knob and running Analyze/Dry-run SHALL NOT persist anything; only an explicit Save writes the config. The form SHALL show the projected effect (the Analyze/Dry-run results) before Save, and a value past a hard floor SHALL require an explicit confirmation step in the UI (mirroring the server-side guard). The surfaces SHALL be modeled per `admin/CLAUDE.md`: the loaded config and the Analyze/Dry-run results as `RemoteData`, and a dirty-vs-saved form state as a custom type (so "unsaved edits" cannot be confused with "saved").

#### Scenario: Operator previews then saves a knob change

- **WHEN** the operator opens `/admin/config`, changes τ, and runs Analyze
- **THEN** the projected per-member match counts render without persisting anything, and the new τ is stored only when the operator explicitly Saves

#### Scenario: A floor-breaching value requires confirmation in the UI

- **WHEN** the operator drags τ below the hard floor and tries to Save
- **THEN** the console requires an explicit confirmation before sending the write

#### Scenario: Config area deep-links to the calibration console

- **WHEN** the operator opens `/admin/config` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to the Config area with the calibration console as the default sub-view

#### Scenario: Config sub-views are reachable by sub-navigation

- **WHEN** the operator opens the Config area and selects a shared-corpus editor from the sub-navigation
- **THEN** the browser URL changes to that editor's sub-route and the editor renders, the calibration console being one selectable sub-view among them

## ADDED Requirements

### Requirement: Operator edits shared-corpus tables under Config

The Config area SHALL provide an operator editor for each of the five shared-corpus lookup tables — ingredient **aliases** (`variant → canonical`), **flyer terms**, discovery **feeds** (RSS/Atom sources), and the discovery allowlist's newsletter **senders** and member **addresses** — each as its own routed sub-view that **lists** the table's current rows, **adds** a row, and **removes** a row by its primary key. These are group-wide (tenant-free) shared config, and the editor SHALL present and write the group-wide table (the same cross-tenant operator reach the rest of `/admin` has).

Removal SHALL be **operator-only**: it SHALL NOT be exposed as an MCP tool, so the agent can add (via the existing add tools) but only the operator prunes. Adding through the editor SHALL match the existing write semantics — `aliases` is an upsert keyed by `variant` (re-adding a variant overwrites its canonical), and `flyer_terms`, `feeds`, `senders`, and `members` are insert-or-ignore (add-only dedup) — so the operator's add path and the agent's add path converge on the same row. A removal SHALL be idempotent: removing an absent key SHALL succeed (reporting that nothing was removed) rather than erroring.

The editor surfaces SHALL be modeled per `admin/CLAUDE.md`: the loaded rows SHALL be `RemoteData` (the four-state load), and the in-flight add/remove mutation together with its failure SHALL be a single custom type carrying which operation is in flight (so "an add is running", "a remove of row X is running", and "the last mutation failed, with its error" cannot contradict, and one mutation at a time is structural) — never a `Bool` busy flag beside a `Maybe String` error. After a successful add or remove the editor SHALL refetch the list rather than locally patching it, so the displayed rows are always the authoritative server state.

#### Scenario: Operator lists, adds, and removes a feed

- **WHEN** the operator opens `/admin/config/feeds`, adds a feed URL, then removes an existing feed
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

### Requirement: Shared-corpus editor endpoints served cross-tenant under Access

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured), a writable corpus namespace `/admin/api/corpus/<table>` where `<table>` is one of a fixed set (`aliases`, `flyer-terms`, `feeds`, `senders`, `members`): `GET /admin/api/corpus/<table>` lists the table's rows, `POST /admin/api/corpus/<table>` adds one validated row, and `DELETE /admin/api/corpus/<table>/<key>` removes the row with that primary key. An unknown `<table>` SHALL be a not-found error and an unsupported method SHALL be rejected (`405`). These are operator/cross-tenant operations writing group-wide config and SHALL NOT be exposed as MCP tools. They SHALL be distinct from the read-only `/admin/api/data/*` explorer namespace, which remains read-only.

The `POST` SHALL validate per table server-side and write nothing on a bad input: a non-empty primary key always; `aliases` a non-empty `canonical`; `feeds` a URL with a numeric `weight` (defaulting when absent) and `tags` as a string array; `senders`/`members` an address that is normalized (trimmed, lowercased) before storage. The `DELETE` SHALL normalize an address key the same way before matching, so a delete always targets the row an add produced. All writes SHALL go through the Worker's structured storage layer (returning structured errors, not throwing).

#### Scenario: Corpus endpoints are reachable only under Access

- **WHEN** Access is configured and an authenticated operator calls `GET /admin/api/corpus/feeds`
- **THEN** the feed rows are returned; and when Access is unconfigured every `/admin/api/corpus/*` route responds `404` like the rest of `/admin*`

#### Scenario: An invalid add is rejected without a write

- **WHEN** `POST /admin/api/corpus/aliases` sends a row missing its `canonical` (or an empty `variant`)
- **THEN** the endpoint returns a structured validation error and writes nothing

#### Scenario: An unknown table or method is rejected

- **WHEN** a request targets `/admin/api/corpus/<unknown>` or uses an unsupported method on a valid table
- **THEN** the endpoint responds with a not-found error for the unknown table and `405` for the unsupported method, writing nothing

#### Scenario: Delete removes by primary key

- **WHEN** `DELETE /admin/api/corpus/flyer-terms/<term>` targets an existing term
- **THEN** that term's row is removed and the response reports the removal; a key that is absent reports no removal rather than erroring
