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

The app SHALL issue every class (b) write as a registered mutation — a `mutationKey` with client-registered defaults and plain-JSON variables — so that a write made while offline pauses instead of failing, persists across a reload, and replays when connectivity returns (automatically on reconnect, and via resume-after-restore on the next launch). The class (b) set is the two-writer table's idempotent, canonical-id-keyed upserts and deletes: grocery add/set/remove and **check/uncheck** (a narrow canonical-key operation that atomically materializes a virtual plan line before checking it and never changes `status`), grocery Buy-anyway and substitution decision upserts/deletes, send-scoped line relist, pantry ops and verify (including the `location` and `category` fields riding the pantry upsert), **pantry dispose** (keyed on its client-minted waste `event_id`; the app mints a ULID and stamps `occurred_at` at tap time, so replay converges), favorite set, plan ops (keyed by the client-minted plan-row id), log add/delete, note add/edit/remove, vibe create/delete, and proposal confirm. Both pantry disposition and multi-item add use the existing pantry-ops key.

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

### Requirement: Sidebar badges render offline from persisted reads

The sidebar badge derivation SHALL read only allowlisted persisted queries — the meal plan
and the derived to-buy view — so the badges render from the persisted cache while offline,
consistent with the pages those reads back. The derivation SHALL introduce no new query or
network request of its own.

#### Scenario: Badges render from the persisted cache offline

- **WHEN** the app relaunches offline for a member whose plan and to-buy reads are in the
  persisted cache
- **THEN** the sidebar meal-plan and grocery badges render from that persisted data with no
  network request

### Requirement: Grocery purchase assertions and MCP writes remain online-only

The mutation persistence allowlist SHALL exclude mark-send-placed and all MCP-host writes. Offline Mark order placed SHALL be disabled or fail fast with a reconnect hint, and no reconnect SHALL auto-fire an old purchase assertion. MCP hosts SHALL never persist or replay bridge mutations.

#### Scenario: Reconnect cannot place an order automatically
- **WHEN** a member taps Mark order placed without connectivity and reconnects later
- **THEN** no queued assertion exists and the send remains awaiting explicit confirmation

### Requirement: Shop completion queues as an ordered class-(b) receipt write

The member app SHALL register shop commit under one stable mutation key with plain-JSON variables. The client-minted `session_id`, exact checked keys, store/mode, and occurred-at SHALL be captured once and persisted across reload as the immutable logical request, both with the queued mutation and in the pending local walk record until a durable receipt is adopted. Its captured snapshot version is an initial delivery precondition; after all earlier checked-state mutations for that walk settle, execution SHALL replace only that precondition with the latest authoritative cached version. Reconnect/restore or response-loss retry SHALL replay the identical logical request, relying on the durable receipt for exactly-once effects. The mutation and local walk record SHALL be tenant-stamped and removed by the existing logout/identity-change purge.

#### Scenario: Offline checks replay before finish
- **WHEN** a member checks several rows and confirms Finish offline
- **THEN** restored serial replay delivers those check operations before the exact shop commit for that session

#### Scenario: Reload preserves pending finish
- **WHEN** the app closes after queueing Finish offline and later launches online as the same member
- **THEN** the identical logical request resumes with a delivery-time snapshot precondition and resolves to one receipt without minting a new session id, key set, store, or event time

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
