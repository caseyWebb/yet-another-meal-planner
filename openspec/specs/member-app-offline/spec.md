# member-app-offline Specification

## Purpose
TBD - created by archiving change member-app-offline. Update Purpose after archive.
## Requirements
### Requirement: Offline reads persist through an explicit allowlist to IndexedDB

The member app SHALL persist its query cache to IndexedDB (a structured-clone persister over
`idb-keyval`, one key) so that opening the app with no network renders the member's data from
the last session. Persistence SHALL be governed by an explicit allowlist of query-key
prefixes — the grocery reads (stored rows and the derived to-buy view), pantry, meal plan,
overlay (favorites/rejects), the cookbook index, and visited recipe bodies — and a query
outside the allowlist SHALL NOT be persisted by construction (an allowlist predicate, not
per-query opt-outs). Session/whoami state, search results, propose results and weather,
profile, retrospective, vibes, and pending proposals SHALL never be written to the persisted
cache. Restoration SHALL gate query rendering (no empty-cache flash before rehydration), and
persisted entries SHALL expire by a bounded `maxAge` (14 days) with allowlisted queries'
`gcTime` at least that long.

#### Scenario: Airplane mode opens the app with the grocery list

- **WHEN** a member who has previously used the app online launches it with no network
  connectivity
- **THEN** the app shell loads from the service-worker precache and the grocery page renders
  the to-buy view and stored rows from the persisted cache, with no network request required

#### Scenario: A non-allowlisted query never reaches IndexedDB

- **WHEN** a member uses search, the propose flow, and the profile page online, and the
  persisted cache is then inspected
- **THEN** it contains no search-result, propose, weather, or profile entries — only
  allowlisted prefixes are present

#### Scenario: A new build discards the persisted cache

- **WHEN** the app loads with a bundle whose embedded build id differs from the one the
  persisted cache was written under (the persister's buster)
- **THEN** the persisted state is discarded rather than restored, and the caches repopulate
  from the network

### Requirement: Local member data is purged on logout and identity change

The app SHALL provide one purge operation that removes the persisted query cache (the
IndexedDB key), clears the in-memory query and mutation caches (queued writes from a prior
member never replay into a new session), and removes the local identity stamp and the
client-side propose session. The purge SHALL run on logout, on login as a different tenant
than the stamped one, and on a definitive 401 at boot. The purge SHALL NOT run on network
failure — an offline device keeps its own member's data. A device-level preference (theme)
MAY survive the purge.

#### Scenario: Logout leaves no member data at rest

- **WHEN** a member signs out
- **THEN** the IndexedDB persisted cache, the identity stamp, and the propose session are
  removed, and a subsequent offline launch reaches the login screen with no member data
  rendered

#### Scenario: A different member's login does not inherit the cache

- **WHEN** member B logs in on a device whose local stamp names member A
- **THEN** the purge runs before B's session is established, and no query, queued mutation,
  or propose state authored under A survives

#### Scenario: Same-member re-entry keeps offline continuity

- **WHEN** a member's session has expired and the same member logs back in with their invite
  code
- **THEN** the persisted cache is retained (no purge), preserving offline data across the
  re-entry

### Requirement: Offline boot falls back to the last-known identity; a definitive 401 does not

The app shell's boot check SHALL distinguish a definitive session rejection from an
unreachable server. On a 401 the app SHALL purge local member data and present login. On a
network failure it SHALL fall back to the locally stamped identity (written at login and
refreshed on successful whoami) and render the shell over the persisted cache; with no stamp
present it SHALL present login. The stamp SHALL be a boot/display hint only — every online
request is still authorized by the server-side session, never by the stamp.

#### Scenario: Offline boot renders the shell for the stamped member

- **WHEN** the boot whoami fails with a network error and a local identity stamp exists
- **THEN** the app renders the signed-in shell for the stamped tenant over persisted data
  instead of failing at the router or bouncing to login

#### Scenario: A revoked or expired session is not resurrected by the stamp

- **WHEN** the boot whoami returns 401
- **THEN** the app purges local member data and presents the login screen — the stamp never
  overrides a definitive server rejection

### Requirement: Class (b) writes queue offline and replay on reconnect

The app SHALL issue every class (b) write as a registered mutation — a `mutationKey` with
client-registered defaults and plain-JSON variables — so that a write made while offline
pauses instead of failing, persists across a reload, and replays when connectivity returns
(automatically on reconnect, and via resume-after-restore on the next launch). The class (b)
set is the two-writer table's idempotent, canonical-id-keyed upserts and deletes: grocery
add/set/remove, pantry ops and verify, favorite set, plan ops (keyed by the client-minted
plan-row id), log add and delete, note add/edit/remove, vibe create/delete, proposal confirm.
Replays SHALL be serial and SHALL reuse the registered defaults (optimistic update, error
surfacing, settle-time invalidation). A replay the server rejects SHALL surface to the member
(structured-error toast) and reconcile the cache by refetch — never retry forever, never
silently drop. Offline, class (b) surfaces SHALL remain fully interactive with optimistic
state where the page renders the written row.

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

### Requirement: Online-only surfaces are unreplayable by construction

The app SHALL make the online-only surfaces inexpressible as queued/replayed work: the order
preview/commit, substitutions, propose, vibe suggest, session login/logout, and every class
(a) `If-Match` write are never entered into the mutation cache (direct calls or queries, per
their landed classifications), and the mutation-dehydration predicate SHALL refuse any
mutation whose key is not in the class (b) registry — so an unregistered mutation cannot be
persisted even if one is introduced. While offline, these surfaces SHALL render disabled or fail fast with the
existing structured copy; none of them SHALL fire automatically on reconnect.

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

### Requirement: The service worker precaches the shell and never caches API responses

The service worker SHALL precache the member app shell (HTML, hashed JS/CSS, icons, manifest)
so the app opens with zero network, SHALL continue to exclude the admin bundle from its
precache, and SHALL NOT cache `/api` responses (no runtime caching over the API — the
persisted query cache is the only client store of API data, keeping the two-writer freshness
posture intact). The SPA-fallback denylist SHALL cover every Worker-owned path prefix from
`wrangler.jsonc`'s `run_worker_first`, and that correspondence SHALL be pinned by an
automated drift check so a new Worker-owned route cannot be silently swallowed client-side.

#### Scenario: The shell opens with zero network

- **WHEN** the app is launched offline after a prior online visit
- **THEN** the document and its assets are served from the service-worker precache

#### Scenario: API data is never served from a service-worker cache

- **WHEN** an `/api` request is made while offline
- **THEN** the service worker does not answer it from any cache — the request fails in the
  page context and the persisted query layer (not the SW) provides the data

#### Scenario: The denylist drift check fails on a missing prefix

- **WHEN** a Worker-owned path is added to `run_worker_first` without a matching
  `navigateFallbackDenylist` entry
- **THEN** the automated check fails, before any member can be served the SPA shell in place
  of the Worker route

### Requirement: Updates are prompt-to-reload and prompt only when ready to apply

The app SHALL apply updates only through member action, and SHALL prompt only when an
update is genuinely ready to apply: the reload prompt renders when a new service worker
has downloaded and is WAITING (`needRefresh`), whose action activates it and lands on the
new bundle, and nothing reloads or activates automatically. A detected build skew SHALL
NOT itself render the prompt — a bare header mismatch is not proof a new bundle exists to
load — it SHALL only trigger a bounded service-worker update check so a waiting worker can
materialize. Skew detection SHALL compare each API response's `X-App-Build` (and a one-shot
`GET /api/version` on the login screen) against the bundle's embedded build id, firing a
check only when both are stamped (non-`"dev"`) and differ. Update checks SHALL be bounded
(skew-triggered plus a throttled check on returning to the foreground) — no polling loop.

#### Scenario: A stale bundle nudges an update check, never a bare prompt

- **WHEN** a deployed Worker answers with an `X-App-Build` differing from the running
  bundle's stamped build id
- **THEN** the app requests a service-worker update check and continues working untouched,
  prompting only once a new worker has downloaded and is waiting — never on the header
  alone, so a spurious or transient skew never shows a reload the app cannot deliver

#### Scenario: A waiting build prompts and reloading applies it

- **WHEN** a new service worker has downloaded and is waiting (`needRefresh`)
- **THEN** the member sees the reload prompt and their action activates the waiting worker
  and lands on the new bundle — a member mid-grocery-aisle is never auto-reloaded

#### Scenario: Skew detection is inert when unstamped

- **WHEN** either side reports the `"dev"` build id (local dev, tests)
- **THEN** no update check fires and no prompt renders

### Requirement: The app is installable with real icons and an offered install affordance

The web app manifest SHALL satisfy installability requirements (standalone display, PNG icons
at 192 and 512 including a maskable variant, alongside the SVG) and the document SHALL carry
an `apple-touch-icon` for iOS Add-to-Home-Screen. An install menu affordance SHALL render
only when the browser has offered an install prompt and the app is not already running
standalone; platforms that expose no install event get no dead affordance.

#### Scenario: An installed launch works offline end-to-end

- **WHEN** the member installs the app and later launches it from the home screen offline
- **THEN** it opens standalone from the precached shell and renders allowlisted data from the
  persisted cache

### Requirement: Offline state is visible

The app shell SHALL indicate offline state (a pill driven by the online manager) so a member
knows writes are queuing, and the indicator SHALL clear on reconnect.

#### Scenario: The member can tell they are offline

- **WHEN** connectivity is lost and later restored
- **THEN** the offline indicator appears while offline (as queued class (b) writes remain
  interactive) and disappears on reconnect

### Requirement: The offline behaviors are gated in the browser-level suite

The app Playwright suite SHALL cover the offline contract deterministically: the
airplane-mode acceptance (offline launch renders the grocery list from the persisted cache;
an offline check-off replays on reconnect, including across an offline reload), the logout
purge, Worker-route passthrough while service-worker-controlled, and the skew-driven reload
prompt. Waits SHALL be condition-polls (service-worker readiness, persisted-state contents,
the server-visible replay), never fixed sleeps. Where the tooling cannot drive a path for
real (fabricating a genuinely waiting second service-worker build), the suite SHALL exercise
the same user-facing component and action through the drivable trigger and the split SHALL be
recorded — never a hand-waved green.

#### Scenario: The acceptance runs against the real stack

- **WHEN** the offline spec runs
- **THEN** it drives the built SPA under the real service worker against the seeded local
  Worker — browser-context offline emulation, real IndexedDB persistence, and a real replayed
  write observed server-side

#### Scenario: The harness exercises the stamped skew path

- **WHEN** the suite runs
- **THEN** both the bundle and the Worker carry one identical non-`"dev"` harness build id
  (no baseline skew), and the update spec fabricates a differing header to assert the prompt

